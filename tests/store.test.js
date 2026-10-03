import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rmSync } from "node:fs";

import { EventStore, AppendError, canonicalize, hashEvent } from "../src/store.js";

const makeEvent = (id, agg = "a1", version = 1) => ({
  event_id: id,
  event_type: "ENROLLMENT_CONFIRMED",
  aggregate_type: "apprenticeship",
  aggregate_id: agg,
  occurred_at: "2026-09-03T00:00:00+08:00",
  version,
  summary: "x",
  policy_context: { sensitivity: "standard", visibility: "restricted" },
  payload: { actor_id: "o", reason: "r", person_id: "p", decision: "confirmed", effective_from: "2026-09-03T00:00:00+08:00" },
});

test("同一聚合 version 必须连续，跳号被拒绝", () => {
  const store = new EventStore();
  store.append(makeEvent("e1"));
  assert.throws(() => store.append(makeEvent("e3", "a1", 3)), AppendError);
});

test("重复 event_id 幂等拒绝", () => {
  const store = new EventStore();
  store.append(makeEvent("dup"));
  assert.throws(() => store.append(makeEvent("dup", "a2", 1)), (e) => e.code === "duplicate_id");
});

test("不同聚合各自从 1 开始计版本", () => {
  const store = new EventStore();
  assert.equal(store.nextVersion("x"), 1);
  store.append(makeEvent("a", "x"));
  assert.equal(store.nextVersion("x"), 2);
  assert.equal(store.nextVersion("y"), 1);
});

test("哈希链在正常追加后完整", () => {
  const store = new EventStore();
  store.append(makeEvent("e1"));
  store.append(makeEvent("e2", "a1", 2));
  assert.equal(store.verifyChain(), null);
});

test("规范化结果与键顺序无关", () => {
  const a = { x: 1, nested: { y: 2, z: [1, 2] } };
  const b = { nested: { z: [1, 2], y: 2 }, x: 1 };
  assert.equal(canonicalize(a), canonicalize(b));
});

test("改动历史事件后哈希链校验能发现断裂", () => {
  const store = new EventStore();
  store.append(makeEvent("e1"));
  store.append(makeEvent("e2", "a1", 2));
  // 篡改第一条（模拟落库后被改动）
  store.events[0].summary = "被篡改";
  const breakInfo = store.verifyChain();
  assert.ok(breakInfo);
  assert.equal(breakInfo.event_id, "e1");
});

test("JSONL 持久化：重开后事件与哈希链可恢复", () => {
  const path = join(tmpdir(), `ledger-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
  try {
    const s1 = new EventStore({ file: path });
    s1.append(makeEvent("p1"));
    s1.append(makeEvent("p2", "a1", 2));

    const s2 = new EventStore({ file: path });
    assert.equal(s2.events.length, 2);
    assert.equal(s2.verifyChain(), null);
    assert.equal(s2.nextVersion("a1"), 3);
    assert.throws(() => s2.append(makeEvent("p1")), (e) => e.code === "duplicate_id");
  } finally {
    rmSync(path, { force: true });
  }
});
