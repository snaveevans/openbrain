/**
 * Keeps the integration suite from leaking into the CI gate (ADR-0007, issue
 * #22 plan, P2). The integration suite boots real workerd + remote dev
 * bindings and must not run under `npm test`. These assertions read
 * `package.json` so a future PR cannot accidentally fold the integration
 * config into the default test script.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PKG = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../package.json", import.meta.url)),
    "utf8",
  ),
) as { scripts: Record<string, string> };

describe("suite isolation (ADR-0007)", () => {
  it("the CI `test` script runs only the default (fake) suite", () => {
    const testScript = PKG.scripts["test"];
    expect(testScript).toBeDefined();
    // Must not reference the integration config and must be a plain run.
    expect(testScript).not.toMatch(/integration/);
    expect(testScript).toMatch(/^vitest run$/);
  });

  it("the integration suite has its own dedicated script + config", () => {
    const integrationScript = PKG.scripts["test:integration"];
    expect(integrationScript).toBeDefined();
    expect(integrationScript).toMatch(/vitest\.integration\.config\.(ts|mts)/);
  });

  it("the default vitest config excludes the integration directory", async () => {
    const { readFileSync: read } = await import("node:fs");
    const cfg = read(
      fileURLToPath(new URL("../vitest.config.ts", import.meta.url)),
      "utf8",
    );
    expect(cfg).toMatch(/test\/integration\/\*\*/);
  });
});
