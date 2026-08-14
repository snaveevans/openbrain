import type { JsonObject } from "@snaveevans/openbrain-common";

/**
 * Conservative character budget for EmbeddingGemma's 2048-token window.
 * Prefixes are prepended by the embedder; this limit is on caller content.
 */
export const MAX_EMBED_CONTENT_CHARS = 4096;

/** D1 row cap is 2 MB; leave headroom for SQL encoding. */
export const MAX_MEMORY_ROW_BYTES = 2_000_000;

const ROW_OVERHEAD_BYTES = 256;

export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function estimatedMemoryRowBytes(input: {
  content: string;
  source: string;
  metadata: JsonObject;
}): number {
  return (
    utf8Bytes(input.content) +
    utf8Bytes(input.source) +
    utf8Bytes(JSON.stringify(input.metadata)) +
    ROW_OVERHEAD_BYTES
  );
}
