/**
 * 事件结构校验（无外部状态、不依赖名录）。
 * 跨事件语义规则（资格、授权前置、补助对应等）在 src/rules.js。
 */
import {
  EVENT_TYPES,
  AGGREGATE_TYPES,
  EVENT_AGGREGATE,
  PAYLOAD_SHAPES,
  SENSITIVITY,
  VISIBILITY,
  SCORABLE_EVENTS,
} from "./vocabulary.js";

const REQUIRED_TOP = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
  "policy_context",
  "payload",
];

const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const isDateTime = (v) => typeof v === "string" && DATE_TIME_RE.test(v) && !Number.isNaN(Date.parse(v));
const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

const validEnum = (value, allowed) => typeof value === "string" && Object.values(allowed).includes(value);

/**
 * 校验一条事件的结构。
 * @returns {string[]} 错误信息数组，空数组表示通过。
 */
export function validateEvent(record) {
  const errors = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return ["事件必须是对象"];

  for (const name of REQUIRED_TOP) if (!(name in record)) errors.push(`缺少字段：${name}`);
  if (errors.length > 0 && !("event_type" in record)) return errors;

  if (!isNonEmptyString(record.event_id)) errors.push("event_id 必须是非空字符串");
  if (!isNonEmptyString(record.aggregate_id)) errors.push("aggregate_id 必须是非空字符串");
  if (!isNonEmptyString(record.summary)) errors.push("summary 必须是非空字符串");
  if (!Number.isInteger(record.version) || record.version < 1) errors.push("version 必须是正整数");
  if (!isDateTime(record.occurred_at)) errors.push("occurred_at 必须是带时区的 date-time");
  if ("recorded_at" in record && !isDateTime(record.recorded_at)) errors.push("recorded_at 必须是带时区的 date-time");

  if (!validEnum(record.event_type, EVENT_TYPES)) {
    errors.push(`未知 event_type：${record.event_type}`);
    return errors;
  }

  const expectedAggregate = EVENT_AGGREGATE[record.event_type];
  if (!validEnum(record.aggregate_type, AGGREGATE_TYPES)) {
    errors.push(`未知 aggregate_type：${record.aggregate_type}`);
  } else if (record.aggregate_type !== expectedAggregate) {
    errors.push(`事件 ${record.event_type} 的 aggregate_type 应为 ${expectedAggregate}，收到 ${record.aggregate_type}`);
  }

  validatePolicyContext(record.policy_context, errors);
  validatePayload(record.event_type, record.payload, errors);

  if (record.reference_ids !== undefined) {
    if (!Array.isArray(record.reference_ids) || record.reference_ids.some((id) => !isNonEmptyString(id))) {
      errors.push("reference_ids 必须是非空字符串数组");
    }
  }
  return errors;
}

function validatePolicyContext(pc, errors) {
  if (!pc || typeof pc !== "object") {
    errors.push("policy_context 必须是对象");
    return;
  }
  if (!validEnum(pc.sensitivity, SENSITIVITY)) errors.push("policy_context.sensitivity 取值非法");
  if (!validEnum(pc.visibility, VISIBILITY)) errors.push("policy_context.visibility 取值非法");
  if (pc.contact_fields !== undefined && (!Array.isArray(pc.contact_fields) || pc.contact_fields.some((f) => typeof f !== "string"))) {
    errors.push("policy_context.contact_fields 必须是字符串数组");
  }
  if (pc.allowed_party_ids !== undefined && (!Array.isArray(pc.allowed_party_ids) || pc.allowed_party_ids.some((f) => typeof f !== "string"))) {
    errors.push("policy_context.allowed_party_ids 必须是字符串数组");
  }
}

function validatePayload(eventType, payload, errors) {
  if (!payload || typeof payload !== "object") {
    errors.push("payload 必须是对象");
    return;
  }
  const shape = PAYLOAD_SHAPES[eventType];
  const allowed = new Set([...shape.required, ...shape.optional]);
  for (const key of shape.required) {
    if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
      errors.push(`payload.${key} 必填（事件 ${eventType}）`);
    } else if (!meaningful(payload[key])) {
      errors.push(`payload.${key} 不能为空（事件 ${eventType}）`);
    }
  }
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) errors.push(`payload.${key} 不是事件 ${eventType} 约定的字段`);
  }

  // 观察性评语 vs 数值成绩：分轨记录，不得互相伪装。
  if (eventType === "MASTER_COMMENT_ISSUED") {
    if (!isNonEmptyString(payload.observations)) errors.push("师傅评语 observations 必须是非空叙述");
    if (!isNonEmptyString(payload.scoring_forbidden_reason)) {
      errors.push("师傅评语必须填写 scoring_forbidden_reason，说明为何只作观察性记录");
    }
    if ("score" in payload) errors.push("观察性评语禁止携带 score，不得折算为统一分数");
  }
  if ("score" in payload) {
    if (!SCORABLE_EVENTS.has(eventType)) {
      errors.push(`事件 ${eventType} 不允许 score；分数仅限安全考核与结业考核`);
    } else {
      validateScore(payload.score, errors);
    }
  }

  if (payload.subsidy !== undefined) validateSubsidy(payload.subsidy, errors);
  if (payload.effective_from !== undefined && !isDateTime(payload.effective_from)) {
    errors.push("payload.effective_from 必须是 date-time");
  }
  if (payload.effective_until !== undefined && !isDateTime(payload.effective_until)) {
    errors.push("payload.effective_until 必须是 date-time");
  }
}

function meaningful(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function validateScore(score, errors) {
  if (!score || typeof score !== "object") {
    errors.push("score 必须是对象");
    return;
  }
  if (!["safety_exam", "course_grade"].includes(score.score_kind)) errors.push("score.score_kind 非法");
  if (typeof score.value !== "number" || Number.isNaN(score.value)) errors.push("score.value 必须是数值");
  if (!Number.isInteger(score.scale_max) || score.scale_max < 1) errors.push("score.scale_max 必须是正整数");
  if (typeof score.value === "number" && typeof score.scale_max === "number" && score.value > score.scale_max) {
    errors.push("score.value 不能超过 score.scale_max");
  }
  if (score.value < 0) errors.push("score.value 不能为负");
  if (score.pass_threshold !== undefined) {
    if (typeof score.pass_threshold !== "number") errors.push("score.pass_threshold 必须是数值");
    else if (score.pass_threshold > score.scale_max) errors.push("score.pass_threshold 不能超过 scale_max");
  }
}

function validateSubsidy(subsidy, errors) {
  if (!subsidy || typeof subsidy !== "object") {
    errors.push("subsidy 必须是对象");
    return;
  }
  if (typeof subsidy.amount !== "number" || subsidy.amount < 0) errors.push("subsidy.amount 必须是非负数");
  if (subsidy.currency !== "CNY") errors.push("subsidy.currency 必须是 CNY");
  if (!["enrollment", "training", "assessment", "employment"].includes(subsidy.stage)) {
    errors.push("subsidy.stage 非法");
  }
  if (subsidy.evidence_event_ids !== undefined) {
    if (!Array.isArray(subsidy.evidence_event_ids) || subsidy.evidence_event_ids.some((id) => !isNonEmptyString(id))) {
      errors.push("subsidy.evidence_event_ids 必须是非空字符串数组");
    }
  }
}
