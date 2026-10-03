/**
 * 隐私与数据最小化。
 *
 * 访问原则（对应需求）：
 *  - 联系方式仅向：学员本人、或经其 CONTACT_POLICY_ACKNOWLEDGED 明确授权的机构/人员开放；
 *    管理部门（district/fiscal）做政策核验时看不到联系方式。
 *  - 未公开作品（protected_work）仅向：本人、当前在带的师傅/工作室、批次 allowed_party_ids 开放。
 *  - 叙述性观察（师傅评语）仅向本人、师傅/工作室、记录作者开放；管理部门只见结论性字段。
 *  - district / fiscal 走最小化字段：只保留与学习、考核、就业、补助核验相关的结构化字段。
 */
import { VIEWER_ROLES, SENSITIVITY } from "./vocabulary.js";

/**
 * 根据历史事件计算某观察者的访问能力集合。
 * @param {object[]} events 全量（或相关）事件
 * @param {{role: string, party_id?: string, person_id?: string}} viewer
 */
export function createAccess(events, viewer) {
  const contactAuthorizedFor = new Set(); // person_id 集合：viewer 可看其联系方式
  const mentorsOf = new Map(); // person_id -> Set(mentor_id)
  const endedMentorships = new Set(); // 以 aggregate 计的师徒关系是否结束

  for (const e of events) {
    const p = e.payload ?? {};
    if (e.event_type === "CONTACT_POLICY_ACKNOWLEDGED" && p.decision === "acknowledged") {
      if ((p.allowed_party_ids ?? []).includes(viewer.party_id)) contactAuthorizedFor.add(p.person_id);
    }
    if (e.event_type === "MENTORSHIP_LINKED") {
      if (!mentorsOf.has(p.person_id)) mentorsOf.set(p.person_id, new Set());
      mentorsOf.get(p.person_id).add(p.mentor_id);
    }
    if (e.event_type === "MENTORSHIP_ENDED") endedMentorships.add(e.aggregate_id);
  }

  const isSelf = (personId) => viewer.role === VIEWER_ROLES.SELF && viewer.person_id === personId;

  const canViewContact = (personId) => {
    if (isSelf(personId)) return true;
    return contactAuthorizedFor.has(personId);
  };

  const canViewProtectedWork = (event) => {
    const personId = event.payload?.person_id;
    if (isSelf(personId)) return true;
    if ((event.policy_context?.allowed_party_ids ?? []).includes(viewer.party_id)) return true;
    // 当前在带的师傅/工作室可见；师傅退出后历史批次是否可见由 allowed_party_ids 决定。
    if (viewer.role === VIEWER_ROLES.STUDIO_MENTOR && mentorsOf.get(personId)?.has(viewer.party_id)) {
      // 该师徒关系未结束
      const linked = events.find(
        (x) => x.event_type === "MENTORSHIP_LINKED" && x.payload?.person_id === personId && x.payload?.mentor_id === viewer.party_id,
      );
      if (linked && !endedMentorships.has(linked.aggregate_id)) return true;
    }
    return false;
  };

  const canViewNarrative = (event) => {
    const personId = event.payload?.person_id;
    if (isSelf(personId)) return true;
    if (viewer.role === VIEWER_ROLES.STUDIO_MENTOR) return true;
    if (event.payload?.actor_id === viewer.party_id) return true; // 评语/评定的作者
    return false;
  };

  return { viewer, isSelf, canViewContact, canViewProtectedWork, canViewNarrative };
}

const MINIMIZED_ROLES = new Set([VIEWER_ROLES.DISTRICT, VIEWER_ROLES.FISCAL]);

/**
 * 按观察者裁剪单条事件。返回新对象（不改原事件），并在 _redactions 中列出被裁掉的路径。
 * @param {object} event
 * @param {ReturnType<typeof createAccess>} access
 */
export function redactEvent(event, access) {
  const { viewer } = access;
  const clone = structuredClone(event);
  const redactions = [];
  const drop = (path) => {
    redactions.push(path);
  };

  const p = clone.payload ?? {};
  const minimize = MINIMIZED_ROLES.has(viewer.role);

  // 联系方式
  if (p.contact !== undefined && !access.canViewContact(p.person_id)) {
    delete p.contact;
    drop("payload.contact");
    if (clone.policy_context?.contact_fields) {
      clone.policy_context.contact_fields = clone.policy_context.contact_fields.map(() => "●");
    }
  }

  // 未公开作品内容
  const isProtected = clone.policy_context?.sensitivity === SENSITIVITY.PROTECTED_WORK;
  if (isProtected && !access.canViewProtectedWork(clone)) {
    for (const key of ["work_titles", "attribution", "observations"]) {
      if (p[key] !== undefined) {
        delete p[key];
        drop(`payload.${key}`);
      }
    }
    clone.summary = "未公开作品（细节限授权人员）";
  }

  // 叙述性观察：管理核验只看结论，不看评语原文
  if (p.observations !== undefined && (minimize || !access.canViewNarrative(clone))) {
    if (!redactions.includes("payload.observations")) {
      delete p.observations;
      drop("payload.observations");
    }
  }
  if (p.scoring_forbidden_reason !== undefined && minimize) {
    delete p.scoring_forbidden_reason;
    drop("payload.scoring_forbidden_reason");
  }
  // 私人地址类兜底：管理角色即便误标也不看 contact（已在上面处理）。

  if (redactions.length) clone._redactions = redactions;
  return clone;
}

/** 便捷：批量裁剪。 */
export function redactEvents(events, viewer) {
  const access = createAccess(events, viewer);
  return events.map((e) => redactEvent(e, access));
}
