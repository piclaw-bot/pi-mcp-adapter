import { expect, it } from "vitest";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { getAgentDir } from "../agent-dir.ts";

it("Bun setup clears inherited outside profiles before fixture capture", () => {
  expect(process.env.HOME).toContain("adapter-bun-suite-");
  expect(process.env.PI_CODING_AGENT_DIR).toBeUndefined();
  expect(process.env.PI_PACKAGE_DIR).toBeUndefined();
  expect(getAgentDir()).toBe(`${process.env.HOME}/.pi/agent`);
  if (process.env.ADAPTER_TEST_FORBIDDEN_PROFILE) expect(existsSync(process.env.ADAPTER_TEST_FORBIDDEN_PROFILE)).toBe(false);
  const home = process.env.HOME;
  try { delete process.env.HOME; expect(() => homedir()).toThrow("ambient profile access is forbidden"); }
  finally { process.env.HOME = home; }
});
