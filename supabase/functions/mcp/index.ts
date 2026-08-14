import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@6.1.3";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.27.1/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.27.1/server/webStandardStreamableHttp.js";
import { z } from "npm:zod@4.1.5";
import { createServiceClient, generateEmbedding, json } from "../_shared/common.ts";

interface AuthContext {
  sub: string;
  email: string | null;
  clientId: string | null;
  aal: string | null;
}

interface JwtClaims {
  sub?: string;
  email?: string;
  client_id?: string;
  aal?: string;
  aud?: string | string[];
}

interface SearchMatch {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding_model?: string | null;
  created_at: string;
  updated_at: string;
  similarity?: number | null;
}

interface FetchMatch {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  embedding_model?: string | null;
  created_at: string;
  updated_at: string;
  embedded_at?: string | null;
}

const DEFAULT_SCOPES = ["openid", "email"];
const MEMORY_ID_SCHEMA = z.string().uuid();

function parseCsvEnv(name: string): string[] {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getSupabaseBaseUrl(): string {
  const configured = Deno.env.get("SUPABASE_URL")?.trim();
  if (!configured) {
    throw new Error("SUPABASE_URL secret is not configured.");
  }

  return configured.replace(/\/+$/, "");
}

function getOAuthIssuer(): string {
  const configured = Deno.env.get("OAUTH_ISSUER")?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  return `${getSupabaseBaseUrl()}/auth/v1`;
}

function getPublicBaseUrl(req: Request): string {
  const configured = Deno.env.get("MCP_PUBLIC_BASE_URL")?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const url = new URL(req.url);
  const match = url.pathname.match(/^(.*\/functions\/v1\/mcp)(?:\/.*)?$/);
  const pathname = match?.[1] ?? url.pathname.replace(/\/+$/, "");
  return `${url.origin}${pathname}`;
}

function getProtectedResourceMetadataUrl(req: Request): string {
  return `${getPublicBaseUrl(req)}/.well-known/oauth-protected-resource`;
}

function getScopes(): string[] {
  const configured = parseCsvEnv("MCP_OAUTH_SCOPES");
  return configured.length > 0 ? configured : DEFAULT_SCOPES;
}

function buildChallenge(req: Request, options: { error?: string; description?: string } = {}): string {
  const parts = [
    `Bearer resource_metadata="${getProtectedResourceMetadataUrl(req)}"`,
    `scope="${getScopes().join(" ")}"`,
  ];

  if (options.error) {
    parts.push(`error="${options.error}"`);
  }

  if (options.description) {
    const escaped = options.description.replace(/["\\]/g, "\\$&");
    parts.push(`error_description="${escaped}"`);
  }

  return parts.join(", ");
}

function unauthorized(req: Request, description: string): Response {
  return json(
    { error: description },
    401,
    {
      "cache-control": "no-store",
      "www-authenticate": buildChallenge(req, { error: "invalid_token", description }),
    },
  );
}

function forbidden(req: Request, description: string): Response {
  return json(
    { error: description },
    403,
    {
      "cache-control": "no-store",
      "www-authenticate": buildChallenge(req, { error: "insufficient_scope", description }),
    },
  );
}

function getProtectedResourceMetadata(req: Request): Record<string, unknown> {
  return {
    resource: getPublicBaseUrl(req),
    authorization_servers: [getOAuthIssuer()],
    scopes_supported: getScopes(),
    bearer_methods_supported: ["header"],
    resource_documentation: Deno.env.get("MCP_RESOURCE_DOCUMENTATION")?.trim() || undefined,
  };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${getOAuthIssuer()}/.well-known/jwks.json`));
  }

  return jwks;
}

async function authorizeRequest(req: Request): Promise<AuthContext | Response> {
  const authorization = req.headers.get("authorization")?.trim();
  if (!authorization?.startsWith("Bearer ")) {
    return unauthorized(req, "Missing bearer token.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    return unauthorized(req, "Missing bearer token.");
  }

  let claims: JwtClaims;
  try {
    const verified = await jwtVerify(token, getJwks(), {
      issuer: getOAuthIssuer(),
      audience: "authenticated",
    });
    claims = verified.payload as JwtClaims;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token verification failed.";
    return unauthorized(req, message);
  }

  if (typeof claims.sub !== "string" || claims.sub.length === 0) {
    return unauthorized(req, "Access token is missing subject information.");
  }

  const clientId = typeof claims.client_id === "string" && claims.client_id.length > 0 ? claims.client_id : null;
  const email = typeof claims.email === "string" && claims.email.length > 0 ? claims.email.toLowerCase() : null;
  const aal = typeof claims.aal === "string" && claims.aal.length > 0 ? claims.aal : null;

  const allowedClientIds = parseCsvEnv("OAUTH_ALLOWED_CLIENT_IDS");
  if (allowedClientIds.length > 0 && (!clientId || !allowedClientIds.includes(clientId))) {
    return forbidden(req, "This OAuth client is not allowed to access Open Brain.");
  }

  const allowedSubjects = parseCsvEnv("OAUTH_ALLOWED_SUBJECTS");
  if (allowedSubjects.length > 0 && !allowedSubjects.includes(claims.sub)) {
    return forbidden(req, "This user is not allowed to access Open Brain.");
  }

  const allowedEmails = parseCsvEnv("OAUTH_ALLOWED_EMAILS").map((value) => value.toLowerCase());
  if (allowedEmails.length > 0 && (!email || !allowedEmails.includes(email))) {
    return forbidden(req, "This email is not allowed to access Open Brain.");
  }

  const requireAal2 = (Deno.env.get("OAUTH_REQUIRE_AAL2") ?? "false").trim().toLowerCase() === "true";
  if (requireAal2 && aal !== "aal2") {
    return forbidden(req, "AAL2 is required for this MCP server.");
  }

  return {
    sub: claims.sub,
    email,
    clientId,
    aal,
  };
}

function formatMemory(memory: SearchMatch | FetchMatch): string {
  return [
    `id: ${memory.id}`,
    `source: ${memory.source}`,
    `created_at: ${memory.created_at}`,
    `updated_at: ${memory.updated_at}`,
    "embedded_at" in memory && memory.embedded_at ? `embedded_at: ${memory.embedded_at}` : undefined,
    memory.embedding_model ? `embedding_model: ${memory.embedding_model}` : undefined,
    "similarity" in memory && typeof memory.similarity === "number" ? `similarity: ${memory.similarity.toFixed(4)}` : undefined,
    `metadata: ${JSON.stringify(memory.metadata)}`,
    "",
    memory.content,
  ].filter(Boolean).join("\n");
}

function createToolMeta() {
  return {
    securitySchemes: [
      {
        type: "oauth2",
        scopes: getScopes(),
      },
    ],
  };
}

function logEvent(event: string, details: Record<string, unknown>): void {
  console.info(JSON.stringify({ event, ...details }));
}

function createMcpServer(auth: AuthContext): McpServer {
  const server = new McpServer({
    name: "openbrain-remote",
    version: "0.1.0",
  });

  server.registerTool(
    "search",
    {
      title: "Search memories",
      description: "Search the memory store by semantic similarity.",
      inputSchema: z.object({
        query: z.string().min(1),
        limit: z.number().int().min(1).max(25).optional(),
        threshold: z.number().min(0).max(1).optional(),
        source: z.string().min(1).optional(),
      }),
      annotations: {
        title: "Search memories",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: createToolMeta(),
    },
    async ({ query, limit, threshold, source }) => {
      const startedAt = Date.now();
      try {
        const supabase = createServiceClient();
        const generated = await generateEmbedding(query);
        const { data, error } = await supabase.rpc("match_memories", {
          query_embedding: generated.embedding,
          match_count: limit ?? 10,
          match_source: source ?? null,
        });

        if (error) {
          throw new Error(error.message);
        }

        const matches = ((data ?? []) as SearchMatch[]).filter((memory) => {
          if (threshold === undefined) {
            return true;
          }

          return typeof memory.similarity === "number" && memory.similarity >= threshold;
        });

        logEvent("mcp.tool.search", {
          subject: auth.sub,
          client_id: auth.clientId,
          status: "ok",
          limit: limit ?? 10,
          count: matches.length,
          latency_ms: Date.now() - startedAt,
        });

        if (matches.length === 0) {
          return {
            content: [{ type: "text", text: `No memories matched \"${query}\".` }],
            structuredContent: { matches: [] },
          };
        }

        return {
          content: [{ type: "text", text: matches.map((memory, index) => `${index + 1}.\n${formatMemory(memory)}`).join("\n\n---\n\n") }],
          structuredContent: { matches },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Search failed.";
        logEvent("mcp.tool.search", {
          subject: auth.sub,
          client_id: auth.clientId,
          status: "error",
          error: message,
          latency_ms: Date.now() - startedAt,
        });

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "fetch",
    {
      title: "Fetch memory",
      description: "Fetch one memory by UUID.",
      inputSchema: z.object({
        id: MEMORY_ID_SCHEMA,
      }),
      annotations: {
        title: "Fetch memory",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      _meta: createToolMeta(),
    },
    async ({ id }) => {
      const startedAt = Date.now();
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase.rpc("fetch_memory", { memory_id: id }).maybeSingle();

        if (error) {
          throw new Error(error.message);
        }

        if (!data) {
          logEvent("mcp.tool.fetch", {
            subject: auth.sub,
            client_id: auth.clientId,
            status: "not_found",
            latency_ms: Date.now() - startedAt,
          });

          return {
            content: [{ type: "text", text: `Memory ${id} was not found.` }],
            isError: true,
          };
        }

        logEvent("mcp.tool.fetch", {
          subject: auth.sub,
          client_id: auth.clientId,
          status: "ok",
          latency_ms: Date.now() - startedAt,
        });

        return {
          content: [{ type: "text", text: formatMemory(data as FetchMatch) }],
          structuredContent: { memory: data },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Fetch failed.";
        logEvent("mcp.tool.fetch", {
          subject: auth.sub,
          client_id: auth.clientId,
          status: "error",
          error: message,
          latency_ms: Date.now() - startedAt,
        });

        return {
          content: [{ type: "text", text: message }],
          isError: true,
        };
      }
    },
  );

  return server;
}

function getRoute(req: Request): "health" | "metadata" | "mcp" | "not-found" {
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  if (path.endsWith("/.well-known/oauth-protected-resource")) {
    return "metadata";
  }

  if (path.endsWith("/health")) {
    return "health";
  }

  if (path.endsWith("/mcp")) {
    return "mcp";
  }

  return "not-found";
}

Deno.serve(async (req) => {
  try {
    const route = getRoute(req);

    if (route === "health") {
      return json({
        ok: true,
        service: "openbrain-mcp",
        auth_provider: "supabase",
        read_only: true,
        tools: ["search", "fetch"],
      }, 200, { "cache-control": "no-store" });
    }

    if (route === "metadata") {
      return json(getProtectedResourceMetadata(req), 200, { "cache-control": "public, max-age=300" });
    }

    if (route !== "mcp") {
      return json({ error: "Not found." }, 404);
    }

    const auth = await authorizeRequest(req);
    if (auth instanceof Response) {
      logEvent("mcp.auth", {
        path: new URL(req.url).pathname,
        status: auth.status,
      });
      return auth;
    }

    logEvent("mcp.auth", {
      path: new URL(req.url).pathname,
      status: 200,
      subject: auth.sub,
      client_id: auth.clientId,
      email: auth.email,
      aal: auth.aal,
    });

    const server = createMcpServer(auth);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(req);
    } finally {
      await server.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("Fatal error in mcp:", error);
    return json({ error: message }, 500);
  }
});
