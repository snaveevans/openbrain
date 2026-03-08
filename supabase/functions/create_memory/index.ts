import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface CreateMemoryPayload {
  content?: unknown;
  source?: unknown;
  metadata?: unknown;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function getApiToken(req: Request): string | null {
  const header = req.headers.get("x-api-key");
  return header?.trim() || null;
}

function validatePayload(payload: CreateMemoryPayload): { content: string; source: string; metadata: Record<string, unknown> } {
  if (typeof payload.content !== "string" || payload.content.trim().length === 0) {
    throw new Error("`content` must be a non-empty string.");
  }

  const source = typeof payload.source === "string" && payload.source.trim().length > 0
    ? payload.source.trim()
    : "manual";

  const metadata = payload.metadata;
  if (metadata !== undefined && (metadata === null || Array.isArray(metadata) || typeof metadata !== "object")) {
    throw new Error("`metadata` must be a JSON object when provided.");
  }

  return {
    content: payload.content.trim(),
    source,
    metadata: (metadata as Record<string, unknown> | undefined) ?? {},
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const configuredApiKey = Deno.env.get("API_KEY")?.trim();
  if (!configuredApiKey) {
    return json({ error: "API_KEY secret is not configured." }, 500);
  }

  const providedApiKey = getApiToken(req);
  if (providedApiKey !== configuredApiKey) {
    return json({ error: "Unauthorized." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: "Supabase credentials are not configured." }, 500);
  }

  let payload: CreateMemoryPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  let values: { content: string; source: string; metadata: Record<string, unknown> };
  try {
    values = validatePayload(payload);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request body." }, 400);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  const { data, error } = await supabase
    .from("memories")
    .insert(values)
    .select("id, content, source, metadata, created_at, updated_at")
    .single();

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ memory: data }, 201);
});
