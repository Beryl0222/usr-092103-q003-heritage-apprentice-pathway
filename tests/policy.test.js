import test from "node:test";
import assert from "node:assert/strict";

import { newLedger } from "./helpers.js";
import { buildScenario, FIXTURE_IDS as I } from "../examples/fixture.mjs";
import { redactEvents, createAccess } from "../src/policy.js";
import { VIEWER_ROLES } from "../src/vocabulary.js";

async function scenario() {
  const { ledger } = await newLedger();
  buildScenario(ledger);
  return ledger.store.events;
}

test("学员本人可见自己的联系方式与未公开作品", async () => {
  const events = await scenario();
  const mine = redactEvents(events, { role: VIEWER_ROLES.SELF, person_id: I.P });
  const eligibility = mine.find((e) => e.event_id === "demo-eligibility-001");
  const batch = mine.find((e) => e.event_id === "demo-batch-001");
  assert.ok(eligibility.payload.contact, "本人应可见联系方式");
  assert.ok(batch.payload.work_titles?.includes("缠枝纹银片试作"), "本人应可见未公开作品名");
});

test("获准门店可见联系方式与未公开作品（经同意/批次授权）", async () => {
  const events = await scenario();
  const viewer = { role: VIEWER_ROLES.SHOP, party_id: I.SHOP };
  const seen = redactEvents(events, viewer);
  assert.ok(seen.find((e) => e.event_id === "demo-eligibility-001").payload.contact, "同意名单内的门店可见联系方式");
  assert.ok(seen.find((e) => e.event_id === "demo-batch-001").payload.work_titles, "批次 allowed 门店可见作品");
});

test("未获准第三方看不到联系方式与未公开作品细节", async () => {
  const events = await scenario();
  const stranger = { role: VIEWER_ROLES.PUBLIC, party_id: "shop:other" };
  const seen = redactEvents(events, stranger);
  const eligibility = seen.find((e) => e.event_id === "demo-eligibility-001");
  const batch = seen.find((e) => e.event_id === "demo-batch-001");
  assert.equal(eligibility.payload.contact, undefined, "陌生方不可见联系方式");
  assert.equal(batch.payload.work_titles, undefined, "陌生方不可见未公开作品名");
  assert.equal(batch.payload.attribution, undefined, "陌生方不可见师承署名细节");
  assert.ok(batch._redactions.includes("payload.work_titles"));
});

test("师傅退出后，旧关系不再赋予其未公开作品访问权", async () => {
  const events = await scenario();
  // 赵丽的师徒关系已结束；以赵丽身份查看，批次不在其 allowed_party_ids 中
  const zhao = { role: VIEWER_ROLES.STUDIO_MENTOR, party_id: I.ZHAO };
  const seen = redactEvents(events, zhao);
  const batch = seen.find((e) => e.event_id === "demo-batch-001");
  // 批次 allowed_party_ids 只有工作室与门店，赵丽作为 party 未列入，且其关系已结束
  assert.equal(batch.payload.work_titles, undefined);
});

test("管理部门核验看不到联系方式，也看不到评语原文", async () => {
  const events = await scenario();
  const seen = redactEvents(events, { role: VIEWER_ROLES.DISTRICT, party_id: "district:center" });
  const eligibility = seen.find((e) => e.event_id === "demo-eligibility-001");
  const comment = seen.find((e) => e.event_id === "demo-comment-001");
  assert.equal(eligibility.payload.contact, undefined, "管理部门不可见联系方式");
  assert.equal(comment.payload.observations, undefined, "管理部门不可见评语原文");
  // 但结论性事件仍在
  assert.ok(seen.find((e) => e.event_id === "demo-assessment-001"));
  assert.ok(seen.find((e) => e.event_id === "demo-subsidy-employ"));
});

test("当前在带师傅可见评语原文与学员历程", async () => {
  const events = await scenario();
  const seen = redactEvents(events, { role: VIEWER_ROLES.STUDIO_MENTOR, party_id: I.CHEN });
  const comment = seen.find((e) => e.event_id === "demo-comment-001");
  assert.ok(typeof comment.payload.observations === "string");
});

test("access 对象对未同意机构拒绝联系方式", async () => {
  const events = await scenario();
  const access = createAccess(events, { role: VIEWER_ROLES.SCHOOL, party_id: "org:somewhere" });
  assert.equal(access.canViewContact(I.P), false);
});
