/**
 * HTTP 接口（node:http，无第三方依赖）。
 *
 * 路由：
 *  GET  /health
 *  POST /events                         写入一条事件（结构+语义校验通过才落库）
 *  GET  /events?person_id=              原始事件（按观察者裁剪）
 *  GET  /persons/:id/resume             个人可核验历程（按观察者裁剪）
 *  GET  /persons/:id/authorization      门店工序授权矩阵；?craft=&steps=a,b&at=
 *  GET  /persons/:id/subsidy-report     补助核验报告（管理/财政最小化）
 *  POST /persons/:id/certificates       导出阶段证明  body:{stage, included_event_ids}
 *  POST /certificates/verify            验证明  body:{certificate, against_ledger?:boolean}
 *  GET  /verification-key               证明验签公钥（PEM）
 *
 * 观察者身份通过请求头传入（演示用，生产应替换为真实鉴权）：
 *    x-viewer-role: self|studio_mentor|school|shop|district|fiscal|public
 *    x-viewer-party-id / x-viewer-person-id
 */
import { createServer } from "node:http";
import {
  publicKeyPem,
  issueStageCertificate,
  verifyCertificateSignature,
  verifyAgainstLedger,
} from "./certificates.js";
import { redactEvents } from "./policy.js";
import { buildResumeTimeline, buildAuthorizationMatrix, canWorkIndependently, buildSubsidyReport } from "./projections.js";
import { ValidationError } from "./service.js";
import { AppendError } from "./store.js";
import { VIEWER_ROLES } from "./vocabulary.js";

const viewerFromRequest = (req) => {
  const role = req.headers["x-viewer-role"] ?? VIEWER_ROLES.PUBLIC;
  return {
    role,
    party_id: req.headers["x-viewer-party-id"] ? String(req.headers["x-viewer-party-id"]) : undefined,
    person_id: req.headers["x-viewer-person-id"] ? String(req.headers["x-viewer-person-id"]) : undefined,
  };
};

const json = (res, status, body) => {
  const text = JSON.stringify(body, null, 2);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(text);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 5_000_000) reject(new Error("请求体过大"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`JSON 解析失败：${err.message}`));
      }
    });
    req.on("error", reject);
  });

export function createApp({ ledger, signer }) {
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;
    const viewer = viewerFromRequest(req);

    try {
      if (req.method === "GET" && pathname === "/health") {
        return json(res, 200, { ok: true, events: ledger.store.events.length, chain: ledger.store.verifyChain() ?? "intact" });
      }

      if (req.method === "GET" && pathname === "/verification-key") {
        res.writeHead(200, { "content-type": "application/x-pem-file; charset=utf-8" });
        return res.end(publicKeyPem(signer));
      }

      if (req.method === "POST" && pathname === "/events") {
        const body = await readBody(req);
        const saved = ledger.record(body);
        return json(res, 201, { ok: true, event: saved });
      }

      if (req.method === "GET" && pathname === "/events") {
        const personId = url.searchParams.get("person_id");
        const events = personId ? ledger.store.byPerson(personId) : ledger.store.events;
        return json(res, 200, { events: redactEvents(events, viewer) });
      }

      const personMatch = pathname.match(/^\/persons\/([^/]+)\/(resume|authorization|subsidy-report)$/);
      if (req.method === "GET" && personMatch) {
        const personId = decodeURIComponent(personMatch[1]);
        const kind = personMatch[2];

        if (kind === "resume") {
          const visible = redactEvents(ledger.store.events, viewer);
          return json(res, 200, buildResumeTimeline(visible, { personId }));
        }
        if (kind === "authorization") {
          const at = url.searchParams.get("at") ?? new Date();
          const matrix = buildAuthorizationMatrix(ledger.store.events, { personId, at });
          const craft = url.searchParams.get("craft");
          const steps = (url.searchParams.get("steps") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          const result = { ...matrix };
          if (craft) result.check = canWorkIndependently(matrix, craft, steps);
          return json(res, 200, result);
        }
        // subsidy-report
        return json(res, 200, buildSubsidyReport(ledger.store.events, { personId }));
      }

      const certMatch = pathname.match(/^\/persons\/([^/]+)\/certificates$/);
      if (req.method === "POST" && certMatch) {
        const personId = decodeURIComponent(certMatch[1]);
        const body = await readBody(req);
        const cert = await issueStageCertificate(ledger.store, {
          person_id: personId,
          stage: body.stage,
          included_event_ids: body.included_event_ids,
          signer,
        });
        // 出具动作本身入链，便于审计"何时向谁出过哪份阶段证明"。
        ledger.record({
          event_id: `cert-issued-${cert.certificate_id}`,
          event_type: "STAGE_CERTIFICATE_ISSUED",
          aggregate_id: cert.certificate_id,
          occurred_at: new Date().toISOString(),
          summary: `出具${cert.title}`,
          policy_context: { sensitivity: "standard", visibility: "public_verifiable" },
          payload: {
            actor_id: viewer.person_id ?? viewer.party_id ?? "self",
            reason: "学员申请导出带验证信息的阶段证明",
            person_id: personId,
            certificate: { stage: body.stage, included_event_ids: body.included_event_ids },
          },
        });
        return json(res, 201, { ok: true, certificate: cert });
      }

      if (req.method === "POST" && pathname === "/certificates/verify") {
        const body = await readBody(req);
        if (!body.certificate) return json(res, 400, { ok: false, error: "缺少 certificate" });
        const result = body.against_ledger
          ? await verifyAgainstLedger(body.certificate, ledger.store, signer.publicKey)
          : await verifyCertificateSignature(body.certificate, signer.publicKey);
        return json(res, result.ok ? 200 : 422, result);
      }

      return json(res, 404, { ok: false, error: "未找到路由" });
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 422, { ok: false, error: "事件未通过校验", details: err.errors });
      if (err instanceof AppendError) return json(res, 409, { ok: false, error: err.message, code: err.code });
      return json(res, 400, { ok: false, error: err.message });
    }
  });
}
