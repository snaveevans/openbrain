import type { McpBindings } from "./env.js";
import type { RestClient } from "./rest-client.js";
import {
  handleToolCall,
  isKnownTool,
  TOOL_DEFINITIONS,
  type ToolResult,
} from "./tools.js";

/** Latest MCP protocol version (modelcontextprotocol.org/specification/latest). */
export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_SERVER_NAME = "openbrain-mcp";
export const MCP_SERVER_VERSION = "0.1.0";

/** JSON-RPC 2.0 error codes (jsonrpc.org/spec). */
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;

export type JsonRpcId = number | string | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string };
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

/** `initialize` result: protocol version + a `tools` capability (nothing else). */
const INITIALIZE_RESULT = {
  protocolVersion: MCP_PROTOCOL_VERSION,
  capabilities: { tools: {} },
  serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
};

function resultResponse(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorResponse(
  id: JsonRpcId,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function idOf(raw: unknown): JsonRpcId {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (typeof (raw as { id?: unknown }).id === "number" ||
      typeof (raw as { id?: unknown }).id === "string")
  ) {
    return (raw as { id: JsonRpcId }).id;
  }
  return null;
}

function isRequest(raw: unknown): raw is JsonRpcRequest {
  return (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { jsonrpc?: unknown }).jsonrpc === "2.0" &&
    typeof (raw as { method?: unknown }).method === "string"
  );
}

/**
 * Stateless JSON-RPC dispatch for `POST {mcp}/mcp`. `initialize`, `ping`,
 * `tools/list`, and `tools/call` are the S1 method set; anything else is
 * `-32601`. `tools/call` delegates to the tool handlers (which call REST).
 * The response is always HTTP 200 — domain failures live in `result.isError`,
 * not the HTTP status.
 */
export async function handleJsonRpc(
  raw: unknown,
  env: McpBindings,
  rest: RestClient,
): Promise<JsonRpcResponse> {
  if (!isRequest(raw)) {
    return errorResponse(idOf(raw), INVALID_REQUEST, "Invalid Request");
  }
  const req = raw;
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      return resultResponse(id, INITIALIZE_RESULT);
    case "ping":
      return resultResponse(id, {});
    case "tools/list":
      return resultResponse(id, { tools: TOOL_DEFINITIONS });
    case "tools/call": {
      const params = req.params ?? {};
      const name = params.name;
      if (!isKnownTool(name)) {
        return errorResponse(id, METHOD_NOT_FOUND, "Method not found");
      }
      const args = isArgsObject(params.arguments) ? params.arguments : {};
      const toolResult: ToolResult = await handleToolCall(
        name,
        args,
        env,
        rest,
      );
      return resultResponse(id, toolResult);
    }
    default:
      return errorResponse(id, METHOD_NOT_FOUND, "Method not found");
  }
}

/** Parse-error response (body was not valid JSON). */
export function parseErrorResponse(): JsonRpcResponse {
  return errorResponse(null, PARSE_ERROR, "Parse error");
}

function isArgsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
