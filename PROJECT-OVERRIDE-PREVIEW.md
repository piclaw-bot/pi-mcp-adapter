# Public project-override preview

`loadMcpConfig` and `getServerProvenance` accept a third argument, `{ projectOverride: document }`, for a read-only projection of replacing `.pi/mcp.json`. The option uses the same loader and merge rules as a written document. `null` removes that layer for the read; no option preserves existing behaviour.

The input is cloned. Invalid root/server/settings/import containers reject with fixed errors; unknown advanced server keys remain intact. Virtual settings affect import/host/plugin discovery in the same precedence order. Exclusive config mode ignores workspace overrides. A project target that aliases another discovered config source is rejected; this prevents pretending a physical global/project write changes only one layer.

Preview can read normal config/import/package/plugin files. It performs no writes, credential/command resolution, connections or server execution. It does not grant project trust or act as a filesystem sandbox. Core UI must redact private values/source paths and reject unsafe inherited-credential changes; the adapter keeps existing merge semantics, including unknown keychain extension fields.

## Evidence

Focused cases compare virtual output/provenance with an actual owned disk-write result, preserve original bytes/input and cover inheritance, removal/disable, transport credentials, advanced fields, host imports/package/plugins, exclusive mode and exact/symlink aliases. Existing config/discovery/exclusive cases pass. Public-package tests exercise the third argument from packed `pi-mcp-adapter/config`, with no candidate file mutation.

Retained failures: initial test syntax error and one invalid VS Code fixture key (`servers` instead of the adapter's `mcpServers`). Correcting fixtures retained the functional assertions. Independent review identified an aliased global/project target; source now rejects it with targeted record/null/symlink cases.

Final source `config.ts` SHA256 `39ebd8c2bf0e66a83feea93b471fd48004013807484399289ab4d82ac64ff2cb` passed 73 focused cases (17 new, 55 existing config/discovery, one exclusive) and both TypeScript/public compilation. The full Bun suite passed **1,436 tests across 115 files**, zero failures, in 66.52 seconds. Full log SHA256: `71c04b5f0ddaec1c081a78b78a09a925bdc0c7218c3da8c452a4c7ab4f9d554c`.

The unchanged visualizer was built with Bun before its two artifact tests. Packed public exports exercised virtual replacement/removal and provenance through `pi-mcp-adapter/config`; the token CLI sentinel stayed out of logs. Independent direct and correction reviews cleared the alias checks. Qualification uses isolated profiles/synthetic configuration; no core dependency pin, installation, Native activation or live-account qualification is included.
