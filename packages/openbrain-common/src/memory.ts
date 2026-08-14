/**
 * Canonical memory document from
 * docs/specs/cross-cutting/memory-model.md.
 *
 * `similarity` is query-time only and is never stored.
 * Embedding fields are omitted when the memory has no embedding.
 */
export type JsonObject = Record<string, unknown>;

export interface Memory {
  id: string;
  content: string;
  source: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  embedding_model?: string;
  embedded_at?: string;
  similarity?: number;
}

/** Durable document as kept by the store. No search score. */
export type MemoryDocument = Omit<Memory, "similarity">;

/** Ranked search hit. `similarity` is in `[0, 1]`. */
export type SearchHit = Memory & { similarity: number };

export const DEFAULT_SOURCE = "manual";

export const DEFAULT_SEARCH_LIMIT = 10;
export const MIN_SEARCH_LIMIT = 1;
export const MAX_SEARCH_LIMIT = 25;
