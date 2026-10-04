import assert from "node:assert/strict";
import { mock } from "bun:test";
const mode = Bun.argv[2] ?? "timer"; assert(["timer", "plain-failure"].includes(mode));
let storedState: string | undefined, cleanupEntered!: () => void, release!: () => void;
const entered = new Promise<void>(resolve => { cleanupEntered = resolve; });
const gate = new Promise<void>(resolve => { release = resolve; });
let timerCallback!: () => void, sdkCalls = 0;
const originalTimeout = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
(globalThis as any).setTimeout = (callback: (...args: any[]) => void, ms: number, ...args: any[]) => {
  if (ms === 300_000) { timerCallback = () => callback(...args); return { unref() {} }; }
  return originalTimeout(callback, ms, ...args);
};
(globalThis as any).clearTimeout = (timer: any) => { if (typeof timer?.unref === "function" && typeof timer !== "number") return; originalClear(timer); };
mock.module("../mcp-oauth-provider.ts", () => ({ McpOAuthProvider: class {
  redirectUrl = "http://127.0.0.1:41801/callback";
  constructor(_name: string, _url: string, _config: unknown, public hooks: any, _store: unknown, _signal: unknown, state: string) { storedState = state; }
  deactivate() {} async discoveryState() { return {}; }
} }));
mock.module("../mcp-callback-server.ts", () => ({ ensureCallbackServer: async () => {}, waitForCallback: async () => { throw Error("unexpected callback"); }, cancelPendingCallback() {}, stopCallbackServer: async () => {}, releaseCallbackServer() {}, stopCallbackServerIfIdle: async () => {} }));
mock.module("../mcp-auth.ts", () => ({
  getAuthBaseDir: () => "/synthetic", getAuthForUrl: async () => undefined, isTokenExpired: () => false, hasStoredTokens: async () => false,
  clearAllCredentials: async () => {}, clearClientInfo: async () => {}, clearTokens: async () => {}, clearCodeVerifier: async () => {},
  getOAuthState: async () => storedState,
  clearOAuthState: async () => { cleanupEntered(); if (mode === "plain-failure") throw Error("plain cleanup rejection"); await gate; storedState = undefined; },
  OAuthCredentialStoreError: class extends Error {},
}));
const sdk = await import("@modelcontextprotocol/client");
mock.module("@modelcontextprotocol/client", () => ({ ...sdk, auth: async (provider: any) => { if (++sdkCalls === 1) { await provider.hooks.onRedirect(new URL("https://synthetic.invalid/authorize")); return "REDIRECT"; } return "AUTHORIZED"; } }));
const { createOAuthRuntime, initializeOAuth, shutdownOAuth, startAuth, completeAuth } = await import("../mcp-auth-flow.ts");
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async () => new Response(null, { status: 401 });
const runtime = createOAuthRuntime(); await initializeOAuth(runtime);
try {
  await startAuth("fixture", "https://synthetic.invalid/mcp", { url: "https://synthetic.invalid/mcp", oauth: { clientId: "synthetic" } }, { runtime });
  assert(timerCallback);
  if (mode === "timer") {
    timerCallback(); await entered;
    const shutdown = shutdownOAuth(runtime); let settled = false; void shutdown.then(() => { settled = true; });
    await Bun.sleep(0); assert.equal(settled, false, "ack must await timer cleanup after its map entry was deleted");
    release(); await shutdown;
  } else {
    await assert.rejects(completeAuth("fixture", { code: "synthetic", state: storedState }, { runtime }), /plain cleanup rejection/);
    await assert.rejects(shutdownOAuth(runtime), /cleanup failed/);
    await assert.rejects(shutdownOAuth(runtime), /cleanup failed/);
  }
  console.log(JSON.stringify({ mode, status: "pass", timerCleanupAwaited: mode === "timer", plainCleanupFailureSticky: mode === "plain-failure", sdkCalls, providerExecution: false }));
} finally { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; globalThis.clearTimeout = originalClear; }
