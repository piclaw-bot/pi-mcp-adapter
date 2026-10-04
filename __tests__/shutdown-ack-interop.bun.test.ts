import { expect, test } from "vitest";
import { z } from "zod";
import * as marker from "../runtime-owner.ts";
import { vi } from "vitest";
vi.mock("../runtime-owner.ts", () => ({ createMcpRuntimeOwner: () => "synthetic-marker" }));
test("Bun runner executes external zod and local module mocks", () => {
  expect(typeof z.enum).toBe("function");
  expect(marker.createMcpRuntimeOwner()).toBe("synthetic-marker");
});
