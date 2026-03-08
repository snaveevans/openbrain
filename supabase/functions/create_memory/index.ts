import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createServiceClient, generateEmbedding, json, requireApiKey } from "../_shared/common.ts";

interface CreateMemoryPayload {
  content?: unknown;
  source?: unknown;
  metadata?: unknown;
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

  const authError = requireApiKey(req);
  if (authError) {
    return authError;
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

  let supabase;
  let embedding;
  let embeddingModel;
  try {
    supabase = createServiceClient();
    const generated = await generateEmbedding(values.content);
    embedding = generated.embedding;
    embeddingModel = generated.model;
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Failed to initialize memory creation." }, 500);
  }

  const { data, error } = await supabase
    .from("memories")
    .insert({
      ...values,
      embedding,
      embedding_model: embeddingModel,
      embedded_at: new Date().toISOString(),
    })
    .select("id, content, source, metadata, embedding_model, created_at, updated_at, embedded_at")
    .single();

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ memory: data }, 201);
});
