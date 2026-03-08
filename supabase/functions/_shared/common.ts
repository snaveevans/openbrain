import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export interface EmbeddingResponse {
  data?: Array<{
    embedding?: number[];
  }>;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function requireApiKey(req: Request): Response | null {
  const configuredApiKey = Deno.env.get("API_KEY")?.trim();
  if (!configuredApiKey) {
    return json({ error: "API_KEY secret is not configured." }, 500);
  }

  const providedApiKey = req.headers.get("x-api-key")?.trim();
  if (providedApiKey !== configuredApiKey) {
    return json({ error: "Unauthorized." }, 401);
  }

  return null;
}

export function createServiceClient(): SupabaseClient {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase credentials are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

export async function generateEmbedding(input: string): Promise<{ embedding: number[]; model: string }> {
  const baseUrl = Deno.env.get("EMBEDDING_BASE_URL")?.trim() ?? "https://api.openai.com/v1";
  const apiKey = Deno.env.get("EMBEDDING_API_KEY")?.trim();
  const model = Deno.env.get("EMBEDDING_MODEL")?.trim() ?? "text-embedding-3-small";
  const dimensionsValue = Deno.env.get("EMBEDDING_DIMENSIONS")?.trim();

  if (!apiKey) {
    throw new Error("EMBEDDING_API_KEY secret is not configured.");
  }

  const payload: Record<string, unknown> = {
    input,
    model,
  };

  if (dimensionsValue) {
    const dimensions = Number.parseInt(dimensionsValue, 10);
    if (Number.isFinite(dimensions) && dimensions > 0) {
      payload.dimensions = dimensions;
    }
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/embeddings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Embedding request failed: ${response.status} ${message}`);
  }

  const data = await response.json() as EmbeddingResponse;
  const embedding = data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error("Embedding response did not include an embedding vector.");
  }

  return { embedding, model };
}
