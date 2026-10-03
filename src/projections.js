import { canonicalize, chainHash, eventDigest, verifyEventSignature } from "./crypto.js";
import { createPublicKey, sign, verify } from "node:crypto";

/**
 * 读取模型：事件流是事实来源，以下全部是派生视图，不回写、不补造事实。
 * 每个视图都按"谁在看"做最小化：
 * - 门店：只需要"现在能独立承担哪些工序步骤"；
 * - 管理部门：只需要补助核验所需的学习/考核/就业事实；
 * - 学员本人/被授权方：才看得到未公开作品与联系方式。
 */

const CONTACT_KEYS = ["phone", "mobile", "email", "contact_address", "id_document_no"];
const PRIVATE_BATCH_KEYS = ["batch_id", "title", "photo_refs", "notes"];

function byLearner(events, learnerId) {
  return events
    .filter((e) => e.payload && e.payload.learner_id === learnerId)
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.event_id.localeCompare(b.event_id));
}

/**
 * 1. 工序授权视图（门店用）。
 * 返回每个工序的当前状态：independent / supervised / 未授权，以及缺失项。
 * 只承认安全考核 + 核心步骤确认 + 门店授权；学校成绩完全不进入判定。
 */
export function processAuthorizationView(events, learnerId, at = new Date().toISOString()) {
  const mine = byLearner(events, learnerId);
  const safety = new Map(); // process_code -> 最近一次通过事件
  const confirmed = new Map(); // `${process}|${step}` -> confirmed_at
  const grants = [];
  const revocations = [];

  for (const e of mine) {
    if (Date.parse(e.occurred_at) > Date.parse(at)) continue;
    switch (e.event_type) {
      case "SAFETY_EXAM_PASSED":
        if (!safety.has(e.payload.process_code) || Date.parse(e.payload.passed_at) > Date.parse(safety.get(e.payload.process_code).payload.passed_at)) {
          safety.set(e.payload.process_code, e);
        }
        break;
      case "CORE_STEP_CONFIRMED":
        confirmed.set(`${e.payload.process_code}|${e.payload.step_code}`, e);
        break;
      case "PROCESS_AUTHORIZATION_GRANTED":
        grants.push(e);
        break;
      case "PROCESS_AUTHORIZATION_REVOKED":
        revocations.push(e);
        break;
    }
  }

  const processes = new Set(grants.map((g) => g.payload.process_code));
  const result = {};
  for (const processCode of processes) {
    const grant = grants
      .filter((g) => g.payload.process_code === processCode)
      .sort((a, b) => Date.parse(b.payload.authorized_at) - Date.parse(a.payload.authorized_at))[0];

    const revoked = revocations.some(
      (r) => r.payload.process_code === processCode && Date.parse(r.payload.revoked_at) >= Date.parse(grant.payload.authorized_at)
    );
    const expired = grant.payload.valid_until && Date.parse(at) > Date.parse(grant.payload.valid_until);
    const exam = safety.get(processCode);
    const safetyValid = exam && (!exam.payload.valid_until || Date.parse(at) <= Date.parse(exam.payload.valid_until));

    result[processCode] = {
      scope: revoked || expired ? "none" : grant.payload.scope,
      authorized_steps: revoked || expired ? [] : grant.payload.step_codes,
      status: revoked ? "revoked" : expired ? "expired" : "active",
      authorized_at: grant.payload.authorized_at,
      valid_until: grant.payload.valid_until || null,
      safety_current: Boolean(safetyValid),
      grant_event_id: grant.event_id,
      /** 未取得授权但已有传承人确认的步骤：门店可据此安排带教，不等于可独立上岗。 */
      confirmed_but_unauthorized: [...confirmed.keys()]
        .filter((k) => k.startsWith(`${processCode}|`))
        .map((k) => k.split("|")[1])
        .filter((step) => !grant.payload.step_codes.includes(step)),
    };
  }

  // 只练过、确认过、但门店从未授权的工序，也要如实呈现为未授权
  for (const [key, event] of confirmed) {
    const [processCode] = key.split("|");
    if (!result[processCode]) {
      result[processCode] = {
        scope: "none",
        authorized_steps: [],
        status: "not_authorized",
        safety_current: Boolean(safety.get(processCode)),
        confirmed_but_unauthorized: [event.payload.step_code],
      };
    }
  }
  return result;
}

/**
 * 2. 传习时间线（学员本人/被授权方用）。
 * 被接替的师承与旧课程版本原样保留并标注，履历始终可引用。
 */
export function timeline(events, learnerId) {
  const mine = byLearner(events, learnerId);
  const endedApprenticeships = new Set(
    mine.filter((e) => e.event_type === "APPRENTICESHIP_ENDED").map((e) => e.aggregate_id)
  );
  return mine.map((e) => {
    const item = {
      event_id: e.event_id,
      event_type: e.event_type,
      aggregate_id: e.aggregate_id,
      occurred_at: e.occurred_at,
      summary: e.summary,
      recorded_by: e.recorded_by.org_code,
    };
    if (e.event_type === "APPRENTICESHIP_STARTED") {
      item.master_id = e.payload.master_id;
      item.studio_code = e.payload.studio_code;
      item.supersedes = e.payload.supersedes_apprenticeship_id || null;
      item.state = endedApprenticeships.has(e.aggregate_id) ? "ended" : "active";
    }
    if (e.event_type === "SCHOOL_GRADE_RECORDED") item.course_revision_id = e.payload.course_revision_id;
    return item;
  });
}

function findAccess(events, learnerId, viewer, at = new Date().toISOString()) {
  const now = Date.parse(at);
  return byLearner(events, learnerId)
    .filter((e) => e.event_type === "ACCESS_GRANTED")
    .filter((e) => Date.parse(e.occurred_at) <= now)
    .filter((e) => !e.payload.valid_until || Date.parse(e.payload.valid_until) >= now)
    .filter((e) => e.payload.grantee_org === viewer.org_code)
    .filter((e) => !e.payload.grantee_person_id || e.payload.grantee_person_id === viewer.person_id);
}

function maskContact(payload) {
  const out = { ...payload };
  for (const key of CONTACT_KEYS) if (key in out) out[key] = "***";
  return out;
}

/**
 * 3. 按访问方脱敏的事件视图。
 * viewer: {org_code, person_id, role}；未公开作品与联系方式仅对持有对应 scope 的 ACCESS_GRANTED 开放。
 */
export function viewForParty(events, learnerId, viewer, at = new Date().toISOString()) {
  const grants = findAccess(events, learnerId, viewer, at);
  const scopes = new Set(grants.flatMap((g) => g.payload.scopes || []));
  const self = viewer.person_id && viewer.person_id === learnerId;

  return byLearner(events, learnerId).map((event) => {
    const e = structuredClone(event);
    let allowed = self;

    if (e.event_type === "ENROLLMENT_ELIGIBILITY_RECORDED" && !self && !scopes.has("learner_contact")) {
      e.payload = maskContact(e.payload);
    }
    if (e.event_type === "WORK_BATCH_SUBMITTED" && e.payload.visibility === "private") {
      allowed = self || scopes.has("unpublished_works");
      if (!allowed) {
        for (const key of PRIVATE_BATCH_KEYS) delete e.payload[key];
        e.payload.redacted = "未公开作品：仅向获准人员开放";
      }
    }
    if (e.event_type === "MASTER_NARRATIVE_RECORDED" && !self && !scopes.has("master_narrative")) {
      delete e.payload.narrative_text;
      e.payload.narrative_redacted = true;
    }
    return e;
  });
}

/**
 * 4. 培训补助核验视图（管理部门用）——数据最小化。
 * 只回答"补助是否真正对应学习、考核、就业"，不含评语原文、私人资料、未公开作品。
 */
export function subsidyVerificationView(events, learnerId) {
  const mine = byLearner(events, learnerId);
  const view = {
    learner_id: learnerId,
    eligibility: null,
    training: [],
    safety_exams: [],
    authorizations: [],
    trials: [],
    employment: null,
  };
  for (const e of mine) {
    switch (e.event_type) {
      case "ENROLLMENT_ELIGIBILITY_RECORDED":
        view.eligibility = {
          decision: e.payload.decision,
          joint_program_id: e.payload.joint_program_id,
          decided_at: e.payload.decided_at,
        };
        break;
      case "SCHOOL_GRADE_RECORDED":
        view.training.push({
          course_id: e.payload.course_id,
          revision_version: e.payload.revision_version,
          credits_hours: e.payload.credits_hours,
          result: e.payload.result,
          recorded_at: e.payload.recorded_at,
        });
        break;
      case "SAFETY_EXAM_PASSED":
        view.safety_exams.push({
          process_code: e.payload.process_code,
          passed_at: e.payload.passed_at,
          valid_until: e.payload.valid_until || null,
        });
        break;
      case "PROCESS_AUTHORIZATION_GRANTED":
        view.authorizations.push({
          process_code: e.payload.process_code,
          scope: e.payload.scope,
          step_count: e.payload.step_codes.length,
          authorized_at: e.payload.authorized_at,
        });
        break;
      case "TRIAL_EMPLOYMENT_VERIFIED":
        view.trials.push({
          store_code: e.payload.store_code,
          process_code: e.payload.process_code,
          result: e.payload.result,
          trial_from: e.payload.trial_from,
          trial_to: e.payload.trial_to,
        });
        break;
      case "PLACEMENT_VERIFIED":
        view.employment = {
          store_code: e.payload.store_code,
          position_process_codes: e.payload.position_process_codes,
          employed_at: e.payload.employed_at,
          employment_type: e.payload.employment_type,
        };
        break;
    }
  }
  return view;
}

/**
 * 5. 阶段证明导出（学员可携带）。
 * 内容：截至某一事件的事件快照 + 逐条事件摘要 + 链式指纹 + 中心 Ed25519 签名。
 * 任何拿到中心公钥的一方都能离线验证：事件未被篡改、流未被删减、确由中心出具。
 */
export function exportStageCertificate(events, learnerId, options) {
  const { upToEventId, stageTitle, issuerPrivateKey, issuerOrgCode, publicKeyId, issuedAt = new Date().toISOString() } = options;
  let slice = byLearner(events, learnerId);
  if (upToEventId) {
    const idx = slice.findIndex((e) => e.event_id === upToEventId);
    if (idx < 0) throw new Error(`阶段终点事件不存在：${upToEventId}`);
    slice = slice.slice(0, idx + 1);
  }

  const entries = slice.map((e) => ({ event_id: e.event_id, digest: eventDigest(e) }));

  // 自包含：把证明引用到的在册资质、课程版本等参照事实一并打包（出具方公开发布的事实，
  // 不属于学员哈希链，但进入签名与重放校验），使证明可离线验证。
  const referenceIds = new Set();
  for (const e of slice) {
    if (e.event_type === "CORE_STEP_CONFIRMED") referenceIds.add(e.payload.qualification_id);
  }
  const referenceEvents = events
    .filter(
      (e) =>
        (e.event_type === "MASTER_QUALIFICATION_REGISTERED" && referenceIds.has(e.aggregate_id)) ||
        (e.event_type === "COURSE_REVISION_PUBLISHED" &&
          slice.some((s) => s.event_type === "SCHOOL_GRADE_RECORDED" && s.payload.course_revision_id === e.aggregate_id))
    )
    .sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at));
  const referenceEntries = referenceEvents.map((e) => ({ event_id: e.event_id, digest: eventDigest(e) }));

  const unsignedCert = {
    cert_id: `cert-${learnerId}-${Date.parse(issuedAt)}`,
    learner_id: learnerId,
    stage_title: stageTitle,
    issued_at: issuedAt,
    issuer: { org_code: issuerOrgCode, public_key_id: publicKeyId },
    range: { from_event_id: entries[0]?.event_id || null, to_event_id: entries[entries.length - 1]?.event_id || null },
    reference_events: referenceEvents,
    reference_digests: referenceEntries,
    events: slice,
    event_digests: entries,
    chain_hash: chainHash(slice),
  };

  const signature = sign(null, Buffer.from(canonicalize(unsignedCert), "utf8"), issuerPrivateKey).toString("hex");
  return { ...unsignedCert, signature_algorithm: "Ed25519", signature };
}

/**
 * 验证阶段证明。返回 {valid, reasons}。
 * @param publicKey 中心公钥（KeyObject 或 PEM）
 * @param options.requireStreamValid 是否同时重放领域不变量（默认 true）
 */
export function verifyStageCertificate(certificate, publicKey, options = {}) {
  const { requireStreamValid = true, validateStream } = options;
  const reasons = [];

  if (!certificate || typeof certificate !== "object") return { valid: false, reasons: ["证明不是合法对象"] };

  const { signature, signature_algorithm, ...body } = certificate;
  if (signature_algorithm !== "Ed25519") reasons.push("签名算法不是 Ed25519");

  // 逐条事件摘要（学员链内事件 + 参照事实）
  const checkDigests = (entries, list, label) => {
    for (const entry of entries || []) {
      const event = (list || []).find((e) => e.event_id === entry.event_id);
      if (!event) {
        reasons.push(`${label}摘要指向的事件缺失：${entry.event_id}`);
      } else if (eventDigest(event) !== entry.digest) {
        reasons.push(`${label}摘要不符（内容被改动）：${entry.event_id}`);
      }
    }
  };
  checkDigests(certificate.event_digests, certificate.events, "事件");
  checkDigests(certificate.reference_digests, certificate.reference_events, "参照事实");

  // 链式指纹
  if (chainHash(certificate.events || []) !== certificate.chain_hash) reasons.push("链式指纹不符：事件顺序或内容被改动");

  // 哈希链指针
  let prev = null;
  for (const e of certificate.events || []) {
    if (prev !== null && e.prev_event_id !== prev) reasons.push(`事件 ${e.event_id} 的 prev_event_id 断链`);
    if (prev === null && e.prev_event_id !== undefined) reasons.push(`事件 ${e.event_id} 不应携带 prev_event_id`);
    prev = e.event_id;
  }

  // 出具方签名
  try {
    const key = typeof publicKey === "string" ? createPublicKey(publicKey) : publicKey;
    const ok = verify(null, Buffer.from(canonicalize(body), "utf8"), key, Buffer.from(signature || "", "hex"));
    if (!ok) reasons.push("中心签名验证失败");
  } catch (e) {
    reasons.push(`公钥或签名不可读：${e.message}`);
  }

  // 可选：重放领域红线（学员事件 + 参照事实一并重放）
  if (requireStreamValid && validateStream) {
    for (const violation of validateStream([...(certificate.reference_events || []), ...(certificate.events || [])])) {
      reasons.push(`领域不变量 ${violation.code}（${violation.event_id}）：${violation.message}`);
    }
  }

  return { valid: reasons.length === 0, reasons };
}

/** 附带验证单条事件出具方签名（用于机构间直接交换时）。 */
export function verifyRecorderSignature(event, publicKey) {
  return verifyEventSignature(event, publicKey);
}
