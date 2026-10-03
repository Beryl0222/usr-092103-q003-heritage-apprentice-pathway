/**
 * 读模型投影：从只追加事件派生出可查询的视图（不另存"真相"，随时可重放）。
 *
 *  - buildResumeTimeline：个人可核验历程（报名→师徒→课程→练习/作品→评语→安全/考核→授权→试用→就业→补助），
 *    关系更替以"阶段（epoch）"呈现，旧阶段保持可引用。
 *  - buildAuthorizationMatrix：门店视角——每个工序/步骤当前被允许独立承担、仅监督、还是未授权。
 *  - buildSubsidyReport：管理/财政视角——每笔补助对应到哪些学习/考核/就业证据，是否成立（不含私人资料）。
 */
import { hashEvent } from "./store.js";

const chronological = (events) =>
  [...events].sort((a, b) => {
    const t = new Date(a.occurred_at) - new Date(b.occurred_at);
    if (t !== 0) return t;
    return a.version - b.version;
  });

/* ---------------- 个人历程时间线 ---------------- */

export function buildResumeTimeline(events, { personId } = {}) {
  const list = chronological(personId ? events.filter((e) => e.payload?.person_id === personId || e.event_type === "RELATIONSHIP_SUPERSEDED") : events);

  const epochs = [];
  let currentEpoch = null;
  const items = [];

  for (const e of list) {
    if (e.event_type === "MENTORSHIP_LINKED") {
      currentEpoch = {
        mentorship_aggregate_id: e.aggregate_id,
        mentor_id: e.payload.mentor_id,
        studio_id: e.payload.studio_id,
        craft_id: e.payload.craft_id,
        from: e.payload.effective_from ?? e.occurred_at,
        until: null,
        exit_reason: null,
        superseded_by: null,
      };
      epochs.push(currentEpoch);
    }
    if (e.event_type === "MENTORSHIP_ENDED" && currentEpoch && currentEpoch.mentorship_aggregate_id === e.aggregate_id) {
      currentEpoch.until = e.payload.effective_until ?? e.occurred_at;
      currentEpoch.exit_reason = e.payload.exit_reason;
    }
    if (e.event_type === "RELATIONSHIP_SUPERSEDED") {
      const ep = epochs.find((x) => x.mentorship_aggregate_id === e.aggregate_id) ?? epochs[epochs.length - 1];
      if (ep) {
        ep.until = ep.until ?? e.payload.effective_from;
        ep.exit_reason = ep.exit_reason ?? e.payload.exit_reason;
        ep.superseded_by = e.payload.new_aggregate_id;
      }
    }

    items.push({
      event_id: e.event_id,
      event_type: e.event_type,
      aggregate_id: e.aggregate_id,
      occurred_at: e.occurred_at,
      version: e.version,
      summary: e.summary,
      craft_id: e.payload?.craft_id,
      decision: e.payload?.decision ?? e.payload?.employment_status ?? e.payload?.trial_result ?? null,
      reference_ids: e.reference_ids ?? e.payload?.reference_ids ?? [],
      event_hash: e.signature?.event_hash ?? null,
      epoch: currentEpoch ? currentEpoch.mentorship_aggregate_id : null,
    });
  }

  return {
    person_id: personId ?? null,
    generated_at: new Date().toISOString(),
    epochs: epochs.map((ep) => ({ ...ep, still_citable: true })),
    items,
  };
}

/* ---------------- 门店工序授权矩阵 ---------------- */

/**
 * 计算某人当前的独立上岗授权。
 * AUTHORIZATION_GRANTED 授权步骤；AUTHORIZATION_REVOKED 收回（revoked_step_ids 缺省视为整道工序收回）。
 * 仅统计在 effective 时间窗内的授权。
 */
export function buildAuthorizationMatrix(events, { personId, at = new Date() } = {}) {
  const atTime = new Date(at);
  const mine = chronological(events.filter((e) => e.payload?.person_id === personId));
  /** craft_id -> Set(step) */
  const granted = new Map();
  const grantRecords = [];

  for (const e of mine) {
    if (e.event_type !== "AUTHORIZATION_GRANTED" && e.event_type !== "AUTHORIZATION_REVOKED") continue;
    const p = e.payload;
    const from = new Date(p.effective_from ?? e.occurred_at);
    const until = p.effective_until ? new Date(p.effective_until) : null;
    const activeNow = from <= atTime && (!until || until >= atTime);

    if (e.event_type === "AUTHORIZATION_GRANTED") {
      if (!granted.has(p.craft_id)) granted.set(p.craft_id, new Set());
      grantRecords.push({
        craft_id: p.craft_id,
        steps: p.authorized_step_ids,
        scope: p.scope,
        from: from.toISOString(),
        until: until ? until.toISOString() : null,
        active: activeNow,
        confirmed_by_inheritor_id: p.confirmed_by_inheritor_id,
        event_id: e.event_id,
      });
      if (activeNow) for (const s of p.authorized_step_ids) granted.get(p.craft_id).add(s);
    } else {
      const set = granted.get(p.craft_id);
      if (!set) continue;
      const revoke = p.revoked_step_ids ?? [...set];
      if (activeNow || (!until && from <= atTime)) for (const s of revoke) set.delete(s);
    }
  }

  const crafts = {};
  for (const [craftId, steps] of granted) {
    crafts[craftId] = {
      independent_step_ids: [...steps],
      can_work_independently: steps.size > 0,
    };
  }

  return {
    person_id: personId,
    as_of: atTime.toISOString(),
    crafts,
    grants: grantRecords,
  };
}

/** 门店判断：该学员此刻能否在某工序独立承担给定步骤。 */
export function canWorkIndependently(matrix, craftId, stepIds = []) {
  const row = matrix.crafts[craftId];
  if (!row) return { ok: false, missing: [...stepIds] };
  const missing = stepIds.filter((s) => !row.independent_step_ids.includes(s));
  return { ok: missing.length === 0, missing };
}

/* ---------------- 补助核验报告 ---------------- */

export function buildSubsidyReport(events, { personId } = {}) {
  const byId = new Map(events.map((e) => [e.event_id, e]));
  const subsidies = events.filter(
    (e) => e.event_type === "SUBSIDY_DISBURSED" && (!personId || e.payload?.person_id === personId),
  );

  const rows = subsidies.map((e) => {
    const { amount, currency, stage, evidence_event_ids: ids = [] } = e.payload.subsidy;
    const evidence = ids.map((id) => {
      const ev = byId.get(id);
      if (!ev) return { event_id: id, exists: false };
      return {
        event_id: id,
        exists: true,
        event_type: ev.event_type,
        occurred_at: ev.occurred_at,
        decision: ev.payload?.decision ?? ev.payload?.employment_status ?? null,
      };
    });
    const missing = ids.filter((id) => !byId.has(id));
    const matched = missing.length === 0;
    return {
      subsidy_event_id: e.event_id,
      person_id: e.payload.person_id,
      stage,
      amount,
      currency,
      occurred_at: e.occurred_at,
      matched,
      evidence,
    };
  });

  const totals = {};
  for (const r of rows) {
    totals[r.stage] = (totals[r.stage] ?? 0) + (r.matched ? r.amount : 0);
  }

  return {
    person_id: personId ?? null,
    generated_at: new Date().toISOString(),
    note: "仅含政策核验字段，不含联系方式与未公开作品细节。",
    total_matched: rows.filter((r) => r.matched).reduce((s, r) => s + r.amount, 0),
    total_unmatched: rows.filter((r) => !r.matched).reduce((s, r) => s + r.amount, 0),
    totals_by_stage: totals,
    subsidies: rows,
  };
}

/* ---------------- 哈希链工具（供证明/接口复用） ---------------- */

export { hashEvent };
