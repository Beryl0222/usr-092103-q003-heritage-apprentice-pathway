import test from "node:test";
import assert from "node:assert/strict";

import { newLedger } from "./helpers.js";
import { buildScenario, FIXTURE_IDS as I } from "../examples/fixture.mjs";
import { buildResumeTimeline, buildAuthorizationMatrix, canWorkIndependently, buildSubsidyReport } from "../src/projections.js";

async function scenario() {
  const { ledger, store } = await newLedger();
  buildScenario(ledger);
  return store;
}

test("履历时间线按时间排列，含两个师徒阶段且旧阶段仍可引用", async () => {
  const store = await scenario();
  const tl = buildResumeTimeline(store.events, { personId: I.P });
  assert.ok(tl.items.length >= 18);
  assert.equal(tl.epochs.length, 2);
  const [first, second] = tl.epochs;
  assert.equal(first.mentor_id, I.ZHAO);
  assert.ok(first.until, "旧关系有结束时间");
  assert.equal(first.exit_reason, "mentor_exit");
  assert.equal(first.superseded_by, "mentorship:linxia:chen");
  assert.equal(first.still_citable, true);
  assert.equal(second.mentor_id, I.CHEN);
  assert.equal(second.until, null);
});

test("授权矩阵：林夏此刻可独立承担雕錾走线与锤揲，不能独立退火", async () => {
  const store = await scenario();
  const matrix = buildAuthorizationMatrix(store.events, { personId: I.P, at: "2026-11-01T00:00:00+08:00" });
  const row = matrix.crafts[I.CRAFT];
  assert.deepEqual(row.independent_step_ids.sort(), ["mr:chase", "mr:hammer"]);
  assert.equal(canWorkIndependently(matrix, I.CRAFT, ["mr:chase"]).ok, true);
  const denied = canWorkIndependently(matrix, I.CRAFT, ["mr:anneal"]);
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.missing, ["mr:anneal"]);
});

test("门店可据授权矩阵逐步骤判断能否独立上岗", async () => {
  const store = await scenario();
  const matrix = buildAuthorizationMatrix(store.events, { personId: I.P, at: "2026-11-01T00:00:00+08:00" });
  assert.equal(canWorkIndependently(matrix, "pickle_packing", ["pp:brine"]).ok, false, "未授权工序不可上岗");
});

test("补助报告：四阶段补助均匹配真实证据，金额按阶段汇总", async () => {
  const store = await scenario();
  const report = buildSubsidyReport(store.events, { personId: I.P });
  assert.equal(report.subsidies.length, 4);
  assert.ok(report.subsidies.every((r) => r.matched), "每笔补助都能对应到存在的证据事件");
  assert.equal(report.total_matched, 7500);
  assert.equal(report.totals_by_stage.enrollment, 1000);
  assert.equal(report.totals_by_stage.training, 2000);
  assert.equal(report.totals_by_stage.assessment, 1500);
  assert.equal(report.totals_by_stage.employment, 3000);
  assert.equal(report.total_unmatched, 0);
});

test("补助报告把引用了不存在事件的补助计为未匹配", async () => {
  const store = await scenario();
  store.events.push({
    event_id: "demo-subsidy-ghost",
    event_type: "SUBSIDY_DISBURSED",
    aggregate_type: "subsidy",
    aggregate_id: "subsidy:ghost",
    occurred_at: "2026-11-05T10:00:00+08:00",
    version: 1,
    summary: "幽灵补助",
    policy_context: { sensitivity: "standard", visibility: "restricted" },
    payload: {
      actor_id: "official:fang",
      reason: "x",
      person_id: I.P,
      subsidy: { amount: 999, currency: "CNY", stage: "training", evidence_event_ids: ["does-not-exist"] },
    },
  });
  const report = buildSubsidyReport(store.events, { personId: I.P });
  const ghost = report.subsidies.find((r) => r.subsidy_event_id === "demo-subsidy-ghost");
  assert.equal(ghost.matched, false);
  assert.equal(report.total_unmatched, 999);
});
