import assert from "node:assert/strict";
import test from "node:test";

import { chainHash, eventDigest, generateSigningKey, signEvent } from "../src/crypto.js";
import {
  exportStageCertificate,
  processAuthorizationView,
  subsidyVerificationView,
  timeline,
  verifyRecorderSignature,
  verifyStageCertificate,
  viewForParty,
} from "../src/projections.js";
import { validateStream } from "../src/validator.js";
import { buildStream, LEARNER, ORGS } from "./fixtures.js";

function byId(events, id) {
  return events.find((e) => e.event_id === id);
}

test("工序授权视图：独立授权工序可独立上岗，未授权工序如实呈现", () => {
  const view = processAuthorizationView(buildStream(), LEARNER, "2026-10-16T00:00:00+08:00");
  assert.equal(view["brew-mash"].scope, "independent");
  assert.deepEqual(view["brew-mash"].authorized_steps, ["step-select", "step-turning"]);
  assert.equal(view["brew-mash"].status, "active");
  assert.equal(view["brew-mash"].safety_current, true);
});

test("工序授权视图：撤销与到期后回到未授权", () => {
  let events = structuredClone(buildStream());
  events.push({
    event_id: "EV-L001-REVOKE-1",
    prev_event_id: "EV-L001-ACCESS-1",
    event_type: "PROCESS_AUTHORIZATION_REVOKED",
    aggregate_type: "work_authorization",
    aggregate_id: "AUTH-L001-BM-1",
    occurred_at: "2026-10-20T09:00:00+08:00",
    version: 2,
    summary: "门店撤销授权",
    recorded_by: ORGS.store,
    payload: {
      learner_id: LEARNER,
      process_code: "brew-mash",
      revoked_at: "2026-10-20T09:00:00+08:00",
      reason: "safety_incident",
    },
  });
  const view = processAuthorizationView(events, LEARNER, "2026-10-21T00:00:00+08:00");
  assert.equal(view["brew-mash"].scope, "none");
  assert.equal(view["brew-mash"].status, "revoked");
});

test("脱敏视图：未获准方看不到未公开作品与联系方式，获准方可见", () => {
  const events = buildStream();
  const at = "2026-10-17T00:00:00+08:00";

  const stranger = viewForParty(events, LEARNER, { org_code: "other-store", person_id: "R-OTHER-1" }, at);
  const batch = stranger.find((e) => e.event_id === "EV-L001-BATCH-1");
  assert.equal(batch.payload.title, undefined);
  assert.equal(batch.payload.redacted, "未公开作品：仅向获准人员开放");
  const enroll = stranger.find((e) => e.event_id === "EV-L001-ENROLL");
  assert.equal(enroll.payload.phone, "***");

  const grantee = viewForParty(
    events,
    LEARNER,
    { org_code: ORGS.store.org_code, person_id: "R-STORE88-07" },
    at
  );
  const visibleBatch = grantee.find((e) => e.event_id === "EV-L001-BATCH-1");
  assert.equal(visibleBatch.payload.title, "秋汛第四翻样坯六件");

  // 授权过期后重新封闭
  const expired = viewForParty(
    events,
    LEARNER,
    { org_code: ORGS.store.org_code, person_id: "R-STORE88-07" },
    "2027-02-01T00:00:00+08:00"
  );
  assert.equal(expired.find((e) => e.event_id === "EV-L001-BATCH-1").payload.title, undefined);
});

test("时间线：被接替的旧师承保留且标注 ended，新师承另行生效", () => {
  const tl = timeline(buildStream(), LEARNER);
  const oldRel = tl.find((e) => e.event_id === "EV-L001-APPR-START");
  const newRel = tl.find((e) => e.event_id === "EV-L001-APPR-START-B");
  assert.equal(oldRel.state, "ended");
  assert.equal(newRel.state, "active");
  assert.equal(newRel.supersedes, "APPR-L001-A");
  // 旧关系下的练习与确认仍在时间线中可引用
  assert.ok(tl.some((e) => e.event_id === "EV-L001-CONFIRM-1"));
});

test("补助核验视图：只含学习/考核/就业事实，不含评语与私人资料", () => {
  const view = subsidyVerificationView(buildStream(), LEARNER);
  assert.equal(view.eligibility.decision, "eligible");
  assert.equal(view.training[0].credits_hours, 120);
  assert.equal(view.authorizations[0].process_code, "brew-mash");
  assert.equal(view.employment.employment_type, "full_time");
  const json = JSON.stringify(view);
  assert.ok(!json.includes("narrative_text"));
  assert.ok(!json.includes("phone"));
  assert.ok(!json.includes("秋汛"));
});

test("阶段证明：导出后可用中心公钥验证，且重放领域不变量", () => {
  const { publicKey, privateKey } = generateSigningKey();
  const cert = exportStageCertificate(buildStream(), LEARNER, {
    upToEventId: "EV-L001-AUTH-1",
    stageTitle: "酱酿工序选料/翻坯独立操作阶段",
    issuerPrivateKey: privateKey,
    issuerOrgCode: ORGS.center.org_code,
    publicKeyId: "center-key-2026-01",
    issuedAt: "2026-10-02T12:00:00+08:00",
  });

  // 自包含参照事实（资质），门店离线可验证传承人资格
  assert.ok(cert.reference_events.some((e) => e.aggregate_id === "QUAL-M101"));

  const result = verifyStageCertificate(cert, publicKey, { validateStream });
  assert.deepEqual(result.reasons, [], result.reasons.join("\n"));
  assert.equal(result.valid, true);
});

test("阶段证明：篡改任一事件、伪造签名、删减事件都会验证失败", () => {
  const { publicKey, privateKey } = generateSigningKey();
  const other = generateSigningKey();
  const base = exportStageCertificate(buildStream(), LEARNER, {
    upToEventId: "EV-L001-AUTH-1",
    stageTitle: "阶段证明",
    issuerPrivateKey: privateKey,
    issuerOrgCode: ORGS.center.org_code,
    publicKeyId: "center-key-2026-01",
  });

  // 篡改事件内容
  const tampered = structuredClone(base);
  tampered.events.find((e) => e.event_id === "EV-L001-PRAC-1").payload.hours = 99;
  assert.equal(verifyStageCertificate(tampered, publicKey).valid, false);

  // 用他人密钥重签但内容仍引用原始摘要 → 摘要不符；若连同摘要伪造则中心签名失败
  const forged = structuredClone(base);
  forged.chain_hash = chainHash(forged.events) + "00";
  assert.equal(verifyStageCertificate(forged, publicKey).valid, false);

  // 非中心密钥签名
  const forged2 = exportStageCertificate(buildStream(), LEARNER, {
    upToEventId: "EV-L001-AUTH-1",
    stageTitle: "阶段证明",
    issuerPrivateKey: other.privateKey,
    issuerOrgCode: ORGS.center.org_code,
    publicKeyId: "center-key-2026-01",
  });
  assert.equal(verifyStageCertificate(forged2, publicKey).valid, false);

  // 删掉一条事件但保留外层签名 → 链式指纹/签名失败
  const shortened = structuredClone(base);
  shortened.events = shortened.events.filter((e) => e.event_id !== "EV-L001-PRAC-1");
  assert.equal(verifyStageCertificate(shortened, publicKey).valid, false);
});

test("机构间交换：出具方可用 Ed25519 对单条事件签名，接收方验证", () => {
  const { publicKey, privateKey } = generateSigningKey();
  const event = byId(buildStream(), "EV-L001-CONFIRM-1");
  const signed = signEvent(event, privateKey);
  assert.equal(verifyRecorderSignature(signed, publicKey), true);

  const tampered = { ...signed, summary: "被改写" };
  assert.equal(verifyRecorderSignature(tampered, publicKey), false);

  // 事件摘要在签名前后保持稳定（签名不参与摘要）
  assert.equal(eventDigest(signed), eventDigest(event));
});
