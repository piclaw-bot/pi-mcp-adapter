import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { basename, join } from "node:path";
const root = process.env.PICLAW_ACK_TEST_ROOT;
assert(root && basename(root).startsWith("adapter-ack-real-"), "explicit disposable root required");
assert.equal(process.env.PI_CODING_AGENT_DIR, join(root, "profile"));
const sdkRoot = process.env.PICLAW_ACK_SDK_ROOT;
assert(sdkRoot, "explicit exact SDK package root required");
assert.equal(JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8")).version, "1.0.1");
const sdk = await import(pathToFileURL(join(sdkRoot, "dist/index.js")).href) as typeof import("@earendil-works/pi-coding-agent");
const ai = await import(pathToFileURL(Bun.resolveSync("@earendil-works/pi-ai", sdkRoot)).href) as typeof import("@earendil-works/pi-ai");
const { createMcpAdapter } = await import("../index.ts");
const pids = join(root, "pids"); mkdirSync(pids);
let networkAttempts = 0;
const deny = () => { networkAttempts++; throw Error("external network denied"); };
globalThis.fetch = Object.assign(deny, { preconnect: deny }) as any;
const lifecycle: import("../types.ts").McpAdapterLifecycle[] = [];
const model = await sdk.ModelRuntime.create({ credentials: new ai.InMemoryCredentialStore(), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
const settings = sdk.SettingsManager.inMemory();
const loader = new sdk.DefaultResourceLoader({ cwd: root, agentDir: join(root, "profile"), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, extensionFactories: [{ name: "synthetic-ack-adapter", factory: createMcpAdapter({ initializeOnLoad: false, config: { mcpServers: { fixture: { command: process.execPath, args: [join(import.meta.dir, "fixtures/delayed-mcp-server.mjs")], env: { MCP_RELOAD_PID_DIR: pids }, lifecycle: "eager", directTools: true } }, settings: { sampling: false, elicitation: false, imports: [] } }, onLifecycle: handle => lifecycle.push(handle) }) }] });
await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
const created = await sdk.createAgentSession({ cwd: root, agentDir: join(root, "profile"), modelRuntime: model, settingsManager: settings, resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(root), noTools: "builtin" });
const runtime = await sdk.createAgentSessionRuntime(async () => ({ ...created, services: { cwd: root, agentDir: join(root, "profile"), modelRuntime: model, settingsManager: settings, resourceLoader: loader, diagnostics: [] }, diagnostics: [] }), { cwd: root, agentDir: join(root, "profile"), sessionManager: created.session.sessionManager });
const session = runtime.session, errors: string[] = [];
const isAlive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const records = () => readdirSync(pids).filter(file => file.endsWith(".json")).map(file => JSON.parse(readFileSync(join(pids, file), "utf8")) as { pid: number });
async function wait(predicate: () => boolean) { const deadline = Date.now() + 10_000; while (!predicate()) { assert(Date.now() < deadline, "synthetic MCP readiness deadline"); await Bun.sleep(10); } }
try {
  await session.bindExtensions({ mode: "rpc", onError: e => errors.push(e.error) });
  await wait(() => records().some(record => isAlive(record.pid)));
  await wait(() => session.getAllTools().some(tool => tool.name === "fixture_reload_identity"));
  session.sessionManager.appendMessage({ role: "user", content: "synthetic preserved history", timestamp: 1 });
  const id = session.sessionId, history = JSON.stringify(session.sessionManager.getEntries());
  const first = records().filter(record => isAlive(record.pid)); assert.equal(first.length, 1);
  await lifecycle[0].shutdown("qualified host engine fence");
  await wait(() => !isAlive(first[0].pid));
  assert.equal(records().filter(record => isAlive(record.pid)).length, 0);
  await session.reload();
  await wait(() => records().filter(record => isAlive(record.pid)).length === 1);
  const next = records().find(record => isAlive(record.pid))!;
  assert.notEqual(next.pid, first[0].pid); assert.equal(lifecycle.length, 2);
  assert.equal(session.sessionId, id); assert.equal(JSON.stringify(session.sessionManager.getEntries()), history);
  await lifecycle[1].shutdown(); await wait(() => !isAlive(next.pid));
  assert.equal(networkAttempts, 0); assert.equal(errors.length, 0);
  console.log(JSON.stringify({ status: "pass", sdk: "1.0.1", publicHostShutdown: true, realStdioProcesses: 2, oldPid: first[0].pid, replacementPid: next.pid, acknowledgementBeforeReplacement: true, sessionIdentityAndHistoryPreserved: true, noRemainingChildren: true, networkAttempts, providerExecution: false }));
} finally {
  for (const handle of lifecycle) await handle.shutdown().catch(() => {});
  await runtime.dispose();
  for (const record of records()) if (isAlive(record.pid)) { try { process.kill(record.pid, "SIGKILL"); } catch {} }
}
