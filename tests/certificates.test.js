import test from "node:test";
import assert from "node:assert/strict";

import { newLedger } from "./helpers.js";
import { buildScenario, FIXTURE_IDS as I } from "../examples/fixture.mjs";
import {
  generateSigner,
  issueStageCertificate,
  verifyCertificateSignature,
  verifyAgainstLedger,
  publicKeyPem,
} from "../src/certificates.js";

async function scenario() {
  const { ledger, store } = await newLedger();
  buildScenario(ledger);
  return { ledger, store };
}

test("阶段证明签发并可被公钥验签", async () => {
  const { store } = await scenario();
  const signer = generateSigner();
  const cert = await issueStageCertificate(store, {
    person_id: I.P,
    stage: "authorization",
    included_event_ids: ["demo-safety-001", "demo-assessment-001", "demo-authz-001"],
    signer,
  });
  assert.equal(cert.stage, "authorization");
  assert.equal(cert.events.length, 3);
  const result = await verifyCertificateSignature(cert, signer.publicKey);
  assert.equal(result.ok, true);
  assert.equal(result.person_id, I.P);
});

test("证明正文被改动后验签失败", async () => {
  const { store } = await scenario();
  const signer = generateSigner();
  const cert = await issueStageCertificate(store, {
    person_id: I.P,
    stage: "training",
    included_event_ids: ["demo-practice-chase"],
    signer,
  });
  cert.title = "伪造的标题";
  const result = await verifyCertificateSignature(cert, signer.publicKey);
  assert.equal(result.ok, false);
});

test("他人私钥签名的证明无法用中心公钥通过", async () => {
  const { store } = await scenario();
  const signer = generateSigner({ keyId: "real" });
  const attacker = generateSigner({ keyId: "attacker" });
  const cert = await issueStageCertificate(store, {
    person_id: I.P,
    stage: "enrollment",
    included_event_ids: ["demo-enrollment-001"],
    signer: attacker,
  });
  const result = await verifyCertificateSignature(cert, signer.publicKey);
  assert.equal(result.ok, false);
});

test("不能把别人的事件纳入自己的阶段证明", async () => {
  const { store } = await scenario();
  const signer = generateSigner();
  await assert.rejects(
    () =>
      issueStageCertificate(store, {
        person_id: "p:someone-else",
        stage: "enrollment",
        included_event_ids: ["demo-enrollment-001"],
        signer,
      }),
    /不属于学员/,
  );
});

test("强验证：证明与账本逐条核对通过；篡改账本事件后被发现", async () => {
  const { store } = await scenario();
  const signer = generateSigner();
  const cert = await issueStageCertificate(store, {
    person_id: I.P,
    stage: "employment",
    included_event_ids: ["demo-placement-001", "demo-authz-001"],
    signer,
  });

  const ok = await verifyAgainstLedger(cert, store, signer.publicKey);
  assert.equal(ok.ok, true);
  assert.equal(ok.chain_intact, true);

  // 篡改被引用事件
  const target = store.events.find((e) => e.event_id === "demo-placement-001");
  target.payload.employer_name = "幽灵雇主";
  const bad = await verifyAgainstLedger(cert, store, signer.publicKey);
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /哈希不一致/);
});

test("验签公钥可导出为 PEM 并用于验证", async () => {
  const { store } = await scenario();
  const signer = generateSigner();
  const cert = await issueStageCertificate(store, {
    person_id: I.P,
    stage: "assessment",
    included_event_ids: ["demo-assessment-001"],
    signer,
  });
  const pem = publicKeyPem(signer);
  assert.match(pem, /BEGIN PUBLIC KEY/);
  const { createPublicKey } = await import("node:crypto");
  const result = await verifyCertificateSignature(cert, createPublicKey(pem));
  assert.equal(result.ok, true);
});
