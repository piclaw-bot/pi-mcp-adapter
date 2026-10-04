import { defineConfig } from "vitest/config";
import { bunMockImporter } from "./scripts/vitest-bun-mock-importer.ts";

const bun = Boolean(process.versions.bun);
export default defineConfig({
  plugins: bun ? [bunMockImporter()] : [],
  test: {
    globals: true,
    environment: "node",
    ...(bun ? { server: { deps: { inline: ["zod"] } }, setupFiles: ["./__tests__/bun-environment.setup.ts"] } : {}),
    env: {
      PI_MCP_ADAPTER_TEST_AUTH_STORE: "memory",
      // Cache tests opt in explicitly to keep existing tests platform-neutral.
      PI_MCP_ADAPTER_DISABLE_AUTH_CACHE: "1",
    },
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["*.ts"],
      exclude: ["__tests__/**", "vitest.config.ts", "cli.js"],
    },
  },
});
