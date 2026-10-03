/**
 * 领域词汇：事件类型、聚合类型、敏感度、各事件的聚合归属与负载形状。
 * 这是 contracts/domain.schema.json 在运行时的唯一事实来源，validator/rules 都引用它。
 */

export const EVENT_TYPES = Object.freeze({
  ENROLLMENT_ELIGIBILITY_DECIDED: "ENROLLMENT_ELIGIBILITY_DECIDED",
  ENROLLMENT_CONFIRMED: "ENROLLMENT_CONFIRMED",
  MENTORSHIP_LINKED: "MENTORSHIP_LINKED",
  MENTORSHIP_ENDED: "MENTORSHIP_ENDED",
  COURSE_REVISION_PUBLISHED: "COURSE_REVISION_PUBLISHED",
  PRACTICE_RECORDED: "PRACTICE_RECORDED",
  WORK_BATCH_SUBMITTED: "WORK_BATCH_SUBMITTED",
  MASTER_COMMENT_ISSUED: "MASTER_COMMENT_ISSUED",
  SAFETY_EXAM_PASSED: "SAFETY_EXAM_PASSED",
  ASSESSMENT_SIGNED: "ASSESSMENT_SIGNED",
  AUTHORIZATION_GRANTED: "AUTHORIZATION_GRANTED",
  AUTHORIZATION_REVOKED: "AUTHORIZATION_REVOKED",
  TRIAL_ARRANGED: "TRIAL_ARRANGED",
  TRIAL_EVALUATED: "TRIAL_EVALUATED",
  PLACEMENT_VERIFIED: "PLACEMENT_VERIFIED",
  SUBSIDY_DISBURSED: "SUBSIDY_DISBURSED",
  CONTACT_POLICY_ACKNOWLEDGED: "CONTACT_POLICY_ACKNOWLEDGED",
  STAGE_CERTIFICATE_ISSUED: "STAGE_CERTIFICATE_ISSUED",
  RELATIONSHIP_SUPERSEDED: "RELATIONSHIP_SUPERSEDED",
});

export const AGGREGATE_TYPES = Object.freeze({
  PERSON: "person",
  APPRENTICESHIP: "apprenticeship",
  MENTORSHIP: "mentorship",
  COURSE_REVISION: "course_revision",
  PRACTICE_EVIDENCE: "practice_evidence",
  WORK_BATCH: "work_batch",
  MASTER_COMMENT: "master_comment",
  SAFETY_EXAM: "safety_exam",
  SKILL_ASSESSMENT: "skill_assessment",
  WORK_AUTHORIZATION: "work_authorization",
  JOB_TRIAL: "job_trial",
  PLACEMENT: "placement",
  SUBSIDY: "subsidy",
  CONSENT: "consent",
  STAGE_CERTIFICATE: "stage_certificate",
});

export const SENSITIVITY = Object.freeze({
  STANDARD: "standard",
  WITH_CONTACT: "standard_with_contact",
  PROTECTED_WORK: "protected_work",
});

export const VISIBILITY = Object.freeze({
  PUBLIC_VERIFIABLE: "public_verifiable",
  RESTRICTED: "restricted",
});

/** 观察者角色 —— 决定其能看到的字段范围。 */
export const VIEWER_ROLES = Object.freeze({
  SELF: "self", // 学员本人
  STUDIO_MENTOR: "studio_mentor", // 大师工作室 / 师傅
  SCHOOL: "school", // 技能学校
  SHOP: "shop", // 门店（判断可独立承担的工序）
  DISTRICT: "district", // 街区文化产业服务中心（管理/政策核验，最小化）
  FISCAL: "fiscal", // 财政（补助核验，最小化）
  PUBLIC: "public", // 持验证信息者
});

/** 每个事件归属的聚合类型。 */
export const EVENT_AGGREGATE = Object.freeze({
  ENROLLMENT_ELIGIBILITY_DECIDED: AGGREGATE_TYPES.APPRENTICESHIP,
  ENROLLMENT_CONFIRMED: AGGREGATE_TYPES.APPRENTICESHIP,
  MENTORSHIP_LINKED: AGGREGATE_TYPES.MENTORSHIP,
  MENTORSHIP_ENDED: AGGREGATE_TYPES.MENTORSHIP,
  COURSE_REVISION_PUBLISHED: AGGREGATE_TYPES.COURSE_REVISION,
  PRACTICE_RECORDED: AGGREGATE_TYPES.PRACTICE_EVIDENCE,
  WORK_BATCH_SUBMITTED: AGGREGATE_TYPES.WORK_BATCH,
  MASTER_COMMENT_ISSUED: AGGREGATE_TYPES.MASTER_COMMENT,
  SAFETY_EXAM_PASSED: AGGREGATE_TYPES.SAFETY_EXAM,
  ASSESSMENT_SIGNED: AGGREGATE_TYPES.SKILL_ASSESSMENT,
  AUTHORIZATION_GRANTED: AGGREGATE_TYPES.WORK_AUTHORIZATION,
  AUTHORIZATION_REVOKED: AGGREGATE_TYPES.WORK_AUTHORIZATION,
  TRIAL_ARRANGED: AGGREGATE_TYPES.JOB_TRIAL,
  TRIAL_EVALUATED: AGGREGATE_TYPES.JOB_TRIAL,
  PLACEMENT_VERIFIED: AGGREGATE_TYPES.PLACEMENT,
  SUBSIDY_DISBURSED: AGGREGATE_TYPES.SUBSIDY,
  CONTACT_POLICY_ACKNOWLEDGED: AGGREGATE_TYPES.CONSENT,
  STAGE_CERTIFICATE_ISSUED: AGGREGATE_TYPES.STAGE_CERTIFICATE,
  RELATIONSHIP_SUPERSEDED: AGGREGATE_TYPES.APPRENTICESHIP,
});

/**
 * 各事件的负载形状约定。
 * required：payload 必填键；optional：可选键。
 * validator 用它做结构性校验，rules 用它做跨事件语义校验。
 */
export const PAYLOAD_SHAPES = Object.freeze({
  ENROLLMENT_ELIGIBILITY_DECIDED: {
    required: ["actor_id", "reason", "person_id", "decision"],
    optional: ["studio_id", "school_id", "craft_id", "contact"],
  },
  ENROLLMENT_CONFIRMED: {
    required: ["actor_id", "reason", "person_id", "decision", "effective_from"],
    optional: ["studio_id", "school_id", "craft_id"],
  },
  MENTORSHIP_LINKED: {
    required: ["actor_id", "reason", "person_id", "mentor_id", "craft_id", "effective_from"],
    optional: ["studio_id"],
  },
  MENTORSHIP_ENDED: {
    required: ["actor_id", "reason", "exit_reason", "effective_until"],
    optional: ["new_aggregate_id"],
  },
  COURSE_REVISION_PUBLISHED: {
    required: ["actor_id", "reason", "school_id", "craft_id"],
    optional: ["supersedes_course_revision_id", "effective_from", "modules"],
  },
  PRACTICE_RECORDED: {
    required: ["actor_id", "reason", "person_id", "craft_id", "step_ids"],
    optional: [
      "course_revision_id",
      "mentor_id",
      "core_step_ids",
      "confirmed_by_inheritor_id",
      "inheritor_credential_id",
      "hours",
      "attribution",
    ],
  },
  WORK_BATCH_SUBMITTED: {
    required: ["actor_id", "reason", "person_id", "craft_id", "batch_id", "is_public"],
    optional: ["work_titles", "step_ids", "core_step_ids", "confirmed_by_inheritor_id", "inheritor_credential_id", "mentor_id", "attribution"],
  },
  MASTER_COMMENT_ISSUED: {
    required: ["actor_id", "reason", "person_id", "observations", "scoring_forbidden_reason"],
    optional: ["mentor_id", "craft_id", "batch_id"],
  },
  SAFETY_EXAM_PASSED: {
    required: ["actor_id", "reason", "person_id", "decision", "score"],
    optional: ["craft_id", "school_id", "effective_from"],
  },
  ASSESSMENT_SIGNED: {
    required: ["actor_id", "reason", "person_id", "craft_id", "decision", "confirmed_by_inheritor_id", "inheritor_credential_id"],
    optional: ["core_step_ids", "step_ids", "score", "course_revision_id", "effective_from"],
  },
  AUTHORIZATION_GRANTED: {
    required: [
      "actor_id",
      "reason",
      "person_id",
      "craft_id",
      "decision",
      "authorized_step_ids",
      "scope",
      "confirmed_by_inheritor_id",
      "inheritor_credential_id",
      "effective_from",
    ],
    optional: ["effective_until"],
  },
  AUTHORIZATION_REVOKED: {
    required: ["actor_id", "reason", "person_id", "craft_id", "decision", "effective_from"],
    optional: ["revoked_step_ids"],
  },
  TRIAL_ARRANGED: {
    required: ["actor_id", "reason", "person_id", "shop_id", "craft_id", "effective_from"],
    optional: ["trial_step_ids"],
  },
  TRIAL_EVALUATED: {
    required: ["actor_id", "reason", "person_id", "trial_result"],
    optional: ["shop_id", "craft_id", "observations"],
  },
  PLACEMENT_VERIFIED: {
    required: ["actor_id", "reason", "person_id", "employment_status"],
    optional: ["employer_name", "shop_id", "craft_id", "effective_from"],
  },
  SUBSIDY_DISBURSED: {
    required: ["actor_id", "reason", "person_id", "subsidy"],
    optional: [],
  },
  CONTACT_POLICY_ACKNOWLEDGED: {
    required: ["actor_id", "reason", "person_id", "decision"],
    optional: ["contact", "effective_from", "allowed_party_ids"],
  },
  STAGE_CERTIFICATE_ISSUED: {
    required: ["actor_id", "reason", "person_id", "certificate"],
    optional: [],
  },
  RELATIONSHIP_SUPERSEDED: {
    required: ["actor_id", "reason", "exit_reason", "new_aggregate_id", "effective_from"],
    optional: [],
  },
});

/** 允许携带数值成绩的事件（白名单）；其余事件一律禁止 score。 */
export const SCORABLE_EVENTS = Object.freeze(new Set(["SAFETY_EXAM_PASSED", "ASSESSMENT_SIGNED"]));
