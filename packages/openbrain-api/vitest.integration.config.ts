import { defineConfig } from "vitest/config";

/**
 * Integration suite config (ADR-0007, issue #22). Intentionally separate from
 * the default `vitest.config.ts` so `npm test` (CI gate) stays hermetic and
 * only runs the fake-based unit suite. This config is invoked only by
 * `npm run test:integration` and includes ONLY `test/integration/**`.
 *
 * `test/suite-isolation.test.ts` (in the default suite) asserts on
 * `package.json` that the two stay separate.
 *
 * Execution model: one fork, sequential files, shared module registry. The
 * harness boots a real workerd server in `beforeAll`; sharing the registry
 * keeps that single boot and the module-level `ctx`/`allCapturedIds` state
 * stable across tests, and avoids concurrent churn on the remote dev index.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    // Neuters the undici/macOS setTypeOfService EINVAL throw before any remote
    // binding connection is opened (see the file for why).
    setupFiles: ["./test/integration/setup.ts"],
    pool: "forks",
    fileParallelism: false,
    isolate: false,
    maxWorkers: 1,
    minWorkers: 1,
    // The remote dev index's upsert→getByIds visibility window is ~40–50s
    // (measured via a direct-binding diagnostic), so the lag-retry helper's
    // 60s budget per wait dominates test time. A test with two waits plus
    // HTTP overhead can approach 130s, so give whole tests and hooks room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    silent: false,
  },
});
