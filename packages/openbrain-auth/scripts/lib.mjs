import { context as createEsbuildContext, build as runEsbuildBuild } from "esbuild";
import { cp, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const root = path.resolve(__dirname, "..");
export const dist = path.join(root, "dist");

export async function loadLocalEnv() {
  const envPath = path.join(root, ".env.local");

  try {
    const raw = await readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      let value = trimmed.slice(separatorIndex + 1).trim();
      if (!key || process.env[key]) {
        continue;
      }

      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (!message.includes("ENOENT")) {
      throw error;
    }
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required build environment variable: ${name}`);
  }

  return value;
}

export function getBuildOptions() {
  return {
    entryPoints: {
      login: path.join(root, "src", "login.ts"),
      consent: path.join(root, "src", "consent.ts"),
    },
    outdir: path.join(dist, "assets"),
    bundle: true,
    format: "esm",
    target: "es2022",
    sourcemap: true,
    minify: false,
    logLevel: "info",
    define: {
      __SUPABASE_URL__: JSON.stringify(requireEnv("OPENBRAIN_AUTH_SUPABASE_URL")),
      __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(requireEnv("OPENBRAIN_AUTH_SUPABASE_PUBLISHABLE_KEY")),
    },
  };
}

export async function prepareDist() {
  await rm(dist, { force: true, recursive: true });
  await mkdir(path.join(dist, "assets"), { recursive: true });
  await cp(path.join(root, "public"), dist, { recursive: true });
}

export async function buildOnce() {
  await prepareDist();
  await runEsbuildBuild(getBuildOptions());
}

export async function createWatchContext() {
  await prepareDist();
  return createEsbuildContext(getBuildOptions());
}

export async function pathExists(filePath) {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}
