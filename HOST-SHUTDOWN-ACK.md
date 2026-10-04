# Public host shutdown acknowledgement

`createMcpAdapter({ onLifecycle })` supplies a per-installation public handle.
The host calls and awaits `handle.shutdown(reason)` before replacing that MCP
owner. The call permanently fences the installation, aborts existing work and
waits for admitted initialisation, connection, OAuth and cleanup tails. Cleanup
failures reject and remain observable on later calls. A timeout does not prove
that an external connection closed.

```ts
let handle: McpAdapterLifecycle;
const factory = createMcpAdapter({
  initializeOnLoad: false,
  onLifecycle: lifecycle => { handle = lifecycle; },
});
// The host aborts its active agent turns first.
await handle.shutdown("selected MCP engine changed");
// Only a fulfilled acknowledgement permits the host's replacement admission.
```

The handle is public adapter API. It returns no manager, credentials or SDK
private lifecycle object. Each factory installation supplies a new handle.
Calling `session_start` again on a host-stopped installation rejects. Ordinary
session shutdown uses the same owned cleanup; logged SDK handler errors remain
observable to a later host acknowledgement.

## Cleanup ownership

- Shared stop promises are published before synchronous abort dispatch, so
  reentrant abort listeners cannot overwrite a rejecting settlement with success.
- Initialisation tails are tracked per owner. Retirement waits for admitted
  initialisation and late cleanup before releasing that owner's bookkeeping.
- Session restart refuses to create an active replacement after failed cleanup.
- UI/status/metadata/owner cleanup attempts all run; failures are aggregated.
- Manager shutdown waits for closes already in progress after map removal and
  retains prior close failures.
- OAuth shutdown tracks all public auth entry points and raw SDK promises, plus
  explicit cleanup operations and timeout callbacks. Ordinary cancellation
  outcomes are separate from cleanup failures. Plain cleanup errors stay sticky.

## Bun qualification

Strict compilation passed. Seven runtime-owner cases and isolated direct-Bun
fault cases passed for idle/concurrent/reentrant shutdown, delayed initialisation,
late/state/OAuth/previous-shutdown failure, and fail-closed session restart.
Additional gated fixtures passed direct OAuth startup and raw SDK quiescence,
manual-timeout store cleanup after pending-map removal, and plain completion
cleanup failure.

Actual public Pi1.0.1 session/runtime APIs passed with two synthetic stdio MCP
processes: the old PID exited before the host acknowledged shutdown and before
reload created its replacement. Session identity/history stayed unchanged;
final shutdown left no children. External network attempts and provider calls
were zero. Manager fixtures verify in-flight and sticky close failure; OAuth
fixtures verify shared/reentrant shutdown settlement.

Independent source review found reentrancy and incomplete OAuth tracking and
cleanup-provenance blockers; each has a targeted regression and corrected pass.
The broader HTTP authentication matrix is not qualified by these fixtures.

## Bun test-runner compatibility

The baseline Vitest3 stack parser expects `Object.mock` frames; Bun emits
`at mock`, leaving its relative mock importer empty. Default external Zod
interop also yields an undefined `z`. Both original failures are retained.

The checked-in Bun-only Vite pre-transform plugin uses TypeScript symbol
bindings to normalise imported `vi`/`vitest` static relative mock paths before
Vitest's public post-hoister. It preserves comments, local/shadowed names,
dynamic expressions, bare package IDs and source maps. Zod is inlined for Bun.
No Vitest internals or node_modules files are patched. Named-import TypeScript
tests are covered; alias path normalisation does not prove alias hoisting.

Canonical Bun checks pass69cases (64lifecycle,4plugin,1interop),8manager and
46OAuth cases. Four existing lifecycle cases now await stale initialisation
cleanup before replacement; assertions/timeouts are retained. Async auth APIs
continue rejecting stopped-runtime calls through promises.

The first whole-suite run passed1,357cases and failed61. Bun caches `homedir`
and does not implement Node's `syncBuiltinESMExports` fault-injection behaviour;
old tests also inherited profile paths and expected built example artifacts.
Bun-only setup now supplies a private per-file HOME, clears profile overrides
before test-module evaluation, rejects absent HOME and restores environment
before deleting its owned root. A synthetic forbidden-profile fixture passes.
Filesystem fault tests use explicit mocks with the same errors/assertions;
command-secret tests use the current runtime and an empty-output program.
The unchanged visualizer source is built with Bun before its artifact checks.
These focused checks pass38cases plus2example artifacts. Neither setup nor
module mocks provide a general operating-system sandbox or credential filter.
The corrected whole Bun suite passed **1,419tests across114files**, zero
failures, in63.61seconds. The packed package passed public metadata/config/types
imports and token set/status/remove without a token in logs. The portable
host-shutdown runner passed13isolated cases against an explicitly supplied
Pi1.0.1 package root. No Node executable was used as a fallback.

Reproduce with Bun:

```sh
bun install --ignore-scripts
bun run test:bun
bun run test:public-exports:bun
bun run test:host-shutdown:bun -- --sdk-root /path/to/pi-coding-agent-1.0.1
```

Build the unchanged `examples/interactive-visualizer` before its artifact tests,
using Bun for both dependency installation and `scripts/build.mjs`. The root
repository still retains its declared historical SDK dev dependency; the actual
Pi1.0.1 receipt uses the explicit package root rather than relabelling that SDK.

The adapter is unchanged in the running instance and core dependency pins.
Native MCP capability/authentication gaps remain independent admission gates.
