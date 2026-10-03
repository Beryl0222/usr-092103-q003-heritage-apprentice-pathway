/**
 * 老字号技艺传习履历 —— 领域事件公共类型。
 * 运行时结构校验见 src/validator.js + src/vocabulary.js，二者保持同步。
 */

export type EventType =
  | "ENROLLMENT_ELIGIBILITY_DECIDED"
  | "ENROLLMENT_CONFIRMED"
  | "MENTORSHIP_LINKED"
  | "MENTORSHIP_ENDED"
  | "COURSE_REVISION_PUBLISHED"
  | "PRACTICE_RECORDED"
  | "WORK_BATCH_SUBMITTED"
  | "MASTER_COMMENT_ISSUED"
  | "SAFETY_EXAM_PASSED"
  | "ASSESSMENT_SIGNED"
  | "AUTHORIZATION_GRANTED"
  | "AUTHORIZATION_REVOKED"
  | "TRIAL_ARRANGED"
  | "TRIAL_EVALUATED"
  | "PLACEMENT_VERIFIED"
  | "SUBSIDY_DISBURSED"
  | "CONTACT_POLICY_ACKNOWLEDGED"
  | "STAGE_CERTIFICATE_ISSUED"
  | "RELATIONSHIP_SUPERSEDED";

export type AggregateType =
  | "person"
  | "apprenticeship"
  | "mentorship"
  | "course_revision"
  | "practice_evidence"
  | "work_batch"
  | "master_comment"
  | "safety_exam"
  | "skill_assessment"
  | "work_authorization"
  | "job_trial"
  | "placement"
  | "subsidy"
  | "consent"
  | "stage_certificate";

export type Sensitivity = "standard" | "standard_with_contact" | "protected_work";
export type Visibility = "public_verifiable" | "restricted";

/** 观察性评语与数值成绩分轨：score 仅允许出现在安全考核与结业考核。 */
export interface Score {
  score_kind: "safety_exam" | "course_grade";
  value: number;
  scale_max: number;
  pass_threshold?: number;
}

/** 师承署名：作品/练习中各方贡献，散落後仍可据此证明成长。 */
export interface Attribution {
  apprentice_contribution?: string;
  mentor_contribution?: string;
  under_supervision_of?: string;
}

export interface Contact {
  phone?: string;
  address?: string;
}

export interface Subsidy {
  amount: number;
  currency: "CNY";
  stage: "enrollment" | "training" | "assessment" | "employment";
  evidence_event_ids?: string[];
}

export interface PolicyContext {
  sensitivity: Sensitivity;
  visibility: Visibility;
  /** standard_with_contact 时受保护的联系方式字段名。 */
  contact_fields?: string[];
  /** restricted 时获准查看的机构/人员标识；空表示仅本人与主管单位。 */
  allowed_party_ids?: string[];
}

export interface EventSignature {
  prev_hash: string;
  event_hash: string;
  signer_key_id?: string;
}

/** 业务负载；具体事件的必填键由 vocabulary.PAYLOAD_SHAPES 约定。 */
export interface EventPayload {
  actor_id: string;
  reason: string;
  person_id?: string;
  studio_id?: string;
  school_id?: string;
  shop_id?: string;
  mentor_id?: string;
  course_revision_id?: string;
  decision?: string;
  craft_id?: string;
  step_ids?: string[];
  core_step_ids?: string[];
  authorized_step_ids?: string[];
  confirmed_by_inheritor_id?: string;
  inheritor_credential_id?: string;
  batch_id?: string;
  work_titles?: string[];
  is_public?: boolean;
  attribution?: Attribution;
  observations?: string;
  /** MASTER_COMMENT_ISSUED 必填：说明为何只作观察性记录。 */
  scoring_forbidden_reason?: string;
  score?: Score;
  contact?: Contact;
  scope?: string;
  trial_result?: "independent_ready" | "supervised_only" | "not_passed";
  employer_name?: string;
  employment_status?: "employed" | "self_employed" | "continued_training" | "not_employed";
  subsidy?: Subsidy;
  certificate?: {
    stage: "enrollment" | "training" | "assessment" | "authorization" | "employment";
    included_event_ids: string[];
  };
  effective_from?: string;
  effective_until?: string;
  exit_reason?: "studio_transfer" | "course_adjustment" | "mentor_exit" | "completed" | "other";
  new_aggregate_id?: string;
  [key: string]: unknown;
}

export interface DomainEvent {
  event_id: string;
  event_type: EventType;
  aggregate_type: AggregateType;
  aggregate_id: string;
  occurred_at: string;
  /** 服务端追加时间。 */
  recorded_at?: string;
  version: number;
  summary: string;
  policy_context: PolicyContext;
  payload: EventPayload;
  reference_ids?: string[];
  supersedes_id?: string;
  signature?: EventSignature;
}
