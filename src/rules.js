/**
 * 跨事件语义不变量（依赖历史事件与名录）。
 *
 * 三条业务红线：
 *  A. 观察性评语不得伪装成分数（结构层在 validator 处理）。
 *  B. 传统工序的核心步骤，只能由具备有效资格、且覆盖该工序的传承人确认。
 *  C. 学校结业不自动等于门店授权：独立上岗必须另有 AUTHORIZATION_GRANTED，且有安全+传承人考核前置。
 * 此外：培训补助必须能对应到真实的学习/考核/就业证据。
 */

const personHistory = (store, personId) => store.byPerson(personId);
const byType = (events, type) => events.filter((e) => e.event_type === type);

/**
 * @param {object} event 待追加事件（已通过 validateEvent 结构校验）
 * @param {{store: import('./store.js').EventStore, directory: import('./directory.js').Directory}} ctx
 * @returns {string[]} 错误信息，空数组表示通过。
 */
export function checkSemantics(event, { store, directory }) {
  const errors = [];
  const p = event.payload ?? {};
  const at = event.occurred_at;

  checkReferences(event, store, errors);
  checkSensitivity(event, errors);

  switch (event.event_type) {
    case "ENROLLMENT_CONFIRMED":
      requirePriorDecision(event, store, "ENROLLMENT_ELIGIBILITY_DECIDED", "eligible", errors);
      break;
    case "MENTORSHIP_LINKED":
      checkMentor(p, directory, errors);
      break;
    case "MENTORSHIP_ENDED":
      requireLifecycleStart(event, store, "MENTORSHIP_LINKED", errors);
      break;
    case "COURSE_REVISION_PUBLISHED":
      if (p.supersedes_course_revision_id) {
        const oldRev = store.byAggregate(p.supersedes_course_revision_id).some(
          (e) => e.event_type === "COURSE_REVISION_PUBLISHED",
        );
        if (!oldRev) errors.push(`被替代的课程版本不存在：${p.supersedes_course_revision_id}`);
      }
      break;
    case "PRACTICE_RECORDED":
      checkStepsBelongToCraft(p, directory, errors);
      checkCoreConfirmation(event, directory, errors);
      checkCourseRevision(p, store, errors);
      break;
    case "WORK_BATCH_SUBMITTED":
      checkStepsBelongToCraft(p, directory, errors);
      checkCoreConfirmation(event, directory, errors);
      break;
    case "ASSESSMENT_SIGNED":
      checkStepsBelongToCraft(p, directory, errors);
      checkCoreConfirmation(event, directory, errors, { requireCore: true });
      break;
    case "SAFETY_EXAM_PASSED":
      if (p.decision !== "passed") errors.push("SAFETY_EXAM_PASSED 的 decision 必须为 passed（未通过请不要记录为通过事件）");
      if (p.score?.pass_threshold !== undefined && p.score.value < p.score.pass_threshold) {
        errors.push("安全考核分数低于合格线，不能记为通过");
      }
      break;
    case "AUTHORIZATION_GRANTED":
      checkAuthorization(event, { store, directory }, errors);
      break;
    case "AUTHORIZATION_REVOKED":
      requireLifecycleStart(event, store, "AUTHORIZATION_GRANTED", errors);
      break;
    case "TRIAL_EVALUATED":
      checkTrial(event, { store, directory }, errors);
      break;
    case "PLACEMENT_VERIFIED":
      if (["employed", "self_employed"].includes(p.employment_status) && !p.employer_name) {
        errors.push("就业去向为受雇/自营时必须填写 employer_name");
      }
      break;
    case "SUBSIDY_DISBURSED":
      checkSubsidy(event, store, errors);
      break;
    case "RELATIONSHIP_SUPERSEDED":
      if (p.new_aggregate_id === event.aggregate_id) {
        errors.push("新生效关系不能与被替代关系使用同一 aggregate_id");
      }
      break;
    default:
      break;
  }

  if (p.contact && !hasConsent(store, p.person_id, at)) {
    errors.push("记录联系方式前必须存在该学员有效的 CONTACT_POLICY_ACKNOWLEDGED 同意");
  }
  return errors;
}

/* ---------------- 具体规则 ---------------- */

function checkReferences(event, store, errors) {
  for (const ref of event.reference_ids ?? []) {
    const found = store.events.find((e) => e.event_id === ref);
    if (!found) {
      errors.push(`引用的记录不存在：${ref}`);
    } else if (new Date(found.occurred_at) > new Date(event.occurred_at)) {
      errors.push(`不能引用晚于本事件发生的记录：${ref}`);
    }
  }
}

function checkSensitivity(event, errors) {
  const pc = event.policy_context;
  const p = event.payload ?? {};
  if (p.contact && pc.sensitivity !== "standard_with_contact") {
    errors.push("含联系方式的记录 policy_context.sensitivity 必须为 standard_with_contact");
  }
  if (event.event_type === "WORK_BATCH_SUBMITTED" && p.is_public === false) {
    if (pc.sensitivity !== "protected_work" || pc.visibility !== "restricted") {
      errors.push("未公开作品批次必须标记为 sensitivity=protected_work 且 visibility=restricted");
    }
  }
}

function requirePriorDecision(event, store, type, expectedDecision, errors) {
  const personId = event.payload.person_id;
  const prior = byType(personHistory(store, personId), type).some(
    (e) => e.payload.decision === expectedDecision && new Date(e.occurred_at) <= new Date(event.occurred_at),
  );
  if (!prior) errors.push(`确认报名前必须先有 ${type} 且 decision=${expectedDecision}`);
}

function requireLifecycleStart(event, store, startType, errors) {
  const started = store.byAggregate(event.aggregate_id).some((e) => e.event_type === startType);
  if (!started) errors.push(`${event.event_type} 之前，同一关系必须先有 ${startType}`);
}

function checkMentor(p, directory, errors) {
  const mentor = directory.person(p.mentor_id);
  if (!mentor) {
    errors.push(`带教师傅不存在于名录：${p.mentor_id}`);
    return;
  }
  if (!["mentor", "inheritor"].includes(mentor.role)) {
    errors.push(`${p.mentor_id} 的角色 ${mentor.role} 不能作为带教师傅`);
  }
}

function checkStepsBelongToCraft(p, directory, errors) {
  const all = [...(p.step_ids ?? []), ...(p.core_step_ids ?? []), ...(p.authorized_step_ids ?? [])];
  const unknown = directory.unknownSteps(p.craft_id, all);
  if (unknown.length) errors.push(`步骤不属于工序 ${p.craft_id}：${[...new Set(unknown)].join("、")}`);
}

/**
 * 核心步骤传承人确认规则。
 * 只要记录触及核心步骤，就必须携带 confirmed_by_inheritor_id + 有效凭证，且凭证覆盖该工序。
 */
function checkCoreConfirmation(event, directory, errors, { requireCore = false } = {}) {
  const p = event.payload;
  const coreSet = directory.coreSteps(p.craft_id);
  const touched = [...(p.step_ids ?? []), ...(p.core_step_ids ?? [])];
  const touchedCore = touched.filter((s) => coreSet.has(s));

  if (!directory.craft(p.craft_id)) {
    errors.push(`工序不存在于名录：${p.craft_id}`);
    return;
  }
  if (requireCore && touchedCore.length === 0) {
    errors.push("传承人结业考核必须覆盖至少一个核心步骤");
  }
  if (touchedCore.length === 0) return;

  if (!p.confirmed_by_inheritor_id || !p.inheritor_credential_id) {
    errors.push(`触及核心步骤（${touchedCore.join("、")}）必须由具资格传承人确认并填写凭证`);
    return;
  }
  const check = directory.checkInheritorCredential(p.inheritor_credential_id, p.craft_id, event.occurred_at);
  if (!check.ok) {
    errors.push(`核心步骤确认资格不成立：${check.reason}`);
    return;
  }
  if (check.person_id !== p.confirmed_by_inheritor_id) {
    errors.push("确认人与传承人资格凭证持有人不一致");
  }
}

function checkCourseRevision(p, store, errors) {
  if (!p.course_revision_id) return;
  const rev = store.events.find(
    (e) => e.event_type === "COURSE_REVISION_PUBLISHED" && e.aggregate_id === p.course_revision_id,
  );
  if (!rev) {
    errors.push(`练习引用的课程版本不存在：${p.course_revision_id}`);
  } else if (rev.payload.craft_id !== p.craft_id) {
    errors.push("练习的工序与所引用课程版本的工序不一致");
  }
}

/**
 * 门店工序授权前置：
 *  - 安全考核通过；
 *  - 具资格传承人已签署结业考核；
 *  - 授权的每个核心步骤都在传承人考核覆盖范围内；
 *  - 授权的非核心步骤至少有练习或考核记录支撑；
 *  - 授权本身由具资格传承人确认。
 * 学校结业（ASSESSMENT_SIGNED）本身不产生授权。
 */
function checkAuthorization(event, { store, directory }, errors) {
  const p = event.payload;
  if (p.decision !== "granted") errors.push("AUTHORIZATION_GRANTED 的 decision 必须为 granted");
  if (p.scope !== "独立上岗" && !/独立/.test(p.scope ?? "")) {
    errors.push("授权 scope 必须明确为可独立承担（如「独立上岗」）");
  }

  const cred = directory.checkInheritorCredential(p.inheritor_credential_id, p.craft_id, event.occurred_at);
  if (!cred.ok) {
    errors.push(`授权确认资格不成立：${cred.reason}`);
  } else if (cred.person_id !== p.confirmed_by_inheritor_id) {
    errors.push("授权确认人与传承人资格凭证持有人不一致");
  }

  const history = personHistory(store, p.person_id);
  const safety = byType(history, "SAFETY_EXAM_PASSED").some(
    (e) => e.payload.craft_id === p.craft_id && e.payload.decision === "passed",
  );
  if (!safety) errors.push("授权前置不满足：缺少该工序的安全考核通过记录");

  const assessments = byType(history, "ASSESSMENT_SIGNED").filter(
    (e) =>
      e.payload.craft_id === p.craft_id &&
      e.payload.decision === "completed" &&
      new Date(e.occurred_at) <= new Date(event.occurred_at),
  );
  if (assessments.length === 0) {
    errors.push("授权前置不满足：缺少具资格传承人签署的结业考核（学校结业不自动授权）");
  }

  const assessedCore = new Set(assessments.flatMap((e) => e.payload.core_step_ids ?? []));
  const practiced = new Set(history.flatMap((e) => e.payload.step_ids ?? []));
  const assessedAll = new Set(assessments.flatMap((e) => [...(e.payload.step_ids ?? []), ...(e.payload.core_step_ids ?? [])]));
  const coreSet = directory.coreSteps(p.craft_id);

  for (const step of p.authorized_step_ids ?? []) {
    if (coreSet.has(step)) {
      if (!assessedCore.has(step)) {
        errors.push(`核心步骤 ${step} 未经传承人考核覆盖，不得授权独立上岗`);
      }
    } else if (!practiced.has(step) && !assessedAll.has(step)) {
      errors.push(`步骤 ${step} 缺少练习或考核记录支撑，不能授权`);
    }
  }
}

function checkTrial(event, { store, directory }, errors) {
  const p = event.payload;
  const arranged = personHistory(store, p.person_id)
    .filter((e) => e.event_type === "TRIAL_ARRANGED")
    .some((e) => (!p.craft_id || e.payload.craft_id === p.craft_id) && new Date(e.occurred_at) <= new Date(event.occurred_at));
  if (!arranged) errors.push("试用评定前必须先有 TRIAL_ARRANGED");

  if (p.trial_result === "independent_ready") {
    // 独立上岗结论必须有覆盖试岗核心步骤的有效授权。
    const trial = personHistory(store, p.person_id)
      .filter((e) => e.event_type === "TRIAL_ARRANGED")
      .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))[0];
    const craftId = p.craft_id ?? trial?.payload.craft_id;
    const grant = personHistory(store, p.person_id)
      .filter((e) => e.event_type === "AUTHORIZATION_GRANTED")
      .filter((e) => e.payload.craft_id === craftId && new Date(e.occurred_at) <= new Date(event.occurred_at))
      .some((e) => {
        const until = e.payload.effective_until ? new Date(e.payload.effective_until) : null;
        return !until || until >= new Date(event.occurred_at);
      });
    if (!grant) errors.push("判定可独立上岗前，必须存在该工序、在有效期内的门店授权");
  }
}

const SUBSIDY_REQUIRED = {
  enrollment: ["ENROLLMENT_CONFIRMED"],
  training: ["PRACTICE_RECORDED"],
  assessment: ["SAFETY_EXAM_PASSED", "ASSESSMENT_SIGNED"],
  employment: ["PLACEMENT_VERIFIED"],
};

function checkSubsidy(event, store, errors) {
  const p = event.payload;
  const { stage, evidence_event_ids: ids } = p.subsidy;
  if (!ids || ids.length === 0) {
    errors.push("补助必须附带 evidence_event_ids，将金额对应到学习/考核/就业记录");
    return;
  }
  const evidenceEvents = [];
  for (const id of ids) {
    const found = store.events.find((e) => e.event_id === id);
    if (!found) {
      errors.push(`补助证据事件不存在：${id}`);
      continue;
    }
    if (found.payload.person_id !== p.person_id) errors.push(`补助证据 ${id} 不属于该学员`);
    evidenceEvents.push(found);
  }
  const present = new Set(evidenceEvents.map((e) => e.event_type));
  for (const need of SUBSIDY_REQUIRED[stage]) {
    if (!present.has(need)) errors.push(`${stage} 阶段补助缺少证据类型：${need}`);
  }
  if (stage === "employment" && !evidenceEvents.some((e) => ["employed", "self_employed"].includes(e.payload.employment_status))) {
    errors.push("就业阶段补助的就业证据须为受雇或自营");
  }
  if (stage === "assessment" && !evidenceEvents.some((e) => e.event_type === "ASSESSMENT_SIGNED" && e.payload.decision === "completed")) {
    errors.push("考核阶段补助须有传承人签署的结业考核完成记录");
  }
}

function hasConsent(store, personId, at) {
  return personHistory(store, personId)
    .filter((e) => e.event_type === "CONTACT_POLICY_ACKNOWLEDGED")
    .some((e) => e.payload.decision === "acknowledged" && (!at || new Date(e.occurred_at) <= new Date(at)));
}
