import assert from "node:assert/strict";
import test from "node:test";

import { validateStream } from "../src/validator.js";
import { buildStream, LEARNER } from "./fixtures.js";

/** 深拷贝事件数组，便于在合法流上制造单点违规。 */
function clone(events) {
  return structuredClone(events);
}

function byId(events, id) {
  return events.find((e) => e.event_id === id);
}

function codesFor(events, eventId) {
  return validateStream(events).filter((e) => e.event_id === eventId).map((e) => e.code);
}

test("全链路合法样例：无任何不变量违规", () => {
  const errors = validateStream(buildStream());
  assert.deepEqual(errors, [], errors.map((e) => `${e.code}: ${e.message}`).join("\n"));
});

test("红线：无报名资格不得建立师承", () => {
  const events = clone(buildStream()).filter((e) => e.event_id !== "EV-L001-ENROLL");
  // 去掉资格事件后，师承成为链首，去掉其 prev 指针（本就没有）
  assert.ok(codesFor(events, "EV-L001-APPR-START").includes("NO_ELIGIBILITY"));
});

test("红线：核心步骤确认者必须是在册、资质有效、覆盖该工序的本师承师傅", () => {
  // 1) 资质不覆盖工序
  let events = clone(buildStream());
  byId(events, "EV-Q-M101-01").payload.process_codes = ["other-process"];
  assert.ok(codesFor(events, "EV-L001-CONFIRM-1").includes("QUALIFICATION_SCOPE"));

  // 2) 资质过期
  events = clone(buildStream());
  byId(events, "EV-Q-M101-01").payload.valid_until = "2026-09-01";
  assert.ok(codesFor(events, "EV-L001-CONFIRM-1").includes("QUALIFICATION_EXPIRED"));

  // 3) 资质不属于确认人
  events = clone(buildStream());
  byId(events, "EV-L001-CONFIRM-1").payload.master_id = "M-999";
  assert.ok(codesFor(events, "EV-L001-CONFIRM-1").includes("QUALIFICATION_OWNER"));

  // 4) 不是本师承关系的师傅（跨工作室偷签）
  events = clone(buildStream());
  byId(events, "EV-L001-CONFIRM-1").payload.master_id = "M-202";
  byId(events, "EV-L001-CONFIRM-1").payload.qualification_id = "QUAL-M202";
  assert.ok(codesFor(events, "EV-L001-CONFIRM-1").includes("MASTER_MISMATCH"));
});

test("红线：学校结业不自动等于门店授权——缺安全考核或缺确认都不能授权", () => {
  // 缺安全考核
  let events = clone(buildStream()).filter((e) => e.event_id !== "EV-L001-SAFE-1");
  assert.ok(codesFor(events, "EV-L001-AUTH-1").includes("NO_SAFETY_EXAM"));

  // 授权了一个没有传承人确认的步骤（即使学校成绩再好）
  events = clone(buildStream());
  byId(events, "EV-L001-AUTH-1").payload.step_codes.push("step-ferment");
  assert.ok(codesFor(events, "EV-L001-AUTH-1").includes("UNCONFIRMED_STEP"));

  // 拿学校成绩事件编号冒充确认依据
  events = clone(buildStream());
  byId(events, "EV-L001-AUTH-1").payload.based_on.core_step_confirmation_ids.push("EV-L001-GRADE-1");
  assert.ok(codesFor(events, "EV-L001-AUTH-1").includes("BAD_BASIS"));
});

test("红线：安全考核过期后不得授权", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-SAFE-1").payload.valid_until = "2026-10-01";
  assert.ok(codesFor(events, "EV-L001-AUTH-1").includes("SAFETY_EXPIRED"));
});

test("红线：岗位试用必须引用真实且工序一致的授权", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-TRIAL-1").payload.authorization_id = "EV-L001-GRADE-1";
  assert.ok(codesFor(events, "EV-L001-TRIAL-1").includes("NO_AUTHORIZATION"));
});

test("接替：旧师承不存在时接替非法；正常接替后旧履历仍可引用", () => {
  let events = clone(buildStream());
  delete byId(events, "EV-L001-APPR-START-B").payload.supersedes_apprenticeship_id;
  // 不声明接替时新师承本身合法——改成指向不存在的关系：
  events = clone(buildStream());
  byId(events, "EV-L001-APPR-START-B").payload.supersedes_apprenticeship_id = "APPR-GHOST";
  assert.ok(codesFor(events, "EV-L001-APPR-START-B").includes("SUPERSEDE_MISSING"));

  // 正常流：旧师承的练习与确认在旧关系终止前发生，全部合法
  const errors = validateStream(buildStream());
  assert.deepEqual(errors, []);
});

test("师承终止后不能再往旧关系上记练习或确认", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-APPR-END-A").payload.ended_at = "2026-09-20";
  assert.ok(codesFor(events, "EV-L001-PRAC-1").includes("APPRENTICESHIP_INACTIVE"));
  assert.ok(codesFor(events, "EV-L001-CONFIRM-1").includes("APPRENTICESHIP_INACTIVE"));
});

test("课程版本：成绩必须挂在已发布且版本号一致的课程版本上", () => {
  let events = clone(buildStream());
  byId(events, "EV-L001-GRADE-1").payload.revision_version = 2;
  assert.ok(codesFor(events, "EV-L001-GRADE-1").includes("REVISION_MISMATCH"));

  events = clone(buildStream()).filter((e) => e.event_id !== "EV-C201-V3");
  assert.ok(codesFor(events, "EV-L001-GRADE-1").includes("REVISION_MISSING"));
});

test("哈希链：删事件或改 prev 指针都会断链", () => {
  // 删掉中间一条确认事件
  let events = clone(buildStream()).filter((e) => e.event_id !== "EV-L001-CONFIRM-1");
  // 同时把后继者的 prev 修正指向更早事件——制造"静默删除"
  byId(events, "EV-L001-CONFIRM-2").prev_event_id = "EV-L001-BATCH-1";
  // 授权依据仍引用已删除事件
  assert.ok(codesFor(events, "EV-L001-AUTH-1").includes("BAD_BASIS"));

  // 直接改断 prev
  events = clone(buildStream());
  byId(events, "EV-L001-PRAC-1").prev_event_id = "EV-GHOST";
  assert.ok(
    validateStream(events).some(
      (e) => e.code === "CHAIN_MISSING" || e.code === "CHAIN_BROKEN"
    )
  );
});

test("时间线：事件时间倒流被拒绝", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-GRADE-1").occurred_at = "2020-01-01T00:00:00+08:00";
  assert.ok(codesFor(events, "EV-L001-GRADE-1").includes("TIME_ORDER"));
});

test("聚合版本号必须在聚合内连续递增", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-PLACE-1").version = 9;
  assert.ok(codesFor(events, "EV-L001-PLACE-1").includes("VERSION_GAP"));
});

test("就业去向引用的试用核验必须存在", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-PLACE-1").payload.trial_verification_id = "EV-GHOST";
  assert.ok(codesFor(events, "EV-L001-PLACE-1").includes("NO_TRIAL"));
});

test("事件 event_id 不得重复", () => {
  const events = clone(buildStream());
  byId(events, "EV-L001-PRAC-1").event_id = "EV-L001-GRADE-1";
  assert.ok(validateStream(events).some((e) => e.code === "DUP_EVENT"));
});
