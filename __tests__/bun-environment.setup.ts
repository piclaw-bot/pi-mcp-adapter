import { afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Legacy tests change HOME dynamically. Bun caches node:os.homedir(), while
// the original Node tests expect each lookup to observe the current HOME.
vi.mock("node:os", async importOriginal => {
  const original = await importOriginal<typeof import("node:os")>();
  const homedir = () => { if (!process.env.HOME) throw new Error("Bun test HOME is missing; ambient profile access is forbidden"); return process.env.HOME; };
  return { ...original, homedir, default: { ...original, homedir } };
});
// Setup runs before test-module evaluation, which captures its restore values.
const previous = Object.fromEntries(["HOME", "TMPDIR", "PI_CODING_AGENT_DIR", "PI_PACKAGE_DIR", "ARC_CODING_AGENT_DIR", "PI_OFFLINE", "PI_SKIP_VERSION_CHECK", "PI_TELEMETRY"].map(key => [key, process.env[key]]));
const scratchParent = tmpdir();
const root = mkdtempSync(join(scratchParent, "adapter-bun-suite-"));
{
  for (const name of ["home", "tmp"]) mkdirSync(join(root, name));
  process.env.HOME = join(root, "home");
  process.env.TMPDIR = join(root, "tmp");
  delete process.env.PI_CODING_AGENT_DIR;
  delete process.env.PI_PACKAGE_DIR;
  delete process.env.ARC_CODING_AGENT_DIR;
  process.env.PI_OFFLINE = "1";
  process.env.PI_SKIP_VERSION_CHECK = "1";
  process.env.PI_TELEMETRY = "0";
}
afterAll(() => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});
