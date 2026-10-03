import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

import { validateEvent } from "../src/validator.js";
import { EVENT_TYPES, AGGREGATE_TYPES, EVENT_AGGREGATE, PAYLOAD_SHAPES } from "../src/vocabulary.js";

const schemaUrl = new URL("../contracts/domain.schema.json", import.meta.url);
const sampleUrl = new URL("../data/sample.json", import.meta.url);
const scenarioUrl = new URL("../data/sample.scenario.json", import.meta.url);

test("最小样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(sampleUrl, "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("Schema 是结构合法的 JSON Schema 文档", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.type, "object");
  for (const field of schema.required) assert.ok(field in schema.properties, `required 字段 ${field} 应有定义`);
});

test("Schema 事件枚举与 vocabulary.EVENT_TYPES 完全一致", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.deepEqual([...schema.properties.event_type.enum].sort(), Object.values(EVENT_TYPES).sort());
});

test("Schema 聚合枚举与 vocabulary.AGGREGATE_TYPES 完全一致", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  assert.deepEqual([...schema.properties.aggregate_type.enum].sort(), Object.values(AGGREGATE_TYPES).sort());
});

test("每个事件类型都有唯一的聚合归属，且聚合类型合法", () => {
  for (const [type, agg] of Object.entries(EVENT_AGGREGATE)) {
    assert.ok(Object.values(EVENT_TYPES).includes(type), `${type} 不是已知事件`);
    assert.ok(Object.values(AGGREGATE_TYPES).includes(agg), `${type} 的聚合 ${agg} 非法`);
  }
  assert.equal(Object.keys(EVENT_AGGREGATE).length, Object.keys(EVENT_TYPES).length);
});

test("PAYLOAD_SHAPES 的每个字段都在 Schema payload.properties 中有定义", async () => {
  const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
  const defined = new Set(Object.keys(schema.properties.payload.properties));
  for (const [type, shape] of Object.entries(PAYLOAD_SHAPES)) {
    for (const key of [...shape.required, ...shape.optional]) {
      assert.ok(defined.has(key), `事件 ${type} 的字段 payload.${key} 未在 Schema 中定义`);
    }
  }
});

test("完整联调场景快照中的每条事件都通过结构校验", async () => {
  const events = JSON.parse(await readFile(scenarioUrl, "utf8"));
  assert.ok(events.length >= 21);
  for (const event of events) {
    const errors = validateEvent(event);
    assert.deepEqual(errors, [], `事件 ${event.event_id} 结构问题：${errors.join("；")}`);
  }
});
