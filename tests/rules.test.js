import test from "node:test";
import assert from "node:assert/strict";

import { validateEvent } from "../src/validator.js";
import { ValidationError } from "../src/service.js";
import { newLedger } from "./helpers.js";

const P = "p:linxia";
const STUDIO = "studio:duyun";
const SCHOOL = "org:jincheng";
const SHOP = "shop:ruiyun";
const ZHAO = "m:zhaoli";
const CHEN = "m:chenbaoshan";
const CHEN_CRED = "cred:chen_001";
const SUN_CRED = "cred:sun_001";
const CRAFT = "metal_repousse";
const PICKLE = "pickle_packing";

let seq = 0;
const at = (day, hm = "10:00") => `2026-09-${String(day).padStart(2, "0")}T${hm}:00+08:00`;

/** 构造一条结构合法的事件（version 自动分配）。 */
function evt(type, aggId, occurredAt, summary, payload, policy = {}, extra = {}) {
  return {
    event_id: `t-${type}-${++seq}`,
    event_type: type,
    aggregate_type: undefined,
    aggregate_id: aggId,
    occurred_at: occurredAt,
    summary,
    policy_context: { sensitivity: "standard", visibility: "restricted", ...policy },
    payload,
    ...extra,
  };
}

/** 记录到授权为止的完整合法前置链；返回各事件 id。 */
async function seedHappyPath(ledger, { craft = CRAFT, cred = CHEN_CRED, confirmer = CHEN, core = "mr:chase", nonCore = "mr:hammer" } = {}) {
  const ids = {};
  const add = (key, e) => (ids[key] = ledger.record(e).event_id);

  add("eligibility", evt("ENROLLMENT_ELIGIBILITY_DECIDED", "app:1", at(1), "资格", {
    actor_id: "official:fang", reason: "r", person_id: P, decision: "eligible", craft_id: craft,
  }));
  add("enrollment", evt("ENROLLMENT_CONFIRMED", "app:1", at(2), "报名", {
    actor_id: "official:fang", reason: "r", person_id: P, decision: "confirmed", craft_id: craft,
    effective_from: at(2),
  }, {}, { reference_ids: [ids.eligibility] }));
  add("mentor", evt("MENTORSHIP_LINKED", "men:1", at(3), "师徒", {
    actor_id: STUDIO, reason: "r", person_id: P, mentor_id: ZHAO, craft_id: craft, effective_from: at(3),
  }));
  add("practice", evt("PRACTICE_RECORDED", "pra:1", at(4), "练习", {
    actor_id: ZHAO, reason: "r", person_id: P, craft_id: craft, step_ids: [nonCore, core],
    core_step_ids: [core], confirmed_by_inheritor_id: confirmer, inheritor_credential_id: cred, hours: 4,
  }));
  add("safety", evt("SAFETY_EXAM_PASSED", "saf:1", at(5), "安全", {
    actor_id: SCHOOL, reason: "r", person_id: P, decision: "passed", craft_id: craft,
    score: { score_kind: "safety_exam", value: 90, scale_max: 100, pass_threshold: 60 },
  }, { visibility: "public_verifiable" }));
  add("assessment", evt("ASSESSMENT_SIGNED", "ass:1", at(6), "结业考核", {
    actor_id: confirmer, reason: "r", person_id: P, craft_id: craft, decision: "completed",
    step_ids: [nonCore], core_step_ids: [core],
    confirmed_by_inheritor_id: confirmer, inheritor_credential_id: cred, effective_from: at(6),
    score: { score_kind: "course_grade", value: 85, scale_max: 100 },
  }, { visibility: "public_verifiable" }));
  return ids;
}

const grantEvent = (craft, steps, occurredAt = at(7), overrides = {}) =>
  evt("AUTHORIZATION_GRANTED", "auth:1", occurredAt, "授权", {
    actor_id: CHEN, reason: "r", person_id: P, craft_id: craft, decision: "granted",
    authorized_step_ids: steps, scope: "独立上岗",
    confirmed_by_inheritor_id: CHEN, inheritor_credential_id: CHEN_CRED, effective_from: occurredAt,
    ...overrides,
  }, { visibility: "public_verifiable" });

test("红线A：师傅观察性评语携带分数会被结构层拒绝", () => {
  const bad = evt("MASTER_COMMENT_ISSUED", "com:1", at(4), "评语", {
    actor_id: CHEN, reason: "r", person_id: P, observations: "手感尚需练习",
    scoring_forbidden_reason: "长期观察不宜分数化", score: { score_kind: "course_grade", value: 80, scale_max: 100 },
  });
  const errors = validateEvent(bad);
  assert.ok(errors.some((e) => e.includes("观察性评语禁止携带 score")), errors.join(";"));
});

test("红线A：缺少 scoring_forbidden_reason 的评语被拒绝", () => {
  const bad = evt("MASTER_COMMENT_ISSUED", "com:1", at(4), "评语", {
    actor_id: CHEN, reason: "r", person_id: P, observations: "叙述",
  });
  assert.ok(validateEvent(bad).some((e) => e.includes("scoring_forbidden_reason")));
});

test("红线A：非考核事件出现 score 被拒绝", () => {
  const bad = evt("PRACTICE_RECORDED", "pra:x", at(4), "练习", {
    actor_id: ZHAO, reason: "r", person_id: P, craft_id: CRAFT, step_ids: ["mr:anneal"],
    score: { score_kind: "course_grade", value: 70, scale_max: 100 },
  });
  assert.ok(validateEvent(bad).some((e) => e.includes("不允许 score")));
});

test("红线B：触及核心步骤但无传承人确认被拒绝", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  const bad = evt("PRACTICE_RECORDED", "pra:noconfirm", at(8), "无确认核心练习", {
    actor_id: ZHAO, reason: "r", person_id: P, craft_id: CRAFT,
    step_ids: ["mr:chase"], core_step_ids: ["mr:chase"],
  });
  assert.throws(() => ledger.record(bad), (e) => e instanceof ValidationError && /具资格传承人确认/.test(e.message));
});

test("红线B：带教师傅（赵丽，无传承人资格）不能确认核心步骤", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  const bad = evt("PRACTICE_RECORDED", "pra:zhao", at(8), "赵丽越权确认", {
    actor_id: ZHAO, reason: "r", person_id: P, craft_id: CRAFT, step_ids: ["mr:chase"], core_step_ids: ["mr:chase"],
    confirmed_by_inheritor_id: ZHAO, inheritor_credential_id: CHEN_CRED, // 凭证持有人是陈宝善，与确认人不一致
  });
  assert.throws(() => ledger.record(bad), /确认人与传承人资格凭证持有人不一致/);
});

test("红线B：凭证不覆盖该工序时确认核心步骤被拒绝", async () => {
  const { ledger } = await newLedger();
  // 用酱菜工序链路，但拿金属雕錾凭证确认酱菜核心步骤
  await seedHappyPath(ledger, { craft: PICKLE, cred: SUN_CRED, confirmer: "m:sundehai", core: "pp:brine", nonCore: "pp:pack" });
  // 到这里凭证是对的；再造一条金属凭证确认酱菜核心步骤
  const bad = evt("PRACTICE_RECORDED", "pra:cross", at(8), "跨工序凭证", {
    actor_id: CHEN, reason: "r", person_id: P, craft_id: PICKLE, step_ids: ["pp:seal"], core_step_ids: ["pp:seal"],
    confirmed_by_inheritor_id: CHEN, inheritor_credential_id: CHEN_CRED,
  });
  assert.throws(() => ledger.record(bad), /不覆盖工序/);
});

test("红线B：非核心步骤无需传承人确认即可记录", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  const ok = evt("PRACTICE_RECORDED", "pra:noncore", at(8), "普通练习", {
    actor_id: ZHAO, reason: "r", person_id: P, craft_id: CRAFT, step_ids: ["mr:anneal", "mr:polish"],
  });
  assert.doesNotThrow(() => ledger.record(ok));
});

test("红线C：缺少安全考核时门店授权被拒绝", async () => {
  const { ledger } = await newLedger();
  const ids = await seedHappyPath(ledger);
  // 构造一条没有安全考核的新学员
  const p2 = "p:other";
  ledger.record(evt("ENROLLMENT_ELIGIBILITY_DECIDED", "app:2", at(1), "资格", {
    actor_id: "official:fang", reason: "r", person_id: p2, decision: "eligible", craft_id: CRAFT,
  }));
  ledger.record(evt("ENROLLMENT_CONFIRMED", "app:2", at(2), "报名", {
    actor_id: "official:fang", reason: "r", person_id: p2, decision: "confirmed", craft_id: CRAFT, effective_from: at(2),
  }));
  ledger.record(evt("ASSESSMENT_SIGNED", "ass:2", at(6), "仅结业", {
    actor_id: CHEN, reason: "r", person_id: p2, craft_id: CRAFT, decision: "completed",
    core_step_ids: ["mr:chase"], confirmed_by_inheritor_id: CHEN, inheritor_credential_id: CHEN_CRED, effective_from: at(6),
  }, { visibility: "public_verifiable" }));
  const g = grantEvent(CRAFT, ["mr:chase"], at(7));
  g.payload.person_id = p2;
  assert.throws(() => ledger.record(g), /安全考核/);
});

test("红线C：只有学校结业、没有授权事件，不算可独立上岗", async () => {
  const { ledger, store } = await newLedger();
  await seedHappyPath(ledger);
  const grants = store.events.filter((e) => e.event_type === "AUTHORIZATION_GRANTED");
  assert.equal(grants.length, 0);
});

test("红线C：授权未经传承人考核覆盖的核心步骤被拒绝", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger); // 考核只覆盖 mr:chase
  const g = grantEvent(CRAFT, ["mr:chase", "mr:polish"], at(7));
  // mr:polish 是非核心且无练习/考核支撑
  assert.throws(() => ledger.record(g), /缺少练习或考核记录支撑/);
});

test("红线C：满足全部前置时授权成功，且授权人须具资格", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  assert.doesNotThrow(() => ledger.record(grantEvent(CRAFT, ["mr:chase", "mr:hammer"], at(7))));
});

test("红线C：授权确认人资格过期/停用时被拒绝", async () => {
  const { ledger, directory } = await newLedger();
  await seedHappyPath(ledger);
  directory.data.credentials[0].status = "revoked";
  assert.throws(() => ledger.record(grantEvent(CRAFT, ["mr:chase", "mr:hammer"], at(7))), /资格不成立|状态非 active/);
});

test("报名确认前必须先有合格的资格审核", async () => {
  const { ledger } = await newLedger();
  assert.throws(
    () => ledger.record(evt("ENROLLMENT_CONFIRMED", "app:x", at(2), "报名", {
      actor_id: "official:fang", reason: "r", person_id: P, decision: "confirmed", craft_id: CRAFT, effective_from: at(2),
    })),
    /ENROLLMENT_ELIGIBILITY_DECIDED/,
  );
});

test("联系方式记录前必须有学员同意", async () => {
  const { ledger } = await newLedger();
  const withContact = evt("ENROLLMENT_ELIGIBILITY_DECIDED", "app:c", at(1), "资格", {
    actor_id: "official:fang", reason: "r", person_id: P, decision: "eligible", craft_id: CRAFT,
    contact: { phone: "138-0000-0000" },
  }, { sensitivity: "standard_with_contact" });
  assert.throws(() => ledger.record(withContact), /CONTACT_POLICY_ACKNOWLEDGED/);
});

test("未公开作品批次必须标记 protected_work + restricted", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  const bad = evt("WORK_BATCH_SUBMITTED", "batch:1", at(8), "私作", {
    actor_id: P, reason: "r", person_id: P, craft_id: CRAFT, batch_id: "b1", is_public: false,
    work_titles: ["秘作"],
  }, { sensitivity: "standard", visibility: "restricted" });
  assert.throws(() => ledger.record(bad), /protected_work/);
});

test("岗位试用判定独立上岗但无有效授权时被拒绝", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  ledger.record(evt("TRIAL_ARRANGED", "trial:1", at(8), "试用安排", {
    actor_id: SHOP, reason: "r", person_id: P, shop_id: SHOP, craft_id: CRAFT, effective_from: at(8),
  }));
  assert.throws(() => ledger.record(evt("TRIAL_EVALUATED", "trial:1", at(9), "试用评定", {
    actor_id: SHOP, reason: "r", person_id: P, shop_id: SHOP, craft_id: CRAFT, trial_result: "independent_ready",
  })), /门店授权/);
});

test("补助缺少证据事件被拒绝", async () => {
  const { ledger } = await newLedger();
  await seedHappyPath(ledger);
  const bad = evt("SUBSIDY_DISBURSED", "sub:1", at(9), "补助", {
    actor_id: "official:fang", reason: "r", person_id: P,
    subsidy: { amount: 1000, currency: "CNY", stage: "training", evidence_event_ids: [] },
  });
  assert.throws(() => ledger.record(bad), /evidence_event_ids/);
});

test("就业补助引用未就业记录被拒绝", async () => {
  const { ledger } = await newLedger();
  const ids = await seedHappyPath(ledger);
  const notEmployed = ledger.record(evt("PLACEMENT_VERIFIED", "pla:1", at(8), "未就业", {
    actor_id: "official:fang", reason: "r", person_id: P, employment_status: "not_employed",
  }));
  const bad = evt("SUBSIDY_DISBURSED", "sub:2", at(9), "就业补助", {
    actor_id: "official:fang", reason: "r", person_id: P,
    subsidy: { amount: 3000, currency: "CNY", stage: "employment", evidence_event_ids: [notEmployed.event_id] },
  });
  assert.throws(() => ledger.record(bad), /就业证据须为受雇或自营/);
});
