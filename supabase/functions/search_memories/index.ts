import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, generateEmbedding, json, requireApiKey } from "../_shared/common.ts";

interface SearchPayload {
  query?: unknown;
  limit?: unknown;
  source?: unknown;
}

function validatePayload(payload: SearchPayload): { query: string; limit: number; source: string | null } {
  if (typeof payload.query !== "string" || payload.query.trim().length === 0) {
    throw new Error("`query` must be a non-empty string.");
  }

  let limit = 10;
  if (typeof payload.limit === "number" && Number.isFinite(payload.limit)) {
    limit = Math.min(Math.max(Math.trunc(payload.limit), 1), 25);
  }

  const source = typeof payload.source === "string" && payload.source.trim().length > 0
    ? payload.source.trim()
    : null;

  return {
    query: payload.query.trim(),
    limit,
    source,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json({ error: "Method not allowed." }, 405);
  }

  const authError = requireApiKey(req);
  if (authError) {
    return authError;
  }

  let payload: SearchPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Request body must be valid JSON." }, 400);
  }

  let values: { query: string; limit: number; source: string | null };
  try {
    values = validatePayload(payload);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request body." }, 400);
  }

  let supabase;
  let embedding;
  try {
    supabase = createServiceClient();
    const generated = await generateEmbedding(values.query);
    embedding = generated.embedding;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Failed to initialize search_memories." }, 500);
  }

  const { data, error } = await supabase.rpc("match_memories", {
    query_embedding: embedding,
    match_count: values.limit,
    match_source: values.source,
  });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ matches: data ?? [] }, 200);
});
