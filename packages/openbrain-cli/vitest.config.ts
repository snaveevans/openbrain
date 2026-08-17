import { defineConfig } from "vitest/config";

/**
 * The CLI suite mocks HTTP via an injectable transport. No real Worker, no
 * network — `npm test` stays hermetic (the real-Worker round-trip is owned by
 * the integration suite, not this package).
 */
export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
