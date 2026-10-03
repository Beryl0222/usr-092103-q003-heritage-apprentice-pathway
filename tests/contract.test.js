import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateEvent } from "../src/validator.js";

test("最小样例符合领域约定", async () => {
  const sample = JSON.parse(await readFile(new URL("../data/sample.json", import.meta.url), "utf8"));
  assert.deepEqual(validateEvent(sample), []);
});

test("信封缺字段与非法枚举被拒绝", () => {
  const errors = validateEvent({ event_id: "x", version: 0 });
  assert.ok(errors.some((m) => m.includes("event_type")));
  assert.ok(errors.some((m) => m.includes("version 必须是正整数")));
});

test("观察性评语携带分数字段即非法", () => {
  const errors = validateEvent({
    event_id: "e1",
    event_type: "MASTER_NARRATIVE_RECORDED",
    aggregate_type: "apprenticeship",
    aggregate_id: "a1",
    occurred_at: "2026-09-29T11:00:00+08:00",
    version: 2,
    summary: "评语",
    recorded_by: { org_code: "studio", role: "master", person_id: "M-1" },
    payload: {
      learner_id: "L1",
      apprenticeship_id: "a1",
      master_id: "M-1",
      observed_at: "2026-09-29",
      aspects: ["手感"],
      narrative_text: "观察文字",
      score: 88,
    },
  });
  assert.ok(errors.some((m) => m.includes("分数字段")));
});

test("学校角色不能出具核心步骤确认，门店角色不能出具成绩", () => {
  const bySchool = validateEvent({
    event_id: "e1",
    event_type: "CORE_STEP_CONFIRMED",
    aggregate_type: "practice_evidence",
    aggregate_id: "p1",
    occurred_at: "2026-09-29T10:00:00+08:00",
    version: 1,
    summary: "x",
    recorded_by: { org_code: "school", role: "school" },
    payload: {},
  });
  assert.ok(bySchool.some((m) => m.includes("不能由角色 school 出具")));

  const byStore = validateEvent({
    event_id: "e2",
    event_type: "SCHOOL_GRADE_RECORDED",
    aggregate_type: "school_record",
    aggregate_id: "s1",
    occurred_at: "2026-09-29T10:00:00+08:00",
    version: 1,
    summary: "x",
    recorded_by: { org_code: "store", role: "store" },
    payload: {},
  });
  assert.ok(byStore.some((m) => m.includes("不能由角色 store 出具")));
});
