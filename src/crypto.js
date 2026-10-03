import { createHash, generateKeyPairSync, sign, verify } from "node:crypto";

/**
 * 规范化 JSON：对象键递归排序后序列化。
 * 签名与事件摘要都基于规范化结果，避免字段顺序差异导致验证失败。
 */
export function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

/** 单条事件摘要：对去掉 signature 字段后的规范化内容做 SHA-256。 */
export function eventDigest(event) {
  const { signature, ...unsigned } = event;
  return createHash("sha256").update(canonicalize(unsigned)).digest("hex");
}

/**
 * 流的链式摘要：每一节 = SHA-256(前一节摘要 || 本条摘要)。
 * 末节摘要即为整条传习履历的指纹，任何插入、删除、改写都会改变它。
 */
export function chainHash(events) {
  let head = "";
  for (const event of events) head = createHash("sha256").update(head + eventDigest(event)).digest("hex");
  return head;
}

export function generateSigningKey() {
  return generateKeyPairSync("ed25519");
}

/** 返回带 signature 字段的新事件对象（Ed25519，签名内容为事件摘要）。 */
export function signEvent(event, privateKey) {
  const signature = sign(null, Buffer.from(eventDigest(event), "utf8"), privateKey).toString("hex");
  return { ...event, signature };
}

/** 校验单条事件签名；公钥缺失时返回 null（无法判定），而非通过。 */
export function verifyEventSignature(event, publicKey) {
  if (!event.signature || !publicKey) return null;
  return verify(null, Buffer.from(eventDigest(event), "utf8"), publicKey, Buffer.from(event.signature, "hex"));
}
