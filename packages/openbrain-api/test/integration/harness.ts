/**
 * Integration test harness for the Open Brain REST Worker (ADR-0007).
 *
 * Boots the real production Worker under workerd (via wrangler's
 * `createTestHarness`) against the `dev` environment:
 *   - D1:           local (miniflare storage)
 *   - Vectorize:    remote dev index `openbrain-memories-dev` (`remote: true`)
 *   - Workers AI:   remote EmbeddingGemma (`remote: true`)
 *
 * This file is excluded from the default `vitest run` suite (see
 * `vitest.config.ts`) and is only loaded by `vitest.integration.config.ts`,
 * which in turn is only run by `npm run test:integration`. A guard in
 * `test/suite-isolation.test.ts` keeps that separation enforced on CI.
 *
 * Running this suite requires Cloudflare account credentials in the
 * environment (`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`) because the
 * dev bindings are remote. The fail-hard gate below turns a missing-creds
 * checkout into a clear error instead of a string of cryptic 5xx failures.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createTestHarness } from "wrangler";
import type { TestHarness, WorkerHandle } from "wrangler";

/**
 * Env the dev Worker is configured with. Binding names match `wrangler.jsonc`
 * and `src/env.ts` (`ApiBindings`). These are the ambient Cloudflare types
 * declared in `src/cf.d.ts`, available project-wide via `tsconfig`.
 */
export type DevEnv = {
  API_KEY: string;
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
};

/** Absolute path to this package (where `wrangler.jsonc` lives). */
export const API_PKG_DIR = fileURLToPath(new URL("../../", import.meta.url));

const WRANGLER_CONFIG_PATH = "./wrangler.jsonc";

export interface HarnessContext {
  server: TestHarness;
  worker: WorkerHandle<DevEnv>;
  env: DevEnv;
  apiKey: string;
  vectorize: VectorizeIndex;
  config: WranglerDevConfig;
}

export interface WranglerDevConfig {
  /** `env.dev.vectorize[0].index_name` from the raw config file. */
  devIndexName: string;
  /** `env.dev.vectorize[0].remote` from the raw config file. */
  devRemote: boolean;
  /** Top-level `vectorize[0].index_name` (production) from the raw config. */
  prodIndexName: string;
}

/**
 * Throws if the remote dev bindings cannot be reached. Called before
 * `listen()` so the failure is loud and immediate.
 */
export function assertCloudflareCreds(): void {
  const missing: string[] = [];
  if (!process.env.CLOUDFLARE_API_TOKEN) missing.push("CLOUDFLARE_API_TOKEN");
  if (!process.env.CLOUDFLARE_ACCOUNT_ID) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (missing.length > 0) {
    throw new Error(
      `Integration suite needs Cloudflare credentials for remote dev bindings. ` +
        `Set ${missing.join(" and ")} in the environment (e.g. .env). ` +
        `See ADR-0007 and the issue #22 test plan.`,
    );
  }
}

/**
 * Boots the dev Worker and returns handles for driving it and inspecting its
 * bindings. The caller owns the lifecycle: `beforeAll` calls this, `afterAll`
 * calls `ctx.server.close()`.
 */
export async function bootHarness(): Promise<HarnessContext> {
  assertCloudflareCreds();

  const config = await readWranglerDevConfig();

  const server = createTestHarness({
    root: API_PKG_DIR,
    workers: [{ configPath: WRANGLER_CONFIG_PATH, env: "dev" }],
  });

  await server.listen();

  const worker = server.getWorker<DevEnv>();
  const env = await worker.getEnv();
  const apiKey = (env.API_KEY ?? "").trim();
  if (apiKey.length === 0) {
    throw new Error(
      "Dev Worker has no API_KEY. Set it in packages/openbrain-api/.dev.vars " +
        "(gitignored) so the harness can authenticate its own requests.",
    );
  }

  return {
    server,
    worker,
    env,
    apiKey,
    vectorize: env.VECTORIZE,
    config,
  };
}

/**
 * Restores local storage to its initial state (wipes the local D1) and
 * re-applies migrations so each case starts from a clean row store. Remote
 * bindings (Vectorize dev, Workers AI) are NOT touched by reset — per-case
 * vector cleanup is the caller's job. Re-fetches the worker handle because
 * `reset()` may move the server to a new URL.
 */
export async function resetAndMigrate(
  ctx: HarnessContext,
): Promise<{ worker: WorkerHandle<DevEnv>; env: DevEnv; apiKey: string }> {
  await ctx.server.reset();
  // reset() recreates storage and may move the server to a new URL; per the
  // wrangler docs, after a reset the next listen() starts a fresh session, so
  // call it to guarantee the server is bound before we touch it.
  await ctx.server.listen();
  const worker = ctx.server.getWorker<DevEnv>();
  await worker.applyD1Migrations("DB");
  const env = await worker.getEnv();
  const apiKey = (env.API_KEY ?? "").trim();
  ctx.worker = worker;
  ctx.env = env;
  ctx.apiKey = apiKey;
  ctx.vectorize = env.VECTORIZE;
  return { worker, env, apiKey };
}

/**
 * Polls `fn` until it returns truthy or `timeoutMs` elapses. Vectorize upsert
 * and delete are eventually consistent, so presence/absence checks must
 * retry. On timeout, performs one final probe and includes its result in the
 * thrown error for diagnosis.
 */
export async function waitFor<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; intervalMs?: number; label?: string } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const label = opts.label ?? "condition";
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const result = await fn();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  let snapshot: string;
  try {
    const result = await fn();
    snapshot = result ? `truthy: ${JSON.stringify(result)}` : "falsy";
  } catch (error) {
    snapshot = `threw: ${String(
      error instanceof Error ? error.message : error,
    )}`;
  }
  throw new Error(
    `waitFor(${label}) timed out after ${timeoutMs}ms. Final probe: ${snapshot}` +
      (lastError ? `. Last poll error: ${String(lastError)}` : ""),
  );
}

/** True when the dev index holds a vector for `id`. Lag-aware via retry. */
export async function vectorExists(
  vectorize: VectorizeIndex,
  id: string,
): Promise<boolean> {
  const rows = await vectorize.getByIds([id]);
  return Array.isArray(rows) && rows.some((row) => row?.id === id);
}

/** True when the dev index no longer holds a vector for `id`. */
export async function vectorGone(
  vectorize: VectorizeIndex,
  id: string,
): Promise<boolean> {
  return !(await vectorExists(vectorize, id));
}

/**
 * Reads `wrangler.jsonc` and returns the dev + production Vectorize config.
 * Used by P0.6 to assert the dev Worker is bound to the dev index (not prod).
 * A minimal JSONC comment stripper keeps this dependency-free.
 */
export async function readWranglerDevConfig(): Promise<WranglerDevConfig> {
  const raw = await readFile(
    fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url)),
    "utf8",
  );
  const config = JSON.parse(stripJsonc(raw)) as WranglerJsonc;

  const devVectorize = config.env?.dev?.vectorize?.[0];
  const prodVectorize = config.vectorize?.[0];

  if (!devVectorize?.index_name) {
    throw new Error("wrangler.jsonc has no env.dev.vectorize[0].index_name");
  }
  if (!prodVectorize?.index_name) {
    throw new Error("wrangler.jsonc has no top-level vectorize[0].index_name");
  }

  return {
    devIndexName: devVectorize.index_name,
    devRemote: devVectorize.remote === true,
    prodIndexName: prodVectorize.index_name,
  };
}

interface WranglerJsonc {
  vectorize?: Array<{
    binding?: string;
    index_name?: string;
  }>;
  env?: {
    dev?: {
      vectorize?: Array<{
        binding?: string;
        index_name?: string;
        remote?: boolean;
      }>;
    };
  };
}

/** Strips `//` line comments, `/* block *‍/` comments, and JSONC trailing
 * commas (all legal in JSONC, illegal in JSON), string-aware. */
function stripJsonc(input: string): string {
  let out = "";
  let i = 0;
  const n = input.length;
  // Drop a structural comma that immediately precedes the closing brace we
  // are about to emit (handles JSONC trailing commas like `"a": 1,\n  }`).
  const dropTrailingComma = () => {
    out = out.replace(/,(\s*)$/, "$1");
  };
  while (i < n) {
    const ch = input[i];
    const next = input[i + 1];
    // String literal (handles \" escapes; JSONC has no single-quoted strings).
    if (ch === '"') {
      out += ch;
      i++;
      while (i < n) {
        const c = input[i];
        out += c;
        if (c === "\\") {
          out += input[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Line comment
    if (ch === "/" && next === "/") {
      i += 2;
      while (i < n && input[i] !== "\n") i++;
      continue;
    }
    // Block comment
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < n && !(input[i] === "*" && input[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Closing brace/bracket: remove a preceding trailing comma first.
    if (ch === "}" || ch === "]") {
      dropTrailingComma();
      out += ch;
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}
