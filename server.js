#!/usr/bin/env node
/**
 * 传习履历后端启动入口（内存 + 可选 JSONL 持久化）。
 * 环境变量：
 *   LEDGER_FILE   事件 JSONL 路径（缺省仅内存）
 *   PORT          监听端口（缺省 8080）
 *   SIGNER_KEY    Ed25519 私钥 PEM 路径（缺省进程启动时临时生成，重启即换）
 */
import { readFileSync } from "node:fs";
import { ApprenticeLedger } from "./src/service.js";
import { EventStore } from "./src/store.js";
import { Directory } from "./src/directory.js";
import { generateSigner, loadSigner } from "./src/certificates.js";
import { createApp } from "./src/app.js";

const port = Number(process.env.PORT ?? 8080);
const file = process.env.LEDGER_FILE || null;

const store = new EventStore(file ? { file } : {});
const directory = await Directory.load();
const ledger = new ApprenticeLedger({ store, directory });

const signer = process.env.SIGNER_KEY
  ? loadSigner({
      keyId: process.env.SIGNER_KEY_ID ?? "district:center:key-1",
      privateKeyPem: readFileSync(process.env.SIGNER_KEY, "utf8"),
      publicKeyPem: process.env.SIGNER_PUBKEY ? readFileSync(process.env.SIGNER_PUBKEY, "utf8") : undefined,
    })
  : generateSigner();

const server = createApp({ ledger, signer });
server.listen(port, () => {
  console.log(`传习履历后端已启动：http://localhost:${port}`);
  console.log(`事件条数：${store.events.length}；持久化：${file ?? "内存"}；哈希链：${store.verifyChain() ? "异常" : "完整"}`);
});
