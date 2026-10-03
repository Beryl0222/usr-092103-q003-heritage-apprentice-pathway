import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import { buildStream } from "./fixtures.js";

/**
 * 零依赖的最小 JSON Schema 校验器，只实现本仓库契约实际用到的关键字：
 * type / required / properties / enum / minLength / format / additionalProperties / $ref / $defs。
 * 目的不是替代 Ajv，而是保证样例与 fixture 不偏离 contracts/domain.schema.json。
 */
function makeValidator(schema) {
  const typeOf = (value) => {
    if (value === null) return "null";
    if (Array.isArray(value)) return "array";
    if (Number.isInteger(value)) return "integer";
    return typeof value;
  };

  function validate(node, value, path, errors) {
    if (node.$ref) {
      const defName = node.$ref.slice("#/$defs/".length);
      validate(schema.$defs[defName], value, path, errors);
      return;
    }
    if (node.type) {
      const t = typeOf(value);
      const ok = node.type === "number" ? t === "integer" || t === "number" : t === node.type;
      if (!ok) {
        errors.push(`${path} 类型应为 ${node.type}，实际为 ${t}`);
        return;
      }
    }
    if (node.enum && !node.enum.includes(value)) errors.push(`${path} 不在枚举内：${String(value)}`);
    if (typeof node.minLength === "number" && typeof value === "string" && value.length < node.minLength) {
      errors.push(`${path} 长度不足 ${node.minLength}`);
    }
    if (node.format === "date-time" && Number.isNaN(Date.parse(value))) {
      errors.push(`${path} 不是合法日期时间：${value}`);
    }
    if (node.type === "object" && value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of node.required || []) {
        if (!(key in value)) errors.push(`${path} 缺少字段：${key}`);
      }
      if (node.additionalProperties === false) {
        const allowed = new Set(Object.keys(node.properties || {}));
        for (const key of Object.keys(value)) {
          if (!allowed.has(key)) errors.push(`${path} 出现契约外字段：${key}`);
        }
      }
      for (const [key, child] of Object.entries(node.properties || {})) {
        if (key in value) validate(child, value[key], `${path}.${key}`, errors);
      }
    }
  }

  return (value) => {
    const errors = [];
    validate(schema, value, "$", errors);
    return errors;
  };
}

const schema = JSON.parse(await readFile(new URL("../contracts/domain.schema.json", import.meta.url), "utf8"));
const validateAgainstSchema = makeValidator(schema);

test("最小样例符合 schema", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateAgainstSchema(sample), []);
});

test("全链路 fixture 的每条事件都符合 schema 信封", () => {
  for (const event of buildStream()) {
    const errors = validateAgainstSchema(event);
    assert.deepEqual(errors, [], `事件 ${event.event_id} 不符合 schema：\n${errors.join("\n")}`);
  }
});

test("schema 与 validator 的事件/聚合枚举保持一致", async () => {
  const source = await readFile(new URL("../src/validator.js", import.meta.url), "utf8");
  for (const eventType of schema.properties.event_type.enum) {
    assert.ok(source.includes(`"${eventType}"`), `validator.js 未登记事件类型 ${eventType}`);
  }
  for (const aggregateType of schema.properties.aggregate_type.enum) {
    assert.ok(source.includes(`"${aggregateType}"`), `validator.js 未登记聚合类型 ${aggregateType}`);
  }
});

test("静态 sample_stream.json 与 fixture 完全一致", async () => {
  const staticFile = JSON.parse(await readFile(new URL("../data/sample_stream.json", import.meta.url), "utf8"));
  assert.deepEqual(staticFile, buildStream());
});

test("data 目录中只有两份样例文件", async () => {
  const files = await readdir(new URL("../data", import.meta.url));
  assert.deepEqual(files.sort(), ["sample.json", "sample_stream.json"]);
});
