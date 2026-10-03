/**
 * 老字号技艺传习履历 —— 跨机构领域事件定义。
 *
 * 三类语义绝不互换：
 * - 学校的课时与成绩（SCHOOL_GRADE_RECORDED）
 * - 传承人的手上确认与观察性评语（CORE_STEP_CONFIRMED / MASTER_NARRATIVE_RECORDED）
 * - 门店的工序上岗授权（PROCESS_AUTHORIZATION_GRANTED）
 */

export type PartyRole = "master" | "school" | "store" | "center" | "learner";

export interface PartyRef {
  org_code: string;
  person_id?: string;
  role: PartyRole;
  signature_algorithm?: "Ed25519" | "none";
}

export type EventType =
  | "ENROLLMENT_ELIGIBILITY_RECORDED"
  | "APPRENTICESHIP_STARTED"
  | "APPRENTICESHIP_ENDED"
  | "MASTER_QUALIFICATION_REGISTERED"
  | "COURSE_REVISION_PUBLISHED"
  | "SCHOOL_GRADE_RECORDED"
  | "PRACTICE_RECORDED"
  | "WORK_BATCH_SUBMITTED"
  | "CORE_STEP_CONFIRMED"
  | "MASTER_NARRATIVE_RECORDED"
  | "SAFETY_EXAM_PASSED"
  | "PROCESS_AUTHORIZATION_GRANTED"
  | "PROCESS_AUTHORIZATION_REVOKED"
  | "TRIAL_EMPLOYMENT_VERIFIED"
  | "PLACEMENT_VERIFIED"
  | "STAGE_CERTIFICATE_ISSUED"
  | "ACCESS_GRANTED";

export type AggregateType =
  | "learner"
  | "apprenticeship"
  | "master_qualification"
  | "course_revision"
  | "school_record"
  | "safety_exam"
  | "practice_evidence"
  | "work_batch"
  | "work_authorization"
  | "placement"
  | "stage_certificate"
  | "access_grant";

/** 观察性评语：只有文字与观察维度，不允许出现任何分数字段。 */
export interface MasterNarrativePayload {
  learner_id: string;
  apprenticeship_id: string;
  master_id: string;
  observed_at: string;
  aspects: string[];
  narrative_text: string;
  batch_id?: string;
}

/** 核心工序步骤确认：仅在资质有效期内、覆盖该工序的在册传承人可出具。 */
export interface CoreStepConfirmationPayload {
  learner_id: string;
  apprenticeship_id: string;
  process_code: string;
  step_code: string;
  batch_id?: string;
  master_id: string;
  qualification_id: string;
  confirmed_at: string;
  result: "pass";
}

export interface ProcessAuthorizationPayload {
  learner_id: string;
  process_code: string;
  /** 被允许独立承担的核心步骤；每一项都须有合格传承人确认在先。 */
  step_codes: string[];
  scope: "independent" | "supervised";
  authorized_at: string;
  valid_until?: string;
  granted_by_org: string;
  based_on: {
    safety_exam_id: string;
    core_step_confirmation_ids: string[];
    apprenticeship_id: string;
  };
}

/** 领域事件公共信封，业务数据统一置于 payload。 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  event_id: string;
  prev_event_id?: string;
  event_type: EventType | string;
  aggregate_type: AggregateType | string;
  aggregate_id: string;
  occurred_at: string;
  version: number;
  summary: string;
  recorded_by: PartyRef;
  payload?: TPayload;
  /** 出具方对事件的签名（Ed25519，签名内容为不含本字段的规范化 JSON）。 */
  signature?: string;
}
