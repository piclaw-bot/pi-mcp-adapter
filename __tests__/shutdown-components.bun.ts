import assert from "node:assert/strict";
import { McpServerManager } from "../server-manager.ts";
import { createOAuthRuntime, initializeOAuth, shutdownOAuth } from "../mcp-auth-flow.ts";
import { basename, join } from "node:path";
const root = process.env.PICLAW_ACK_TEST_ROOT;
assert(root && basename(root).startsWith("adapter-ack-components-"));
for (const fail of [false, true]) {
  const manager = new McpServerManager(root);
  const connection = await manager.connect("fixture", { command: process.execPath, args: [join(import.meta.dir, "fixtures/delayed-mcp-server.mjs")] });
  const originalClose = connection.client.close.bind(connection.client);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  connection.client.close = async () => { await gate; await originalClose(); if (fail) throw Error("synthetic close acknowledgement failure"); };
  const closing = manager.close("fixture");
  void closing.catch(() => {});
  assert.equal(manager.getAllConnections().size, 0);
  const all = manager.closeAll();
  let settled = false; void all.then(() => { settled = true; }, () => { settled = true; });
  await Bun.sleep(20); assert.equal(settled, false, "closeAll must await handles already removed from the map");
  release();
  if (fail) { await assert.rejects(closing, /cleanup failed/); await assert.rejects(all, /cleanup failed/); await assert.rejects(manager.closeAll(), /cleanup failed/); }
  else { await closing; await all; }
}
const runtime = createOAuthRuntime(); await initializeOAuth(runtime);
let nested!: Promise<void>; runtime.signal.addEventListener("abort", () => { nested = shutdownOAuth(runtime); });
const first = shutdownOAuth(runtime); assert.equal(first, shutdownOAuth(runtime)); assert.equal(nested, first); await first;
console.log(JSON.stringify({ status: "pass", managerPendingCloseAwaited: true, managerCloseFailurePropagated: true, oauthShutdownPromiseShared: true, providerExecution: false, scope: "real synthetic stdio plus idle OAuth shutdown; pending OAuth not qualified" }));
