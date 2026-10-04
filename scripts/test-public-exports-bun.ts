import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, delimiter } from "node:path";
const repo = resolve(import.meta.dir, "..");
const root = mkdtempSync(join(tmpdir(), "adapter-public-bun-"));
function run(cmd: string[], cwd = root, input?: string) {
  const result = spawnSync(cmd[0]!, cmd.slice(1), { cwd, env: { PATH: [dirname(process.execPath), "/usr/bin", "/bin"].join(delimiter), HOME: join(root, "home"), PI_CODING_AGENT_DIR: join(root, "profile"), PI_OFFLINE: "1", PI_TELEMETRY: "0", PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory", TMPDIR: root }, input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr.toString());
  return result.stdout.toString();
}
try {
  mkdirSync(join(root, "home")); mkdirSync(join(root, "profile"));
  run([process.execPath, "--no-env-file", join(repo, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.public.json"], repo);
  const archive = join(root, "package.tgz");
  run([process.execPath, "--no-env-file", "pm", "pack", "--ignore-scripts", "--filename", archive], repo);
  const packageRoot = join(root, "node_modules/pi-mcp-adapter"); mkdirSync(packageRoot, { recursive: true });
  run(["tar", "-xzf", archive, "--strip-components=1", "-C", packageRoot]);
  symlinkSync(join(repo, "node_modules"), join(packageRoot, "node_modules"), "dir");
  writeFileSync(join(root, "public.mjs"), `import assert from 'node:assert/strict'; import {loadMetadataCache,saveMetadataCache,isServerCacheValid,computeServerHash} from 'pi-mcp-adapter/metadata-cache'; import {loadMcpConfig} from 'pi-mcp-adapter/config'; import {isServerDisabled} from 'pi-mcp-adapter/types'; for(const f of[loadMetadataCache,saveMetadataCache,isServerCacheValid,computeServerHash,loadMcpConfig])assert.equal(typeof f,'function');assert.equal(isServerDisabled({disabled:true}),true);console.log('PUBLIC_BUN_EXPORTS_OK');`);
  assert(run([process.execPath, "--no-env-file", join(root, "public.mjs")]).includes("PUBLIC_BUN_EXPORTS_OK"));
  writeFileSync(join(root, "profile/mcp.json"), JSON.stringify({ mcpServers: { fixture: { url: "https://synthetic.invalid/mcp", auth: "bearer", bearerTokenStore: true } } }));
  const token = "synthetic-public-token";
  writeFileSync(join(root, "token.mjs"), `import assert from 'node:assert/strict';import{Readable}from'node:stream';import{main}from ${JSON.stringify(join(packageRoot, "cli.js"))};const logs=[],errors=[];const log=m=>logs.push(String(m)),error=m=>errors.push(String(m));assert.equal(await main(['token','set','fixture'],log,error,Readable.from([${JSON.stringify(token)}])),0);assert.equal(await main(['token','status','fixture'],log,error),0);assert.equal(await main(['token','remove','fixture'],log,error),0);assert.equal(errors.length,0);assert(!logs.join('\\n').includes(${JSON.stringify(token)}));console.log('PUBLIC_BUN_CLI_OK');`);
  assert(run([process.execPath, "--no-env-file", join(root, "token.mjs")]).includes("PUBLIC_BUN_CLI_OK"));
  console.log(JSON.stringify({ status: "pass", runtime: "bun", version: process.versions.bun, packagedPublicExports: true, packagedTokenCli: true, secretsInLogs: false, providerExecution: false }));
} finally { rmSync(root, { recursive: true, force: true }); }
