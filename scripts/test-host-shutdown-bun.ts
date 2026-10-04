import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, delimiter, join, resolve } from "node:path";

const repository = resolve(import.meta.dir, "..");
const sdkRoot = process.argv[process.argv.indexOf("--sdk-root") + 1];
assert(process.argv.includes("--sdk-root") && sdkRoot, "Supply --sdk-root <exact1.0.1 installed coding-agent package>");
const cases: Array<[string, string, string]> = [
  ...["idle", "pending", "state-failure", "suppressed-failure", "oauth-failure", "late-failure", "restart-failure"].map(mode => ["host-shutdown-ack.bun.ts", mode, "adapter-host-ack"] as [string, string, string]),
  ...["discovery", "raw-sdk"].map(mode => ["oauth-shutdown-admission.bun.ts", mode, "oauth-ack-fixture"] as [string, string, string]),
  ...["timer", "plain-failure"].map(mode => ["oauth-shutdown-cleanup.bun.ts", mode, "oauth-ack-cleanup"] as [string, string, string]),
  ["shutdown-components.bun.ts", "", "adapter-ack-components"],
  ["host-shutdown-real.bun.ts", "", "adapter-ack-real"],
];
const receipts = [];
for (const [file, mode, prefix] of cases) {
  const root = mkdtempSync(join(tmpdir(), prefix + "-"));
  try {
    mkdirSync(join(root, "home")); mkdirSync(join(root, "profile"));
    const env = { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "profile"), PICLAW_ACK_TEST_ROOT: root, PICLAW_ACK_SDK_ROOT: resolve(sdkRoot), TMPDIR: root, PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", PI_TELEMETRY: "0", OTEL_SDK_DISABLED: "true", MCP_ADAPTER_AUTH_STORE: "memory", MCP_ADAPTER_AUTH_CACHE: "off" };
    const result = spawnSync(process.execPath, ["--no-env-file", join(repository, "__tests__", file), ...(mode ? [mode] : [])], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, `${file}/${mode}: ${result.stderr.toString()}`);
    const line = result.stdout.toString().split("\n").find(line => line.startsWith('{"') && line.includes('"status":"pass"'));
    assert(line, `${file}/${mode}: missing pass receipt`);
    receipts.push(JSON.parse(line));
  } finally { rmSync(root, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ runtime: { execPath: process.execPath, bun: process.versions.bun }, cases: receipts.length, receipts, scope: "synthetic/public Pi1.0.1 lifecycle and cleanup; no provider execution" }, null, 2));
