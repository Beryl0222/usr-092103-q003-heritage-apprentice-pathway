/**
 * 只追加事件存储（append-only log）。
 *
 * 关键性质：
 * - 事件只增不改；跨工作室、换课程、师傅退出都以新事件表达，旧记录永不删除、保持可引用。
 * - 同一 aggregate_id 内 version 单调递增；重复 event_id 幂等拒绝。
 * - 每条事件对"规范化内容 + 前一条哈希"计算 SHA-256，形成哈希链，供阶段证明与防篡改校验。
 * - 可选 JSONL 持久化（测试中用内存版）。
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, appendFileSync } from "node:fs";

const GENESIS_HASH = "0".repeat(64);

/** 去掉签名自身后按 key 排序序列化，保证哈希稳定可复算。 */
export function canonicalize(event) {
  const { signature: _sig, ...body } = event;
  const sortKeys = (value) => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.keys(value)
          .sort()
          .map((k) => [k, sortKeys(value[k])]),
      );
    }
    return value;
  };
  return JSON.stringify(sortKeys(body));
}

export function hashEvent(event, prevHash) {
  return createHash("sha256").update(prevHash).update("\n").update(canonicalize(event)).digest("hex");
}

export class AppendError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "AppendError";
    this.code = code;
  }
}

export class EventStore {
  constructor({ file, clock = () => new Date() } = {}) {
    this.file = file ?? null;
    this.clock = clock;
    /** @type {object[]} */
    this.events = [];
    this._ids = new Set();
    /** aggregate_id -> 当前版本 */
    this._aggVersion = new Map();
    this._tailHash = GENESIS_HASH;
    if (file && existsSync(file)) this._load();
  }

  _load() {
    const lines = readFileSync(this.file, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    for (const line of lines) {
      const event = JSON.parse(line);
      this._index(event);
    }
  }

  _index(event) {
    this.events.push(event);
    this._ids.add(event.event_id);
    this._aggVersion.set(event.aggregate_id, event.version);
    if (event.signature?.event_hash) this._tailHash = event.signature.event_hash;
  }

  /** 追加前的当前哈希（链尾）。 */
  get tailHash() {
    return this._tailHash;
  }

  nextVersion(aggregateId) {
    return (this._aggVersion.get(aggregateId) ?? 0) + 1;
  }

  has(eventId) {
    return this._ids.has(eventId);
  }

  byAggregate(aggregateId) {
    return this.events.filter((e) => e.aggregate_id === aggregateId);
  }

  byPerson(personId) {
    return this.events.filter((e) => e.payload?.person_id === personId);
  }

  /**
   * 追加一条事件。
   * @param {object} input 已通过结构/语义校验的事件
   * @param {{forceVersion?: boolean}} [opts]
   */
  append(input) {
    if (!input || typeof input !== "object") throw new AppendError("事件必须是对象", "bad_input");
    if (this._ids.has(input.event_id)) {
      throw new AppendError(`event_id 已存在（幂等拒绝）：${input.event_id}`, "duplicate_id");
    }

    const expectedVersion = this.nextVersion(input.aggregate_id);
    if (input.version !== expectedVersion) {
      throw new AppendError(
        `聚合 ${input.aggregate_id} 版本应为 ${expectedVersion}，收到 ${input.version}`,
        "bad_version",
      );
    }

    const event = { ...input, recorded_at: input.recorded_at ?? this.clock().toISOString() };
    const prevHash = this._tailHash;
    const eventHash = hashEvent(event, prevHash);
    event.signature = { ...(event.signature ?? {}), prev_hash: prevHash, event_hash: eventHash };

    if (this.file) appendFileSync(this.file, JSON.stringify(event) + "\n");
    this._index(event);
    return event;
  }

  /** 重算整条哈希链，返回首个断裂点（没有则 null）。 */
  verifyChain() {
    let prev = GENESIS_HASH;
    for (const event of this.events) {
      const recomputed = hashEvent(event, prev);
      if (event.signature?.prev_hash !== prev) {
        return { event_id: event.event_id, problem: "prev_hash 不衔接" };
      }
      if (event.signature?.event_hash !== recomputed) {
        return { event_id: event.event_id, problem: "event_hash 不匹配，内容可能被改动" };
      }
      prev = recomputed;
    }
    return null;
  }
}
