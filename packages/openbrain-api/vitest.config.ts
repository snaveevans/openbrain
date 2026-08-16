import { defineConfig } from "vitest/config";

/**
 * Default (CI-gate) suite: the fake-based unit tests only. The integration
 * suite under `test/integration/**` boots real workerd + remote dev
 * bindings and is excluded here so `npm test` stays hermetic. Run it with
 * `npm run test:integration` (see `vitest.integration.config.ts`).
 * `test/suite-isolation.test.ts` keeps this separation enforced.
 */
export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**", "test/integration/**"],
  },
});
