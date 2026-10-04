import assert from "node:assert/strict";
import { mock } from "bun:test";
const mode = Bun.argv[2] ?? "discovery";
assert(["discovery", "raw-sdk"].includes(mode));
let release!: () => void, entered!: () => void;
const gate = new Promise<void>(resolve => { release = resolve; });
const admitted = new Promise<void>(resolve => { entered = resolve; });
let sdkCalls = 0, callbackStops = 0;
const provider = { deactivate() {}, tokens: async () => undefined, metadata: {}, state: () => "synthetic-state" };
mock.module("../mcp-oauth-provider.ts", () => ({ McpOAuthProvider: class { constructor() { return provider; } } }));
mock.module("../mcp-callback-server.ts", () => ({
  ensureCallbackServer: async () => { if (mode === "discovery") { entered(); await gate; } return "http://127.0.0.1:41801/callback"; },
  cancelPendingCallback() {}, waitForCallback: async () => { throw Error("unexpected callback"); },
  stopCallbackServer: async () => { callbackStops++; }, releaseCallbackServer() {}, stopCallbackServerIfIdle: async () => {},
  resolveCallbackUrl: (port: number) => `http://127.0.0.1:${port}/callback`,
}));
mock.module("../mcp-auth.ts", () => ({
  getAuthBaseDir: () => "/synthetic", getAuthForUrl: async () => undefined, isTokenExpired: () => false, hasStoredTokens: async () => false, clearAllCredentials: async () => {}, clearClientInfo: async () => {}, clearTokens: async () => {}, clearCodeVerifier: async () => {}, getOAuthState: async () => undefined, clearOAuthState: async () => {},
  OAuthCredentialStoreError: class extends Error {},
}));
const originalAuth = await import("@modelcontextprotocol/client");
mock.module("@modelcontextprotocol/client", () => ({ ...originalAuth, auth: async () => { sdkCalls++; entered(); await gate; return "AUTHORIZED"; } }));
const { createOAuthRuntime, initializeOAuth, shutdownOAuth, startAuth } = await import("../mcp-auth-flow.ts");
const runtime = createOAuthRuntime(); await initializeOAuth(runtime);
const originalFetch = globalThis.fetch;
(globalThis as any).fetch = async () => new Response(null, { status: 401 });
try {
  const definition = mode === "raw-sdk"
    ? { url: "https://synthetic.invalid/mcp", oauth: { grantType: "client_credentials" as const, clientId: "synthetic", clientSecret: "synthetic" } }
    : { url: "https://synthetic.invalid/mcp", oauth: { clientId: "synthetic" } };
  const start = startAuth("fixture", "https://synthetic.invalid/mcp", definition, { runtime });
  void start.catch(() => {}); await admitted;
  const shutdown = shutdownOAuth(runtime); assert.equal(shutdown, shutdownOAuth(runtime));
  let settled = false; void shutdown.then(() => { settled = true; }, () => { settled = true; });
  await Bun.sleep(0); assert.equal(settled, false, "shutdown cannot acknowledge untracked direct or raw SDK work");
  release(); await assert.rejects(start); await shutdown;
  assert.equal(sdkCalls, mode === "discovery" ? 0 : 1);
  console.log(JSON.stringify({ mode, status: "pass", directStartSettled: true, rawSdkSettledBeforeAck: mode === "raw-sdk", preventedPostAbortSdkAdmission: mode === "discovery", callbackStops }));
} finally { globalThis.fetch = originalFetch; }
