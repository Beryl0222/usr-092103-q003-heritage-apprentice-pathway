import test from "node:test";
import assert from "node:assert/strict";

import { newLedger } from "./helpers.js";
import { buildScenario, FIXTURE_IDS as I } from "../examples/fixture.mjs";
import { createApp } from "../src/app.js";
import { generateSigner } from "../src/certificates.js";

async function startServer() {
  const { ledger } = await newLedger();
  buildScenario(ledger);
  const signer = generateSigner();
  const app = createApp({ ledger, signer });
  await new Promise((resolve) => app.listen(0, resolve));
  const port = app.address().port;
  const base = `http://127.0.0.1:${port}`;
  return { base, app, signer };
}

test("健康检查返回事件数与哈希链状态", async () => {
  const { base, app } = await startServer();
  try {
    const res = await fetch(`${base}/health`);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.chain, "intact");
    assert.ok(body.events >= 21);
  } finally {
    app.close();
  }
});

test("POST /events：非法事件（评语带分数）被 422 拒绝", async () => {
  const { base, app } = await startServer();
  try {
    const res = await fetch(`${base}/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event_id: "bad-comment",
        event_type: "MASTER_COMMENT_ISSUED",
        aggregate_id: "comment:bad",
        occurred_at: "2026-12-01T10:00:00+08:00",
        version: 1,
        summary: "违规评分评语",
        policy_context: { sensitivity: "standard", visibility: "restricted" },
        payload: {
          actor_id: I.CHEN,
          reason: "r",
          person_id: I.P,
          observations: "x",
          scoring_forbidden_reason: "不可分数化",
          score: { score_kind: "course_grade", value: 90, scale_max: 100 },
        },
      }),
    });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.details.some((d) => d.includes("观察性评语禁止携带 score")));
  } finally {
    app.close();
  }
});

test("门店视角授权矩阵与逐步骤判定", async () => {
  const { base, app } = await startServer();
  try {
    const url = `${base}/persons/${encodeURIComponent(I.P)}/authorization?craft=${I.CRAFT}&steps=mr:chase,mr:anneal&at=2026-11-01T00:00:00%2B08:00`;
    const res = await fetch(url, { headers: { "x-viewer-role": "shop", "x-viewer-party-id": I.SHOP } });
    const body = await res.json();
    assert.equal(body.check.ok, false);
    assert.deepEqual(body.check.missing, ["mr:anneal"]);
  } finally {
    app.close();
  }
});

test("管理部门调补助报告拿不到私人字段，但能核对金额", async () => {
  const { base, app } = await startServer();
  try {
    const res = await fetch(`${base}/persons/${encodeURIComponent(I.P)}/subsidy-report`, {
      headers: { "x-viewer-role": "district", "x-viewer-party-id": "district:center" },
    });
    const body = await res.json();
    assert.equal(body.total_matched, 7500);
    assert.equal(body.subsidies.length, 4);
    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes("138-0000"), "报告中不得出现电话");
    assert.ok(!serialized.includes("青年公寓"), "报告中不得出现地址");
  } finally {
    app.close();
  }
});

test("事件列表按观察者裁剪：未授权公众看不到未公开作品名", async () => {
  const { base, app } = await startServer();
  try {
    const res = await fetch(`${base}/events?person_id=${encodeURIComponent(I.P)}`);
    const body = await res.json();
    const batch = body.events.find((e) => e.event_id === "demo-batch-001");
    assert.equal(batch.payload.work_titles, undefined);
  } finally {
    app.close();
  }
});

test("阶段证明签发后可通过 /certificates/verify 验签并对账本强校验", async () => {
  const { base, app } = await startServer();
  try {
    const issue = await fetch(`${base}/persons/${encodeURIComponent(I.P)}/certificates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        stage: "authorization",
        included_event_ids: ["demo-safety-001", "demo-assessment-001", "demo-authz-001"],
      }),
    });
    assert.equal(issue.status, 201);
    const { certificate } = await issue.json();
    assert.ok(certificate.verification.signature);

    const verify = await fetch(`${base}/certificates/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ certificate, against_ledger: true }),
    });
    const result = await verify.json();
    assert.equal(result.ok, true);
    assert.equal(result.chain_intact, true);
  } finally {
    app.close();
  }
});

test("未知路由返回 404", async () => {
  const { base, app } = await startServer();
  try {
    const res = await fetch(`${base}/nope`);
    assert.equal(res.status, 404);
  } finally {
    app.close();
  }
});
