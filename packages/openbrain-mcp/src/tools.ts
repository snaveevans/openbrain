import {
  API_KEY_HEADER,
  type MemoryDocument,
  type SearchHit,
} from "@snaveevans/openbrain-common";

import type { McpBindings } from "./env.js";
import type { RestRequest, RestClient, RestResponse } from "./rest-client.js";
import {
  renderDeleted,
  renderNotFound,
  renderSearch,
  renderSingle,
} from "./render.js";

/** MCP `tools/call` content block (text only, per hosted-mcp.md). */
export interface ToolContent {
  type: "text";
  text: string;
}

/** MCP `tools/call` result envelope. `isError` is absent on success. */
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** MCP `tools/list` entry: name, description, JSON-Schema `inputSchema`. */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: object;
}

/**
 * The four tools cover the full REST surface (hosted-mcp.md). Schemas mirror
 * the REST body/params (operation specs); REST owns validation — the Worker
 * forwards and never validates client-side.
 */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "search_memories",
    description:
      "Search the operator's memories by semantic similarity to a natural-language query. Returns ranked matches, closest first.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Natural-language search query.",
        },
        limit: {
          type: "number",
          description: "Max results (1-25; default 10).",
        },
        threshold: {
          type: "number",
          description: "Similarity threshold in [0, 1]; drops hits below it.",
        },
        source: { type: "string", description: "Exact source label filter." },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch",
    description: "Fetch one memory by its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id (UUID v4)." },
      },
      required: ["id"],
    },
  },
  {
    name: "create_memory",
    description: "Create a new memory from text content.",
    inputSchema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Memory text (non-empty)." },
        source: {
          type: "string",
          description: 'Origin label (default "manual").',
        },
        metadata: { type: "object", description: "Arbitrary JSON object." },
      },
      required: ["content"],
    },
  },
  {
    name: "delete_memory",
    description: "Delete one memory by its id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Memory id (UUID v4)." },
      },
      required: ["id"],
    },
  },
];

const TOOL_NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

export function isKnownTool(name: unknown): name is string {
  return typeof name === "string" && TOOL_NAMES.has(name);
}

/**
 * Build an upstream REST request carrying the Worker's **own** `API_KEY` —
 * never a caller credential. `id` is URL-encoded as one path segment so a
 * traversal string like `../foo` can never escape `/memories/`. POSTs carry
 * `content-type: application/json`; GET/DELETE carry no body.
 */
function restRequest(
  env: McpBindings,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: string,
): RestRequest {
  const base = (env.API_URL ?? "").replace(/\/+$/, "");
  const headers: Record<string, string> = {
    [API_KEY_HEADER]: (env.API_KEY ?? "").trim(),
  };
  if (method === "POST") {
    headers["content-type"] = "application/json";
  }
  return { method, url: `${base}${path}`, headers, body };
}

/** REST `400` / `401` / `500` → MCP tool error: the server `error` string,
 * or a status mention if the body has none. */
function errorResult(res: RestResponse): ToolResult {
  const fallback = `Request failed with ${res.status}.`;
  let text = fallback;
  try {
    const parsed = JSON.parse(res.body) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === "string"
    ) {
      text = (parsed as { error: string }).error;
    }
  } catch {
    // Body was not JSON — keep the status mention.
  }
  return { content: [{ type: "text", text }], isError: true };
}

/** REST unreachable (no HTTP response — network/DNS/throw). Open Question
 * parks the exact text; the edge table pins `isError: true`. */
const UNREACHABLE: ToolResult = {
  content: [{ type: "text", text: "REST API is unreachable." }],
  isError: true,
};

function encodeId(args: Record<string, unknown>): string {
  const id = args.id;
  return encodeURIComponent(typeof id === "string" ? id : String(id ?? ""));
}

async function searchMemories(
  args: Record<string, unknown>,
  env: McpBindings,
  rest: RestClient,
): Promise<ToolResult> {
  const req = restRequest(
    env,
    "POST",
    "/memories/search",
    JSON.stringify(args),
  );
  let res: RestResponse;
  try {
    res = await rest.request(req);
  } catch {
    return UNREACHABLE;
  }
  if (res.status === 200) {
    const query = typeof args.query === "string" ? args.query : "";
    const parsed = safeJson(res.body) as { matches?: unknown[] } | null;
    const matches = Array.isArray(parsed?.matches)
      ? (parsed.matches as unknown[])
      : [];
    return {
      content: [
        { type: "text", text: renderSearch(matches as SearchHit[], query) },
      ],
    };
  }
  return errorResult(res);
}

async function fetchMemory(
  args: Record<string, unknown>,
  env: McpBindings,
  rest: RestClient,
): Promise<ToolResult> {
  const idRaw = typeof args.id === "string" ? args.id : String(args.id ?? "");
  const req = restRequest(env, "GET", `/memories/${encodeId(args)}`);
  let res: RestResponse;
  try {
    res = await rest.request(req);
  } catch {
    return UNREACHABLE;
  }
  if (res.status === 200) {
    const parsed = safeJson(res.body) as { memory?: unknown } | null;
    return {
      content: [
        { type: "text", text: renderSingle(parsed?.memory as MemoryDocument) },
      ],
    };
  }
  if (res.status === 404) {
    return { content: [{ type: "text", text: renderNotFound(idRaw) }] };
  }
  return errorResult(res);
}

async function createMemory(
  args: Record<string, unknown>,
  env: McpBindings,
  rest: RestClient,
): Promise<ToolResult> {
  const req = restRequest(env, "POST", "/memories", JSON.stringify(args));
  let res: RestResponse;
  try {
    res = await rest.request(req);
  } catch {
    return UNREACHABLE;
  }
  if (res.status === 201) {
    const parsed = safeJson(res.body) as { memory?: unknown } | null;
    return {
      content: [
        { type: "text", text: renderSingle(parsed?.memory as MemoryDocument) },
      ],
    };
  }
  return errorResult(res);
}

async function deleteMemory(
  args: Record<string, unknown>,
  env: McpBindings,
  rest: RestClient,
): Promise<ToolResult> {
  const idRaw = typeof args.id === "string" ? args.id : String(args.id ?? "");
  const req = restRequest(env, "DELETE", `/memories/${encodeId(args)}`);
  let res: RestResponse;
  try {
    res = await rest.request(req);
  } catch {
    return UNREACHABLE;
  }
  if (res.status === 200) {
    const parsed = safeJson(res.body) as { memory?: unknown } | null;
    return {
      content: [
        { type: "text", text: renderDeleted(parsed?.memory as MemoryDocument) },
      ],
    };
  }
  if (res.status === 404) {
    return { content: [{ type: "text", text: renderNotFound(idRaw) }] };
  }
  return errorResult(res);
}

/** Dispatch a `tools/call` to its handler. Caller checks `isKnownTool` first. */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>,
  env: McpBindings,
  rest: RestClient,
): Promise<ToolResult> {
  switch (name) {
    case "search_memories":
      return searchMemories(args, env, rest);
    case "fetch":
      return fetchMemory(args, env, rest);
    case "create_memory":
      return createMemory(args, env, rest);
    case "delete_memory":
      return deleteMemory(args, env, rest);
    default:
      // Unreachable: isKnownTool guards the dispatch. Defensive fallthrough.
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
