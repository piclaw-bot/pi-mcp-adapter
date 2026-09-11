import { describe, expect, it } from "vitest";
import { shouldInitializeMcpOnLoad } from "../lifecycle-options.ts";

describe("MCP adapter host lifecycle options", () => {
  it("preserves load-time initialization by default", () => {
    expect(shouldInitializeMcpOnLoad({})).toBe(true);
    expect(shouldInitializeMcpOnLoad({ initializeOnLoad: true })).toBe(true);
  });

  it("lets session-owning SDK hosts disable the superseded load-time owner", () => {
    expect(shouldInitializeMcpOnLoad({ initializeOnLoad: false })).toBe(false);
  });
});
