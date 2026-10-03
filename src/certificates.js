/**
 * 阶段证明：学员可导出的、带验证信息的履历阶段证明。
 *
 * 设计：
 *  - 证明正文只含可核验的结构化要点与所引事件的哈希（不含未公开作品内容、不含联系方式）。
 *  - 正文规范化后用 Ed25519 私钥签名；任一方可用中心公钥验签。
 *  - 验证方可再凭证明中的 event_id/event_hash 回到账本核对事件未被改动（verifyAgainstLedger）。
 */
import { createHash, generateKeyPairSync, createPrivateKey, createPublicKey, sign as signCb, verify as verifyCb } from "node:crypto";
import { promisify } from "node:util";
import { canonicalize, hashEvent } from "./store.js";

const signAsync = promisify(signCb);
const verifyAsync = promisify(verifyCb);

const ED25519 = "Ed25519";
// 本 OpenSSL 构建中 generateKeyPairSync 的类型标识为小写 ed25519；签名/验签算法名仍为 Ed25519。
const ED25519_KEYTYPE = "ed25519";

export function generateSigner({ keyId = "district:center:key-1" } = {}) {
  const { privateKey, publicKey } = generateKeyPairSync(ED25519_KEYTYPE);
  return { keyId, privateKey, publicKey };
}

/** 从 PEM 载入签名者；私钥 PEM 与公钥 PEM 分开保存。 */
export function loadSigner({ keyId, privateKeyPem, publicKeyPem }) {
  return {
    keyId,
    privateKey: createPrivateKey(privateKeyPem),
    publicKey: createPublicKey(publicKeyPem ?? privateKeyPem),
  };
}

export function publicKeyPem(signer) {
  return signer.publicKey.export({ type: "spki", format: "pem" });
}
export function privateKeyPem(signer) {
  return signer.privateKey.export({ type: "pkcs8", format: "pem" });
}

const STAGE_TITLES = {
  enrollment: "报名资格阶段证明",
  training: "传习训练阶段证明",
  assessment: "考核阶段证明",
  authorization: "岗位授权阶段证明",
  employment: "就业去向阶段证明",
};

/**
 * 出具阶段证明。
 * @param {import('./store.js').EventStore} store
 * @param {object} args
 * @param {string} args.person_id
 * @param {"enrollment"|"training"|"assessment"|"authorization"|"employment"} args.stage
 * @param {string[]} args.included_event_ids
 * @param {{keyId:string, privateKey:import('crypto').KeyObject}} args.signer
 */
export async function issueStageCertificate(store, { person_id: personId, stage, included_event_ids: includedIds, signer }) {
  if (!STAGE_TITLES[stage]) throw new Error(`未知证明阶段：${stage}`);
  if (!Array.isArray(includedIds) || includedIds.length === 0) throw new Error("证明至少要包含一个事件");

  const events = [];
  for (const id of includedIds) {
    const ev = store.events.find((e) => e.event_id === id);
    if (!ev) throw new Error(`证明引用的事件不存在：${id}`);
    if (ev.payload && ev.payload.person_id && ev.payload.person_id !== personId) {
      throw new Error(`事件 ${id} 不属于学员 ${personId}，不能纳入其阶段证明`);
    }
    events.push(ev);
  }

  const certificateId = `cert:${personId}:${stage}:${store.tailHash.slice(0, 10)}`;
  const body = {
    certificate_id: certificateId,
    person_id: personId,
    stage,
    title: STAGE_TITLES[stage],
    issued_at: new Date().toISOString(),
    source_tail_hash: store.tailHash,
    events: events
      .map((e) => ({
        event_id: e.event_id,
        event_type: e.event_type,
        aggregate_id: e.aggregate_id,
        version: e.version,
        occurred_at: e.occurred_at,
        event_hash: e.signature?.event_hash ?? null,
        prev_hash: e.signature?.prev_hash ?? null,
      }))
      .sort((a, b) => a.event_id.localeCompare(b.event_id)),
  };

  const canonical = canonicalize(body);
  const digest = createHash("sha256").update(canonical).digest();
  const signatureBuf = await signAsync(null, digest, signer.privateKey);

  return {
    ...body,
    verification: {
      alg: ED25519,
      key_id: signer.keyId,
      canonical_sha256: digest.toString("hex"),
      signature: signatureBuf.toString("base64"),
    },
  };
}

/** 仅验签：证明正文自签发后未被改动。 */
export async function verifyCertificateSignature(certificate, publicKey) {
  const { verification, ...body } = certificate;
  if (!verification || verification.alg !== ED25519) return { ok: false, reason: "缺少 Ed25519 验证信息" };
  const digest = createHash("sha256").update(canonicalize(body)).digest();
  if (digest.toString("hex") !== verification.canonical_sha256) return { ok: false, reason: "canonical_sha256 与正文不符" };
  let ok = false;
  try {
    ok = await verifyAsync(null, digest, publicKey, Buffer.from(verification.signature, "base64"));
  } catch {
    ok = false;
  }
  return ok ? { ok: true, certificate_id: body.certificate_id, person_id: body.person_id, stage: body.stage } : { ok: false, reason: "签名验证失败" };
}

/**
 * 强验证：除验签外，把证明中每个事件与账本逐条核对哈希，确认所证明的经历真实且未被改动。
 */
export async function verifyAgainstLedger(certificate, store, publicKey) {
  const sig = await verifyCertificateSignature(certificate, publicKey);
  if (!sig.ok) return sig;

  const byId = new Map(store.events.map((e) => [e.event_id, e]));
  for (const item of certificate.events) {
    const ev = byId.get(item.event_id);
    if (!ev) return { ok: false, reason: `账本缺少事件：${item.event_id}` };
    const recomputed = hashEvent(ev, item.prev_hash);
    if (recomputed !== item.event_hash || ev.signature?.event_hash !== item.event_hash) {
      return { ok: false, reason: `事件哈希不一致：${item.event_id}` };
    }
  }
  const chain = store.verifyChain();
  return { ok: true, certificate_id: certificate.certificate_id, person_id: certificate.person_id, stage: certificate.stage, chain_intact: chain === null, chain_break: chain };
}
