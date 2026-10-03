/**
 * 应用服务：写入路径的唯一入口。
 * 负责：结构校验 -> 语义规则 -> 分配聚合版本 -> 追加哈希链。
 * 读模型（履历时间线 / 授权矩阵 / 补助核验）见 projections.js，隐私裁剪见 policy.js。
 */
import { validateEvent } from "./validator.js";
import { checkSemantics } from "./rules.js";
import { AppendError, EventStore } from "./store.js";
import { Directory } from "./directory.js";
import { EVENT_AGGREGATE } from "./vocabulary.js";

export class ValidationError extends Error {
  constructor(errors) {
    super(`事件未通过校验：\n - ${errors.join("\n - ")}`);
    this.name = "ValidationError";
    this.errors = errors;
  }
}

export class ApprenticeLedger {
  /**
   * @param {{store?: EventStore, directory?: Directory, clock?: () => Date}} opts
   */
  constructor({ store, directory, clock } = {}) {
    this.store = store ?? new EventStore({ clock });
    this.directory = directory ?? null;
    this.clock = clock ?? (() => new Date());
  }

  withDirectory(directory) {
    this.directory = directory;
    return this;
  }

  /**
   * 校验并追加一条事件。version 可省略，由存储按聚合自动分配。
   * @returns {object} 已落库（含签名）的事件
   */
  record(input) {
    const candidate = { ...input };
    // aggregate_type 可省略，按事件类型的稳定归属自动填充。
    if (candidate.aggregate_type === undefined && EVENT_AGGREGATE[candidate.event_type]) {
      candidate.aggregate_type = EVENT_AGGREGATE[candidate.event_type];
    }
    if (!Number.isInteger(candidate.version) || candidate.version < 1) {
      candidate.version = this.store.nextVersion(candidate.aggregate_id);
    }

    const structural = validateEvent(candidate);
    if (structural.length) throw new ValidationError(structural);

    if (this.directory) {
      const semantic = checkSemantics(candidate, { store: this.store, directory: this.directory });
      if (semantic.length) throw new ValidationError(semantic);
    }

    try {
      return this.store.append(candidate);
    } catch (err) {
      if (err instanceof AppendError) throw err;
      throw err;
    }
  }

  /** 关系更替的便捷写法：结束旧关系，并令其指向新生效关系；旧记录保留、仍可引用。 */
  supersede({ oldAggregateId, newAggregateId, exitReason, actorId, reason, occurredAt, referenceIds = [] }) {
    return this.record({
      event_id: `rel-sup-${oldAggregateId}-${Date.now()}`,
      event_type: "RELATIONSHIP_SUPERSEDED",
      aggregate_type: "apprenticeship",
      aggregate_id: oldAggregateId,
      occurred_at: occurredAt ?? this.clock().toISOString(),
      version: this.store.nextVersion(oldAggregateId),
      summary: `关系更替：${exitReason}，旧关系保持可引用`,
      policy_context: { sensitivity: "standard", visibility: "restricted" },
      reference_ids: referenceIds,
      payload: {
        actor_id: actorId,
        reason,
        exit_reason: exitReason,
        new_aggregate_id: newAggregateId,
        effective_from: occurredAt ?? this.clock().toISOString(),
      },
    });
  }
}
