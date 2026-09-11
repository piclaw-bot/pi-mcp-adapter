import { describe, expect, it, vi } from "vitest";

// The historical Earendil compatibility branch's Vitest optimizer resolves the
// Zod 4 root named export incorrectly under today's dependency tree. Production
// Node/Bun imports are sound; keep this focused policy regression independent of
// that pre-existing collection failure without changing package locks.
vi.mock("zod", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("zod/v4");
  return { ...actual, z: actual.z ?? actual.default };
});
import { showStatus, showTools } from "../commands.ts";
import { executeCall, executeDescribe, executeList, executeSearch, executeStatus } from "../proxy-modes.ts";
import { createMcpStatusSnapshot } from "../mcp-status.ts";
import { totalToolCount } from "../tool-metadata.ts";

function policyState() {
  const callTool = vi.fn(async () => ({
    isError: false,
    content: [{ type: "text", text: "ok" }],
  }));
  const connection = {
    status: "connected",
    tools: [
      { name: "retrieve", description: "Read data", inputSchema: { type: "object" } },
      { name: "create_entity", description: "Create data", inputSchema: { type: "object" } },
      { name: "delete_entity", description: "Delete data", inputSchema: { type: "object" } },
    ],
    resources: [],
    prompts: [],
    client: { callTool, readResource: vi.fn() },
  };
  const manager = {
    getConnection: vi.fn(() => connection),
    getRequestOptions: vi.fn(() => undefined),
    touch: vi.fn(),
    incrementInFlight: vi.fn(),
    decrementInFlight: vi.fn(),
  };
  const state = {
    config: {
      settings: { toolPrefix: "server" },
      mcpServers: {
        workiq: {
          command: "workiq.exe",
          includeTools: ["retrieve", "workiq_retrieve"],
          excludeTools: ["create_entity", "delete_entity", "workiq_delete_entity"],
        },
      },
    },
    manager,
    // Deliberately stale/unfiltered metadata: policy must remain authoritative.
    toolMetadata: new Map([["workiq", [
      { name: "workiq_retrieve", originalName: "retrieve", description: "Read data", inputSchema: { type: "object" } },
      { name: "workiq_create_entity", originalName: "create_entity", description: "Create data", inputSchema: { type: "object" } },
      { name: "workiq_delete_entity", originalName: "delete_entity", description: "Delete data", inputSchema: { type: "object" } },
    ]]]),
    serverInstructions: new Map(),
    failureTracker: new Map(),
    completedUiSessions: [],
  } as any;
  return { state, callTool, manager };
}

describe("proxy tool authorization", () => {
  it.each([
    ["server", "workiq_retrieve"],
    ["short", "workiq_retrieve"],
    ["mcp", "mcp__workiq_retrieve"],
    ["none", "retrieve"],
  ])("accepts allowed public names in %s prefix mode", async (prefix, publicName) => {
    const { state, callTool } = policyState();
    state.config.settings.toolPrefix = prefix;
    state.toolMetadata.set("workiq", [{ name: publicName, originalName: "retrieve", description: "Read data" }]);
    state.config.mcpServers.workiq.includeTools = [publicName];

    const result = await executeCall(state, publicName, { q: prefix });
    expect(result.content[0].text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("applies include globs before exclude globs", async () => {
    const { state, callTool } = policyState();
    state.config.mcpServers.workiq.includeTools = ["workiq_*entity"];
    state.config.mcpServers.workiq.excludeTools = ["*_delete_entity"];

    expect(executeList(state, "workiq").details).toMatchObject({ tools: ["workiq_create_entity"], count: 1 });
    expect((await executeCall(state, "workiq_delete_entity", {})).details).toMatchObject({ error: "tool_not_allowed" });
    expect((await executeCall(state, "workiq_create_entity", {})).content[0].text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(1);
  });

  it("rejects excluded explicit and prefixed names before lazy connection", async () => {
    const { state, manager, callTool } = policyState();
    state.toolMetadata.clear();

    const explicit = await executeCall(state, "delete_entity", {}, "workiq");
    expect(explicit.details).toMatchObject({ error: "tool_not_allowed", server: "workiq", requestedTool: "delete_entity" });

    const prefixed = await executeCall(state, "workiq_delete_entity", {});
    expect(prefixed.details).toMatchObject({ error: "tool_not_allowed", server: "workiq", requestedTool: "workiq_delete_entity" });
    expect(manager.getConnection).toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("authorizes namespaced raw tools through sanitized public names", async () => {
    const { state, callTool, manager } = policyState();
    state.config.mcpServers.workiq.includeTools = ["namespace.tool"];
    state.config.mcpServers.workiq.excludeTools = [];
    const namespaced = { name: "namespace.tool", description: "Namespaced", inputSchema: { type: "object" } };
    const connection = manager.getConnection();
    connection.tools = [namespaced];
    state.toolMetadata.set("workiq", [{
      name: "workiq_namespace_tool",
      originalName: "namespace.tool",
      description: "Namespaced",
    }]);

    const publicResult = await executeCall(state, "workiq_namespace_tool", { q: "public" });
    const rawResult = await executeCall(state, "namespace.tool", { q: "raw" }, "workiq");
    expect(publicResult.content[0].text).toContain("ok");
    expect(rawResult.content[0].text).toContain("ok");
    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: "namespace.tool",
      arguments: { q: "public" },
      _meta: undefined,
    }, undefined);
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: "namespace.tool",
      arguments: { q: "raw" },
      _meta: undefined,
    }, undefined);
  });

  it("filters stale metadata and resource tools from list, search, and describe", () => {
    const { state } = policyState();
    state.config.mcpServers.workiq.excludeTools.push("read_admin_secret");
    state.toolMetadata.get("workiq").push({
      name: "workiq_read_admin_secret",
      originalName: "read_admin_secret",
      description: "Read sensitive resource",
      resourceUri: "workiq://admin-secret",
    });

    const listed = executeList(state, "workiq");
    expect(listed.details).toMatchObject({ mode: "list", server: "workiq", tools: ["workiq_retrieve"], count: 1 });
    expect(listed.content[0].text).not.toContain("create_entity");
    expect(listed.content[0].text).not.toContain("delete_entity");
    expect(listed.content[0].text).not.toContain("admin_secret");

    expect(executeSearch(state, "entity").details).toMatchObject({ count: 0, matches: [] });
    expect(executeSearch(state, "secret").details).toMatchObject({ count: 0, matches: [] });
    expect(executeDescribe(state, "workiq_delete_entity").details).toMatchObject({ error: "tool_not_found" });
    expect(executeDescribe(state, "workiq_read_admin_secret").details).toMatchObject({ error: "tool_not_found" });
    expect(totalToolCount(state)).toBe(1);
    expect(createMcpStatusSnapshot(state)).toMatchObject({
      totalTools: 1,
      totalResources: 0,
      servers: [{ name: "workiq", toolCount: 1, resourceCount: 0 }],
    });
    expect(executeStatus(state).details).toMatchObject({
      totalTools: 1,
      servers: [{ name: "workiq", toolCount: 1 }],
    });
  });

  it("filters slash-command status and tool inventory", async () => {
    const { state } = policyState();
    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { notify } } as any;

    await showStatus(state, ctx);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("workiq: connected (1 tools)"), "info");
    await showTools(state, ctx);
    const toolsText = notify.mock.calls.at(-1)?.[0] ?? "";
    expect(toolsText).toContain("workiq_retrieve");
    expect(toolsText).not.toContain("create_entity");
    expect(toolsText).not.toContain("delete_entity");
  });

  it("applies policy changes to already cached metadata", async () => {
    const { state, callTool } = policyState();
    expect(executeList(state, "workiq").details).toMatchObject({ tools: ["workiq_retrieve"], count: 1 });

    state.config.mcpServers.workiq.excludeTools.push("retrieve");
    expect(executeList(state, "workiq").details).toMatchObject({ tools: [], count: 0 });
    expect(executeDescribe(state, "workiq_retrieve").details).toMatchObject({ error: "tool_not_found" });
    expect((await executeCall(state, "workiq_retrieve", {})).details).toMatchObject({ error: "tool_not_allowed" });
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rechecks policy after lazy reconnect republishes metadata", async () => {
    const { state, callTool, manager } = policyState();
    state.toolMetadata.clear();
    const reconnected = {
      status: "connected",
      tools: [{ name: "retrieve", description: "Read data", inputSchema: { type: "object" } }],
      resources: [],
      prompts: [],
      client: { callTool, readResource: vi.fn() },
    };
    let policyChanged = false;
    manager.getConnection.mockImplementation(() => {
      if (!policyChanged) {
        state.config.mcpServers.workiq.excludeTools.push("retrieve");
        policyChanged = true;
      }
      return reconnected;
    });

    const result = await executeCall(state, "retrieve", {}, "workiq");
    expect(result.details).toMatchObject({ error: "tool_not_allowed", server: "workiq", requestedTool: "retrieve" });
    expect(manager.getConnection).toHaveBeenCalled();
    expect(callTool).not.toHaveBeenCalled();
  });

  it("rejects excluded prefixed and raw calls before transport", async () => {
    const { state, callTool, manager } = policyState();

    const prefixed = await executeCall(state, "workiq_delete_entity", {}, undefined);
    expect(prefixed.details).toMatchObject({
      mode: "call",
      error: "tool_not_allowed",
      server: "workiq",
      requestedTool: "workiq_delete_entity",
    });

    const raw = await executeCall(state, "delete_entity", {}, "workiq");
    expect(raw.details).toMatchObject({
      mode: "call",
      error: "tool_not_allowed",
      server: "workiq",
      requestedTool: "delete_entity",
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(manager.touch).not.toHaveBeenCalled();
  });

  it("continues to invoke included prefixed and raw tools", async () => {
    const { state, callTool } = policyState();
    const result = await executeCall(state, "workiq_retrieve", { q: "status" });
    const explicit = await executeCall(state, "retrieve", { q: "details" }, "workiq");

    expect(result.content[0].text).toContain("ok");
    expect(explicit.content[0].text).toContain("ok");
    expect(callTool).toHaveBeenCalledTimes(2);
    expect(callTool).toHaveBeenNthCalledWith(1, {
      name: "retrieve",
      arguments: { q: "status" },
      _meta: undefined,
    }, undefined);
    expect(callTool).toHaveBeenNthCalledWith(2, {
      name: "retrieve",
      arguments: { q: "details" },
      _meta: undefined,
    }, undefined);
  });
});
