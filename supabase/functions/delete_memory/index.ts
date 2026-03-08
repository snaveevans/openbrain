import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

interface DeleteMemoryPayload {
  id?: unknown;
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validatePayload(payload: DeleteMemoryPayload): { id: string } {
  if (typeof payload.id !== "string" || !isUuid(payload.id.trim())) {
    throw new Error("`id` must be a valid UUID.");
  }

  return { id: payload.id.trim() };
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

  let payload: DeleteMemoryPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  let values: { id: string };
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
    .delete()
    .eq("id", values.id)
    .select("id, content, source, metadata, created_at, updated_at")
    .maybeSingle();

  if (error) {
    return json({ error: error.message }, 500);
  }

  if (!data) {
    return json({ error: "Memory not found." }, 404);
  }

  return json({ memory: data, deleted: true }, 200);
});
