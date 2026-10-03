/**
 * 领域校验分两层：
 * 1. validateEvent —— 单条事件的信封与字段约定（任何机构写入前都要过）；
 * 2. validateStream —— 同一学员传习流的跨事件不变量（只有看全流才能判定的红线）。
 *
 * 红线（需求原文的可执行版本）：
 * - 观察性评语不得携带分数；
 * - 核心步骤只能由在册、资质有效、且覆盖该工序的传承人确认；
 * - 学校成绩/结业不构成门店授权，授权只承认安全考核与核心步骤确认；
 * - 师承关系、课程版本被接替后，旧记录仍须可被引用，新关系另行生效；
 * - 授权、试用、就业按时间线各自独立生效与终止。
 */

const ENVELOPE_REQUIRED = [
  "event_id",
  "event_type",
  "aggregate_type",
  "aggregate_id",
  "occurred_at",
  "version",
  "summary",
  "recorded_by",
];

export const EVENT_TYPES = [
  "ENROLLMENT_ELIGIBILITY_RECORDED",
  "APPRENTICESHIP_STARTED",
  "APPRENTICESHIP_ENDED",
  "MASTER_QUALIFICATION_REGISTERED",
  "COURSE_REVISION_PUBLISHED",
  "SCHOOL_GRADE_RECORDED",
  "PRACTICE_RECORDED",
  "WORK_BATCH_SUBMITTED",
  "CORE_STEP_CONFIRMED",
  "MASTER_NARRATIVE_RECORDED",
  "SAFETY_EXAM_PASSED",
  "PROCESS_AUTHORIZATION_GRANTED",
  "PROCESS_AUTHORIZATION_REVOKED",
  "TRIAL_EMPLOYMENT_VERIFIED",
  "PLACEMENT_VERIFIED",
  "STAGE_CERTIFICATE_ISSUED",
  "ACCESS_GRANTED",
];

export const AGGREGATE_TYPES = [
  "learner",
  "apprenticeship",
  "master_qualification",
  "course_revision",
  "school_record",
  "safety_exam",
  "practice_evidence",
  "work_batch",
  "work_authorization",
  "placement",
  "stage_certificate",
  "access_grant",
];

/** 每种事件允许的记录出具方角色；不在表内即不允许出具。 */
const RECORDER_ROLES = {
  ENROLLMENT_ELIGIBILITY_RECORDED: ["center", "school"],
  APPRENTICESHIP_STARTED: ["master"],
  APPRENTICESHIP_ENDED: ["master", "center"],
  MASTER_QUALIFICATION_REGISTERED: ["center"],
  COURSE_REVISION_PUBLISHED: ["school"],
  SCHOOL_GRADE_RECORDED: ["school"],
  PRACTICE_RECORDED: ["master"],
  WORK_BATCH_SUBMITTED: ["master", "learner"],
  CORE_STEP_CONFIRMED: ["master"],
  MASTER_NARRATIVE_RECORDED: ["master"],
  SAFETY_EXAM_PASSED: ["school", "center"],
  PROCESS_AUTHORIZATION_GRANTED: ["store"],
  PROCESS_AUTHORIZATION_REVOKED: ["store"],
  TRIAL_EMPLOYMENT_VERIFIED: ["store"],
  PLACEMENT_VERIFIED: ["store"],
  STAGE_CERTIFICATE_ISSUED: ["center"],
  ACCESS_GRANTED: ["center", "learner"],
};

/** 每种事件 payload 的必备字段。 */
const PAYLOAD_REQUIRED = {
  ENROLLMENT_ELIGIBILITY_RECORDED: ["learner_id", "decision", "joint_program_id", "decided_at"],
  APPRENTICESHIP_STARTED: ["learner_id", "master_id", "studio_code", "started_at"],
  APPRENTICESHIP_ENDED: ["learner_id", "master_id", "ended_at", "reason"],
  MASTER_QUALIFICATION_REGISTERED: ["master_id", "studio_code", "process_codes", "valid_from"],
  COURSE_REVISION_PUBLISHED: ["course_id", "revision_version", "published_at", "school_code"],
  SCHOOL_GRADE_RECORDED: [
    "learner_id",
    "course_id",
    "course_revision_id",
    "revision_version",
    "credits_hours",
    "grade",
    "result",
    "recorded_at",
  ],
  PRACTICE_RECORDED: ["learner_id", "apprenticeship_id", "practiced_at", "process_code", "step_code", "hours"],
  WORK_BATCH_SUBMITTED: ["learner_id", "apprenticeship_id", "submitted_at", "process_code", "visibility"],
  CORE_STEP_CONFIRMED: [
    "learner_id",
    "apprenticeship_id",
    "process_code",
    "step_code",
    "master_id",
    "qualification_id",
    "confirmed_at",
    "result",
  ],
  MASTER_NARRATIVE_RECORDED: ["learner_id", "apprenticeship_id", "master_id", "observed_at", "aspects", "narrative_text"],
  SAFETY_EXAM_PASSED: ["learner_id", "process_code", "passed_at", "examiner_org"],
  PROCESS_AUTHORIZATION_GRANTED: ["learner_id", "process_code", "step_codes", "scope", "authorized_at", "based_on"],
  PROCESS_AUTHORIZATION_REVOKED: ["learner_id", "process_code", "revoked_at", "reason"],
  TRIAL_EMPLOYMENT_VERIFIED: ["learner_id", "store_code", "process_code", "trial_from", "trial_to", "result", "authorization_id"],
  PLACEMENT_VERIFIED: ["learner_id", "store_code", "position_process_codes", "employed_at", "employment_type"],
  STAGE_CERTIFICATE_ISSUED: ["learner_id", "issued_at", "stage_title"],
  ACCESS_GRANTED: ["learner_id", "grantee_person_id", "grantee_org", "scopes", "granted_at"],
};

/** 评语禁止出现的字段：观察性文字不能伪装成统一分数。 */
const NARRATIVE_FORBIDDEN_KEYS = ["score", "numeric_score", "grade", "mark", "rating", "score_value"];

function isIsoDateTime(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/** 单条事件信封校验。 */
export function validateEvent(record) {
  const errors = ENVELOPE_REQUIRED.filter((name) => !(name in record)).map((name) => `缺少字段：${name}`);

  if ("version" in record && (!Number.isInteger(record.version) || record.version < 1)) {
    errors.push("version 必须是正整数");
  }
  if ("occurred_at" in record && !isIsoDateTime(record.occurred_at)) {
    errors.push("occurred_at 必须是 ISO-8601 日期时间");
  }
  if ("event_type" in record && !EVENT_TYPES.includes(record.event_type)) {
    errors.push(`未知 event_type：${record.event_type}`);
  }
  if ("aggregate_type" in record && !AGGREGATE_TYPES.includes(record.aggregate_type)) {
    errors.push(`未知 aggregate_type：${record.aggregate_type}`);
  }
  if ("recorded_by" in record) {
    const rb = record.recorded_by;
    if (typeof rb !== "object" || rb === null) {
      errors.push("recorded_by 必须是出具方对象");
    } else if (!rb.org_code || !rb.role) {
      errors.push("recorded_by 须包含 org_code 与 role");
    } else if (record.event_type && !(RECORDER_ROLES[record.event_type] || []).includes(rb.role)) {
      errors.push(`${record.event_type} 不能由角色 ${rb.role} 出具`);
    }
  }
  if (record.event_type && record.payload !== undefined) {
    errors.push(...validatePayload(record.event_type, record.payload));
  }
  return errors;
}

function validatePayload(eventType, payload) {
  const errors = [];
  if (typeof payload !== "object" || payload === null) return ["payload 必须是对象"];
  for (const key of PAYLOAD_REQUIRED[eventType] || []) {
    if (!(key in payload) || payload[key] === undefined || payload[key] === null) {
      errors.push(`payload 缺少字段：${key}`);
    }
  }
  if (eventType === "MASTER_NARRATIVE_RECORDED") {
    for (const key of NARRATIVE_FORBIDDEN_KEYS) {
      if (key in payload) errors.push(`观察性评语不得携带分数字段：${key}（评语与分数是两类语义）`);
    }
    if ("aspects" in payload && !Array.isArray(payload.aspects)) errors.push("aspects 必须是观察维度数组");
  }
  if (eventType === "ENROLLMENT_ELIGIBILITY_RECORDED" && payload.decision && !["eligible", "ineligible"].includes(payload.decision)) {
    errors.push("decision 只能是 eligible 或 ineligible");
  }
  if (eventType === "CORE_STEP_CONFIRMED" && payload.result && payload.result !== "pass") {
    errors.push("核心步骤确认结果只记录 pass（不通过不出具确认事件）");
  }
  if (eventType === "PROCESS_AUTHORIZATION_GRANTED" && payload.scope && !["independent", "supervised"].includes(payload.scope)) {
    errors.push("授权 scope 只能是 independent 或 supervised");
  }
  if (eventType === "WORK_BATCH_SUBMITTED" && payload.visibility && !["private", "public"].includes(payload.visibility)) {
    errors.push("作品可见性只能是 private 或 public");
  }
  return errors;
}

const err = (eventId, code, message) => ({ event_id: eventId || null, code, message });

/**
 * 事件流不变量校验。events 可以包含多个学员的流，按 payload.learner_id 分组。
 * 返回错误数组；空数组合法。
 */
export function validateStream(events) {
  const errors = [];
  const seenIds = new Map(); // event_id -> event
  const byAggregate = new Map(); // aggregate_id -> [{version, event}]
  const qualifications = new Map(); // qualification_id(=aggregate_id) -> event
  const apprenticeships = new Map(); // apprenticeship_id -> {started, ended, event}
  const confirmations = []; // CORE_STEP_CONFIRMED 事件
  const safetyExams = new Map(); // safety aggregate_id -> event
  const courses = new Map(); // course_revision_id -> event
  const chains = new Map(); // learner_id -> {lastId, lastTime}

  // 第一遍：信封、唯一性、聚合版本、索引
  events.forEach((event, index) => {
    const envelopeErrors = validateEvent(event);
    envelopeErrors.forEach((message) => errors.push(err(event.event_id, "ENVELOPE", message)));

    if (seenIds.has(event.event_id)) errors.push(err(event.event_id, "DUP_EVENT", "event_id 重复"));
    seenIds.set(event.event_id, event);

    if (!byAggregate.has(event.aggregate_id)) byAggregate.set(event.aggregate_id, []);
    byAggregate.get(event.aggregate_id).push(event);

    const p = event.payload || {};
    switch (event.event_type) {
      case "MASTER_QUALIFICATION_REGISTERED":
        qualifications.set(event.aggregate_id, event);
        break;
      case "APPRENTICESHIP_STARTED":
        if (apprenticeships.has(event.aggregate_id)) {
          errors.push(err(event.event_id, "DUP_APPRENTICESHIP", "同一师承关系重复建立"));
        }
        apprenticeships.set(event.aggregate_id, { started: event, ended: null });
        break;
      case "APPRENTICESHIP_ENDED":
        if (!apprenticeships.has(event.aggregate_id)) {
          errors.push(err(event.event_id, "ORPHAN_END", "师承结束事件没有对应的开始事件"));
        } else {
          apprenticeships.get(event.aggregate_id).ended = event;
        }
        break;
      case "CORE_STEP_CONFIRMED":
        confirmations.push(event);
        break;
      case "SAFETY_EXAM_PASSED":
        safetyExams.set(event.aggregate_id, event);
        break;
      case "COURSE_REVISION_PUBLISHED":
        courses.set(event.aggregate_id, event);
        break;
    }

    // 哈希链：每个学员一条链，prev_event_id 必须指向上一条
    const learnerId = p.learner_id;
    if (learnerId) {
      const chain = chains.get(learnerId) || { lastId: null, lastTime: null };
      if (event.prev_event_id === undefined && chain.lastId !== null) {
        errors.push(err(event.event_id, "CHAIN_BROKEN", `学员 ${learnerId} 的事件缺少 prev_event_id`));
      }
      if (event.prev_event_id !== undefined) {
        if (event.prev_event_id !== chain.lastId) {
          errors.push(
            err(event.event_id, "CHAIN_BROKEN", `prev_event_id 与链尾不符（应为 ${chain.lastId || "空"}）`)
          );
        }
        if (!seenIds.has(event.prev_event_id) && !events.some((e) => e.event_id === event.prev_event_id)) {
          errors.push(err(event.event_id, "CHAIN_MISSING", `prev_event_id 指向的事件不存在：${event.prev_event_id}`));
        }
      }
      if (chain.lastTime && Date.parse(event.occurred_at) < Date.parse(chain.lastTime)) {
        errors.push(err(event.event_id, "TIME_ORDER", "事件时间早于该学员链上的前一事件"));
      }
      chain.lastId = event.event_id;
      chain.lastTime = event.occurred_at;
      chains.set(learnerId, chain);
    }
  });

  // 聚合版本号在聚合内从 1 严格递增（按流中出现顺序）
  for (const [aggregateId, list] of byAggregate) {
    list.forEach((event, i) => {
      if (event.version !== i + 1) {
        errors.push(err(event.event_id, "VERSION_GAP", `聚合 ${aggregateId} 的版本号应为 ${i + 1}，实际为 ${event.version}`));
      }
    });
  }

  // 第二遍：跨事件红线
  for (const event of events) {
    const p = event.payload || {};

    if (event.event_type === "APPRENTICESHIP_STARTED") {
      // 报名资格在先
      const eligible = events.some(
        (e) =>
          e.event_type === "ENROLLMENT_ELIGIBILITY_RECORDED" &&
          e.payload?.learner_id === p.learner_id &&
          e.payload?.decision === "eligible" &&
          Date.parse(e.payload.decided_at) <= Date.parse(p.started_at)
      );
      if (!eligible) errors.push(err(event.event_id, "NO_ELIGIBILITY", "建立师承关系前须有合格的报名资格记录"));

      // 接替：旧师承必须存在，旧履历不删除、不重写
      if (p.supersedes_apprenticeship_id && !apprenticeships.has(p.supersedes_apprenticeship_id)) {
        errors.push(err(event.event_id, "SUPERSEDE_MISSING", "被接替的师承关系不存在，旧履历仍须保留可引用"));
      }
    }

    if (event.event_type === "APPRENTICESHIP_ENDED") {
      const rel = apprenticeships.get(event.aggregate_id);
      if (rel && Date.parse(p.ended_at) < Date.parse(rel.started.payload.started_at)) {
        errors.push(err(event.event_id, "TIME_ORDER", "师承结束时间早于开始时间"));
      }
    }

    if (event.event_type === "SCHOOL_GRADE_RECORDED") {
      // 成绩必须挂在一个已发布的课程版本上；课程改版后旧版本成绩仍然有效
      const revision = courses.get(p.course_revision_id);
      if (!revision) {
        errors.push(err(event.event_id, "REVISION_MISSING", `课程版本不存在：${p.course_revision_id}`));
      } else if (revision.payload.revision_version !== p.revision_version) {
        errors.push(err(event.event_id, "REVISION_MISMATCH", "成绩记录的 revision_version 与课程版本不一致"));
      }
    }

    if (event.event_type === "PRACTICE_RECORDED") {
      const rel = apprenticeships.get(p.apprenticeship_id);
      if (!rel) {
        errors.push(err(event.event_id, "NO_APPRENTICESHIP", "现场练习没有对应的师承关系"));
      } else if (!apprenticeshipActiveAt(rel, p.practiced_at)) {
        errors.push(err(event.event_id, "APPRENTICESHIP_INACTIVE", "练习发生时该师承关系尚未开始或已结束"));
      }
    }

    if (event.event_type === "CORE_STEP_CONFIRMED") {
      const rel = apprenticeships.get(p.apprenticeship_id);
      if (!rel) {
        errors.push(err(event.event_id, "NO_APPRENTICESHIP", "核心步骤确认没有对应的师承关系"));
      } else if (rel.started.payload.master_id !== p.master_id) {
        errors.push(err(event.event_id, "MASTER_MISMATCH", "核心步骤须由该师承关系的师傅本人确认"));
      } else if (!apprenticeshipActiveAt(rel, p.confirmed_at)) {
        errors.push(err(event.event_id, "APPRENTICESHIP_INACTIVE", "确认发生时师承关系不在有效期内"));
      }

      const qual = qualifications.get(p.qualification_id);
      if (!qual) {
        errors.push(err(event.event_id, "NO_QUALIFICATION", `传承人资质不存在：${p.qualification_id}`));
      } else {
        const q = qual.payload;
        if (q.master_id !== p.master_id) {
          errors.push(err(event.event_id, "QUALIFICATION_OWNER", "资质不属于确认师傅本人"));
        }
        if (!Array.isArray(q.process_codes) || !q.process_codes.includes(p.process_code)) {
          errors.push(err(event.event_id, "QUALIFICATION_SCOPE", `资质不覆盖工序 ${p.process_code}`));
        }
        if (Date.parse(p.confirmed_at) < Date.parse(q.valid_from)) {
          errors.push(err(event.event_id, "QUALIFICATION_EXPIRED", "确认时间早于资质生效日"));
        }
        if (q.valid_until && Date.parse(p.confirmed_at) > Date.parse(q.valid_until)) {
          errors.push(err(event.event_id, "QUALIFICATION_EXPIRED", "确认时间晚于资质到期日"));
        }
      }
    }

    if (event.event_type === "PROCESS_AUTHORIZATION_GRANTED") {
      const based = p.based_on || {};

      // 安全考核：存在、针对同一工序、授权时仍在有效期
      const safety = safetyExams.get(based.safety_exam_id);
      if (!safety) {
        errors.push(err(event.event_id, "NO_SAFETY_EXAM", "授权缺少有效的安全考核依据"));
      } else {
        const s = safety.payload;
        if (s.learner_id !== p.learner_id || s.process_code !== p.process_code) {
          errors.push(err(event.event_id, "SAFETY_MISMATCH", "安全考核与被授权学员或工序不一致"));
        }
        if (Date.parse(p.authorized_at) < Date.parse(s.passed_at)) {
          errors.push(err(event.event_id, "TIME_ORDER", "授权时间早于安全考核通过时间"));
        }
        if (s.valid_until && Date.parse(p.authorized_at) > Date.parse(s.valid_until)) {
          errors.push(err(event.event_id, "SAFETY_EXPIRED", "授权时安全考核已过有效期"));
        }
      }

      // 每个被授权步骤都要有在先的、合格的核心步骤确认
      const confirmationIds = based.core_step_confirmation_ids || [];
      for (const stepCode of p.step_codes || []) {
        const ok = confirmations.some((c) => {
          if (!confirmationIds.includes(c.event_id)) return false;
          const cp = c.payload;
          return (
            cp.learner_id === p.learner_id &&
            cp.process_code === p.process_code &&
            cp.step_code === stepCode &&
            cp.result === "pass" &&
            Date.parse(cp.confirmed_at) <= Date.parse(p.authorized_at)
          );
        });
        if (!ok) {
          errors.push(err(event.event_id, "UNCONFIRMED_STEP", `授权步骤 ${stepCode} 缺少在先的传承人核心步骤确认`));
        }
      }
      // 声明了但不存在的确认依据也要报错（防止用学校成绩编号冒充）
      for (const cid of confirmationIds) {
        if (!confirmations.some((c) => c.event_id === cid)) {
          errors.push(err(event.event_id, "BAD_BASIS", `授权依据不是核心步骤确认事件：${cid}（学校成绩不能充当授权依据）`));
        }
      }

      // 授权必须落在一段真实师承上
      if (based.apprenticeship_id && !apprenticeships.has(based.apprenticeship_id)) {
        errors.push(err(event.event_id, "NO_APPRENTICESHIP", "授权依据的师承关系不存在"));
      }
    }

    if (event.event_type === "TRIAL_EMPLOYMENT_VERIFIED") {
      const auth = seenIds.has(p.authorization_id) ? seenIds.get(p.authorization_id) : null;
      if (!auth || auth.event_type !== "PROCESS_AUTHORIZATION_GRANTED") {
        errors.push(err(event.event_id, "NO_AUTHORIZATION", "岗位试用必须引用一次真实的工序授权"));
      } else {
        if (auth.payload.process_code !== p.process_code) {
          errors.push(err(event.event_id, "AUTH_SCOPE", "试用工序与授权工序不一致"));
        }
        if (Date.parse(p.trial_from) < Date.parse(auth.payload.authorized_at)) {
          errors.push(err(event.event_id, "TIME_ORDER", "试用开始早于授权时间"));
        }
      }
    }

    if (event.event_type === "PLACEMENT_VERIFIED") {
      // 就业去向引用试用核验；学校成绩或门店授权都不能替代就业事实
      if (p.trial_verification_id) {
        const trial = seenIds.get(p.trial_verification_id);
        if (!trial || trial.event_type !== "TRIAL_EMPLOYMENT_VERIFIED") {
          errors.push(err(event.event_id, "NO_TRIAL", "就业去向引用的试用核验不存在"));
        }
      }
    }
  }

  return errors;
}

function apprenticeshipActiveAt(rel, when) {
  const t = Date.parse(when);
  if (Number.isNaN(t)) return false;
  if (t < Date.parse(rel.started.payload.started_at)) return false;
  if (rel.ended && t > Date.parse(rel.ended.payload.ended_at)) return false;
  return true;
}
