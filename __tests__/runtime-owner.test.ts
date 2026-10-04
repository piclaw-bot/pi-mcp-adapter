import { describe, expect, it, vi } from "vitest";
import { combineAbortSignals, createMcpRuntimeOwner, createOwnedUi } from "../runtime-owner.ts";

describe("MCP runtime ownership", () => {
  it("contains synchronous and asynchronous cleanup failures and is idempotent", async () => {
    const owner = createMcpRuntimeOwner();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const cleanup = vi.fn(() => { throw new Error("cleanup failed \u001b]52;c;secret\u0007"); });
    owner.addCleanup(cleanup);
    const first = owner.stop("reload");
    const second = owner.stop("shutdown");

    await expect(first).rejects.toThrow(AggregateError);
    await expect(second).rejects.toThrow(AggregateError);
    expect(first).toBe(second);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(consoleError).toHaveBeenCalledWith("MCP: runtime cleanup failed: cleanup failed");
    consoleError.mockRestore();
  });

  it("abort-listener reentrancy shares the same rejecting cleanup settlement", async () => {
    const owner = createMcpRuntimeOwner();
    const cleanup = vi.fn(() => { throw Error("synthetic cleanup rejection"); });
    owner.addCleanup(cleanup);
    let nested!: Promise<void>;
    owner.signal.addEventListener("abort", () => { nested = owner.stop("reentrant"); });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const outer = owner.stop();
      expect(nested).toBe(outer);
      await expect(outer).rejects.toThrow("cleanup failed");
      await expect(nested).rejects.toThrow("cleanup failed");
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally { consoleError.mockRestore(); }
  });

  it("awaits late cleanup and retains its failure after stop has settled", async () => {
    const owner = createMcpRuntimeOwner();
    await owner.stop("reload");
    let release!: () => void;
    const deferred = new Promise<void>(resolve => { release = resolve; });
    owner.addCleanup(() => deferred);
    let settled = false;
    const cleanup = owner.awaitCleanup().then(() => { settled = true; });
    await Promise.resolve(); expect(settled).toBe(false);
    release(); await cleanup; expect(settled).toBe(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      owner.addCleanup(() => { throw Error("late failure"); });
      await expect(owner.awaitCleanup()).rejects.toThrow("MCP runtime cleanup failed");
      await expect(owner.awaitCleanup()).rejects.toThrow("MCP runtime cleanup failed");
    } finally { consoleError.mockRestore(); }
  });

  it("does not invoke nested UI methods after the owner stops", async () => {
    const owner = createMcpRuntimeOwner();
    const ui = { notify: vi.fn(), theme: { fg: vi.fn((_color: string, text: string) => text) } } as any;
    const owned = createOwnedUi(ui, owner);
    const theme = owned.theme;

    theme.fg("accent", "before");
    await owner.stop("reload");
    expect((owned as any).notify).toBeUndefined();
    expect((owned as any).theme).toBeUndefined();

    expect(ui.notify).not.toHaveBeenCalled();
    expect(ui.theme.fg).toHaveBeenCalledTimes(1);
  });

  it("does not read stale UI getters after the owner stops", async () => {
    const owner = createMcpRuntimeOwner();
    const ui = {} as any;
    Object.defineProperty(ui, "notify", {
      get: () => {
        throw new Error("stale getter");
      },
    });
    const owned = createOwnedUi(ui, owner);
    await owner.stop("reload");
    expect(() => (owned as any).notify).not.toThrow();
    expect((owned as any).notify).toBeUndefined();
  });

  it("combines owner and context cancellation", async () => {
    const owner = createMcpRuntimeOwner();
    const context = new AbortController();
    const signal = combineAbortSignals(owner.signal, context.signal)!;
    expect(signal.aborted).toBe(false);
    context.abort(new Error("context ended"));
    expect(signal.aborted).toBe(true);
    await owner.stop("reload");
  });

  it("runs cleanup only after a late registration has been fenced", async () => {
    const owner = createMcpRuntimeOwner();
    await owner.stop("reload");
    const cleanup = vi.fn();
    owner.addCleanup(cleanup);
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
