/**
 * 名录（directory）访问：人员、传承人资格、工序核心步骤、机构。
 * 规则校验通过这里判断"谁有资格确认哪道核心工序"。
 */
import { readFile } from "node:fs/promises";

export class Directory {
  constructor(data) {
    this.data = data;
    this._people = new Map(data.people.map((p) => [p.person_id, p]));
    this._orgs = new Map(data.organizations.map((o) => [o.org_id, o]));
    this._crafts = new Map(data.crafts.map((c) => [c.craft_id, c]));
    this._creds = new Map(data.credentials.map((c) => [c.credential_id, c]));
  }

  static async load(path = new URL("../data/directory.json", import.meta.url)) {
    const raw = await readFile(path, "utf8");
    return new Directory(JSON.parse(raw));
  }

  person(id) {
    return this._people.get(id);
  }

  organization(id) {
    return this._orgs.get(id);
  }

  craft(id) {
    return this._crafts.get(id);
  }

  /** 返回某工序的核心步骤 id 集合。 */
  coreSteps(craftId) {
    const craft = this._crafts.get(craftId);
    if (!craft) return new Set();
    return new Set(craft.steps.filter((s) => s.is_core).map((s) => s.step_id));
  }

  /** 校验步骤 id 是否都属于该工序。 */
  unknownSteps(craftId, stepIds = []) {
    const craft = this._crafts.get(craftId);
    if (!craft) return [...stepIds];
    const known = new Set(craft.steps.map((s) => s.step_id));
    return stepIds.filter((id) => !known.has(id));
  }

  credential(id) {
    return this._creds.get(id);
  }

  /**
   * 判断某凭证在指定日期是否使其持有人具备确认某工序核心步骤的资格。
   * 返回 { ok:true } 或 { ok:false, reason }。
   */
  checkInheritorCredential(credentialId, craftId, date = new Date()) {
    const cred = this._creds.get(credentialId);
    if (!cred) return { ok: false, reason: `传承人资格凭证不存在：${credentialId}` };
    if (cred.kind !== "heritage_inheritor") {
      return { ok: false, reason: `凭证 ${credentialId} 不是传承人资格凭证` };
    }
    if (cred.status !== "active") return { ok: false, reason: `凭证 ${credentialId} 状态非 active` };
    const at = date instanceof Date ? date : new Date(date);
    if (new Date(cred.valid_from) > at) return { ok: false, reason: `凭证 ${credentialId} 尚未生效` };
    if (cred.valid_until && new Date(cred.valid_until) < at) {
      return { ok: false, reason: `凭证 ${credentialId} 已过有效期` };
    }
    if (!cred.crafts.includes(craftId)) {
      return { ok: false, reason: `凭证 ${credentialId} 不覆盖工序 ${craftId}` };
    }
    return { ok: true, person_id: cred.person_id };
  }
}
