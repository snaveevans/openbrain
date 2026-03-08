import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, json, requireApiKey } from "../_shared/common.ts";

interface DeleteMemoryPayload {
  id?: unknown;
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

  const authError = requireApiKey(req);
  if (authError) {
    return authError;
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

  let supabase;
  try {
    supabase = createServiceClient();
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Failed to initialize delete_memory." }, 500);
  }

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
