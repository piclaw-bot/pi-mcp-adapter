import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { formatTerminalError } from "./utils.ts";

export interface McpRuntimeOwner {
  readonly signal: AbortSignal;
  isActive(): boolean;
  addCleanup(cleanup: () => void | Promise<void>): void;
  stop(reason?: string): Promise<void>;
  /** Await cleanups registered after stop, once admitted initialization settles. */
  awaitCleanup(): Promise<void>;
  throwIfInactive(): void;
}

export function createMcpRuntimeOwner(): McpRuntimeOwner {
  const controller = new AbortController();
  const cleanups: Array<() => void | Promise<void>> = [];
  let stopPromise: Promise<void> | undefined;
  const lateCleanups = new Set<Promise<void>>();
  const lateFailures: unknown[] = [];

  const reportCleanupFailure = (error: unknown, late: boolean) => {
    console.error(`MCP: ${late ? "late " : ""}runtime cleanup failed: ${formatTerminalError(error)}`);
  };

  return {
    signal: controller.signal,
    isActive: () => !controller.signal.aborted,
    addCleanup: cleanup => {
      if (controller.signal.aborted) {
        const task = Promise.resolve().then(cleanup).then(() => {}, error => {
          lateFailures.push(error);
          reportCleanupFailure(error, true);
        });
        lateCleanups.add(task);
        void task.then(() => lateCleanups.delete(task));
        return;
      }
      cleanups.push(cleanup);
    },
    stop: (reason = "MCP extension runtime stopped") => {
      if (stopPromise) return stopPromise;
      let resolveStop!: () => void, rejectStop!: (error: unknown) => void;
      stopPromise = new Promise<void>((resolve, reject) => { resolveStop = resolve; rejectStop = reject; });
      // Abort listeners may synchronously reenter stop; publish settlement first.
      controller.abort(new Error(reason));
      const pendingCleanups = cleanups.splice(0).reverse().map(cleanup =>
        Promise.resolve().then(cleanup),
      );
      void Promise.allSettled(pendingCleanups).then(results => {
        const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
        if (failures.length > 0) {
          const aggregate = new AggregateError(failures, "MCP runtime cleanup failed");
          console.error(`MCP: runtime cleanup failed: ${formatTerminalError(aggregate)}`);
          throw aggregate;
        }
      }).then(resolveStop, rejectStop);
      return stopPromise;
    },
    awaitCleanup: async () => {
      if (!controller.signal.aborted) throw new Error("MCP runtime must be stopped before awaiting cleanup");
      const failures: unknown[] = [];
      try { await stopPromise; } catch (error) { failures.push(error); }
      while (lateCleanups.size) await Promise.all([...lateCleanups]);
      failures.push(...lateFailures);
      if (failures.length) throw new AggregateError(failures, "MCP runtime cleanup failed");
    },
    throwIfInactive: () => controller.signal.throwIfAborted(),
  };
}

export function combineAbortSignals(...signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

/** Fence session-bound UI calls after the owning extension runtime stops. */
export function createOwnedUi(ui: ExtensionUIContext, owner: McpRuntimeOwner): ExtensionUIContext {
  const proxies = new WeakMap<object, object>();
  const wrap = (value: unknown): unknown => {
    if ((typeof value !== "object" || value === null) && typeof value !== "function") {
      return value;
    }
    const object = value as object;
    const existing = proxies.get(object);
    if (existing) return existing;

    const proxy = new Proxy(object, {
      get(target, property, receiver) {
        if (!owner.isActive()) return undefined;
        const member = Reflect.get(target, property, receiver);
        if (typeof member === "function") {
          return (...args: unknown[]) => {
            if (!owner.isActive()) return undefined;
            return Reflect.apply(member, target, args);
          };
        }
        return owner.isActive() ? wrap(member) : undefined;
      },
    });
    proxies.set(object, proxy);
    return proxy;
  };
  return wrap(ui) as ExtensionUIContext;
}

export function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return error instanceof Error && (error.name === "AbortError" || error.message === "MCP extension runtime stopped");
}
