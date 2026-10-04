import assert from "node:assert/strict";
import { mock } from "bun:test";
import { createMcpRuntimeOwner } from "../runtime-owner.ts";
const mode = Bun.argv[2] ?? "idle";
assert(["idle", "pending", "state-failure", "suppressed-failure", "oauth-failure", "late-failure", "restart-failure"].includes(mode));
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { resolve, promise }; };
const init = deferred<any>(), close = deferred<void>();
let initializationCalls = 0, closeCalls = 0, oauthCloses = 0, signal: AbortSignal | undefined;
const runtimes: Array<{ signal: AbortSignal }> = [];
const originalInit = await import("../init.ts");
const originalAuth = await import("../mcp-auth-flow.ts");
mock.module("../init.ts", () => ({
  ...originalInit,
  initializeMcp: async (_pi: unknown, _ctx: unknown, owner: ReturnType<typeof createMcpRuntimeOwner>) => {
    initializationCalls++; signal = owner.signal;
    if (mode === "pending" || mode === "late-failure") return init.promise;
    return state;
  },
  updateStatusBar: () => {}, flushMetadataCache: () => {}, notifyToolMetadataUpdated: () => {},
}));
mock.module("../mcp-auth-flow.ts", () => ({
  ...originalAuth,
  createOAuthRuntime: (signal: AbortSignal) => { const value = { signal }; runtimes.push(value); return value; },
  initializeOAuth: async () => {},
  shutdownOAuth: async () => { oauthCloses++; if (mode === "oauth-failure") throw new Error("synthetic oauth rejection"); },
}));
const state = {
  manager: { getAllConnections: () => new Map(), getConnection: () => undefined },
  lifecycle: { gracefulShutdown: async () => { closeCalls++; if (["state-failure", "suppressed-failure", "late-failure", "restart-failure"].includes(mode)) throw Error("synthetic close rejection"); await close.promise; }, ensureConverged: async () => {} },
  toolMetadata: new Map(), config: { mcpServers: {} }, failureTracker: new Map(), uiResourceHandler: {}, consentManager: {}, uiServer: null, completedUiSessions: [],
};
const { createMcpAdapter } = await import("../index.ts");
const handlers = new Map<string, (...args: any[]) => any>();
const pi = { registerTool() {}, registerFlag() {}, registerCommand() {}, getAllTools: () => [], getActiveTools: () => [], setActiveTools() {}, on: (name: string, fn: any) => { handlers.set(name, fn); }, events: { on() {}, emit() {} } } as any;
let lifecycle!: import("../types.ts").McpAdapterLifecycle;
createMcpAdapter({ config: { mcpServers: {} }, initializeOnLoad: false, onLifecycle: value => { lifecycle = value; } })(pi);
assert(lifecycle);
if (mode !== "idle") { await handlers.get("session_start")!({}, { cwd: process.cwd(), hasUI: false }); await Bun.sleep(0); }
if (mode === "suppressed-failure") await handlers.get("session_shutdown")!({}, {});
if (mode === "restart-failure") await assert.rejects(handlers.get("session_start")!({}, {}), /replacement remains fenced/);
let nested!: Promise<void>;
if (signal) signal.addEventListener("abort", () => { nested = lifecycle.shutdown("reentrant"); });
const first = lifecycle.shutdown(); assert.equal(first, lifecycle.shutdown("repeat"));
if (signal?.aborted && mode !== "suppressed-failure" && mode !== "restart-failure") assert.equal(nested, first);
if (signal) assert(signal.aborted);
let settled = false; void first.then(() => { settled = true; }, () => { settled = true; });
if (mode === "pending" || mode === "late-failure") {
  await Bun.sleep(0); assert.equal(settled, false, "shutdown must wait for admitted initialization");
  init.resolve(state); await Bun.sleep(0);
  if (mode === "pending") { assert.equal(settled, false, "shutdown must wait for late state's close"); close.resolve(); }
} else close.resolve();
if (["state-failure", "suppressed-failure", "oauth-failure", "late-failure", "restart-failure"].includes(mode)) {
  await assert.rejects(first, /host shutdown cleanup failed/);
  await assert.rejects(lifecycle.shutdown(), /host shutdown cleanup failed/);
} else await first;
await assert.rejects(handlers.get("session_start")!({}, {}), /shut down by its host/);
assert.equal(initializationCalls, mode === "idle" ? 0 : 1);
console.log(JSON.stringify({ mode, status: "pass", initializationCalls, closeCalls, oauthCloses, signalAborted: signal?.aborted, scope: "synthetic owned initialization/cleanup; no sockets/provider calls" }));
