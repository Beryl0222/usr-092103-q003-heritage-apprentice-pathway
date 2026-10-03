/** 测试辅助：构建内存账本 + 名录。 */
import { ApprenticeLedger } from "../src/service.js";
import { EventStore } from "../src/store.js";
import { Directory } from "../src/directory.js";
import { fileURLToPath } from "node:url";

export async function newLedger() {
  const directory = await Directory.load(new URL("../data/directory.json", import.meta.url));
  const store = new EventStore();
  const ledger = new ApprenticeLedger({ store, directory });
  return { ledger, store, directory };
}

export { fileURLToPath };
