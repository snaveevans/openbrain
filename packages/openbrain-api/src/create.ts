import {
  DEFAULT_SOURCE,
  ERROR_BODY_NOT_OBJECT,
  ERROR_CONTENT_EMPTY,
  ERROR_CONTENT_TOO_LARGE,
  ERROR_MEMORY_TOO_LARGE,
  ERROR_METADATA_OBJECT,
  type CreateMemoryResponse,
  type Embedder,
  type JsonObject,
  type MemoryDocument,
  type MemoryStore,
  type VectorIndex,
} from "@snaveevans/openbrain-common";

import { isoNow } from "./clock.js";
import type { CreateDeps } from "./env.js";
import { ValidationError } from "./errors.js";
import {
  estimatedMemoryRowBytes,
  MAX_EMBED_CONTENT_CHARS,
  MAX_MEMORY_ROW_BYTES,
} from "./limits.js";

export { ValidationError } from "./errors.js";

export type CreateMemoryInput = {
  content: string;
  source: string;
  metadata: JsonObject;
};

export function parseCreateBody(raw: unknown): CreateMemoryInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(ERROR_BODY_NOT_OBJECT);
  }

  const body = raw as Record<string, unknown>;
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    throw new ValidationError(ERROR_CONTENT_EMPTY);
  }

  const content = body.content.trim();
  const source =
    typeof body.source === "string" && body.source.trim().length > 0
      ? body.source.trim()
      : DEFAULT_SOURCE;

  const metadata = body.metadata;
  if (
    metadata !== undefined &&
    (metadata === null ||
      Array.isArray(metadata) ||
      typeof metadata !== "object")
  ) {
    throw new ValidationError(ERROR_METADATA_OBJECT);
  }

  const input: CreateMemoryInput = {
    content,
    source,
    metadata: (metadata as JsonObject | undefined) ?? {},
  };

  if (content.length > MAX_EMBED_CONTENT_CHARS) {
    throw new ValidationError(ERROR_CONTENT_TOO_LARGE);
  }
  if (estimatedMemoryRowBytes(input) > MAX_MEMORY_ROW_BYTES) {
    throw new ValidationError(ERROR_MEMORY_TOO_LARGE);
  }

  return input;
}

export async function createMemory(
  input: CreateMemoryInput,
  deps: CreateDeps,
): Promise<CreateMemoryResponse> {
  const embedded = await deps.embedder.embed(input.content, "document");
  if (!Array.isArray(embedded.values) || embedded.values.length === 0) {
    throw new Error("Embedding response did not include a vector.");
  }
  const at = isoNow(deps.now());
  const document: MemoryDocument = {
    id: deps.id(),
    content: input.content,
    source: input.source,
    metadata: input.metadata,
    created_at: at,
    updated_at: at,
    embedding_model: embedded.model,
    embedded_at: at,
  };

  try {
    await deps.index.upsert({
      id: document.id,
      values: embedded.values,
      source: document.source,
    });
  } catch (error) {
    await deps.index.deleteById(document.id).catch(() => undefined);
    throw error;
  }

  try {
    await deps.store.insert(document);
  } catch (error) {
    await deps.index.deleteById(document.id).catch(() => undefined);
    throw error;
  }

  return { memory: document };
}

export function productionCreateDeps(
  store: MemoryStore,
  embedder: Embedder,
  index: VectorIndex,
): CreateDeps {
  return {
    store,
    embedder,
    index,
    now: () => new Date(),
    id: () => crypto.randomUUID(),
  };
}
