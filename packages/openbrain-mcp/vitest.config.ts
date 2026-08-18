import { defineConfig } from "vitest/config";

/**
 * Default (CI-gate) suite: the fake-based unit tests only. The Worker's
 * `fetch` handler is driven through Hono's `app.request` with a `FakeRest`
 * (records upstream method/url/headers/body, returns canned status/JSON, can
 * throw) and a `FakeKV` (get → stored value / undefined / throws). No real
 * REST, no real KV, no network — `npm test` stays hermetic.
 */
export default defineConfig({
  test: {
    environment: "node",
    exclude: ["**/node_modules/**", "**/dist/**"],
  },
});
