import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createWatchContext, dist, loadLocalEnv, pathExists } from "./lib.mjs";

await loadLocalEnv();

const host = process.env.OPENBRAIN_AUTH_HOST ?? "127.0.0.1";
const port = Number(process.env.OPENBRAIN_AUTH_PORT ?? "3000");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function getContentType(filePath) {
  return contentTypes[path.extname(filePath)] ?? "application/octet-stream";
}

async function resolveFilePath(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requestedPath = cleanPath === "/" ? "/index.html" : cleanPath;
  const directPath = path.join(dist, requestedPath);
  const directoryIndexPath = path.join(dist, requestedPath, "index.html");
  const routeIndexPath = path.join(dist, requestedPath.replace(/\/+$/, ""), "index.html");

  if (await pathExists(directPath)) {
    return directPath;
  }

  if (await pathExists(directoryIndexPath)) {
    return directoryIndexPath;
  }

  if (await pathExists(routeIndexPath)) {
    return routeIndexPath;
  }

  return null;
}

const esbuildContext = await createWatchContext();
await esbuildContext.watch();

const server = createServer(async (req, res) => {
  try {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { "content-type": "text/plain; charset=utf-8" });
      res.end("Method not allowed");
      return;
    }

    const filePath = await resolveFilePath(req.url ?? "/");
    if (!filePath) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const body = await readFile(filePath);
    res.writeHead(200, {
      "content-type": getContentType(filePath),
      "cache-control": "no-store",
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    res.end(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(message);
  }
});

server.listen(port, host, () => {
  console.log(`openbrain-auth dev server running at http://${host}:${port}`);
  console.log(`login: http://${host}:${port}/login`);
  console.log(`consent: http://${host}:${port}/oauth/consent`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await esbuildContext.dispose();
    process.exit(0);
  });
}
