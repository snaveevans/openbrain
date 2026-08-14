import { buildOnce, loadLocalEnv } from "./lib.mjs";

await loadLocalEnv();
await buildOnce();
