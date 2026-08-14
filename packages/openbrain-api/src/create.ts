import {
  DEFAULT_SOURCE,
  ERROR_CONTENT_EMPTY,
  ERROR_INVALID_JSON,
  ERROR_METADATA_OBJECT,
  type CreateMemoryResponse,
  type Embedder,
  type JsonObject,
  type MemoryDocument,
  type MemoryStore,
  type VectorIndex,
} from "@snaveevans/openbrain-common";

import { isoNow, newMemoryId } from "./clock.js";
import type { CreateDeps } from "./env.js";

export class ValidationError extends Error {
  readonly status = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export type CreateMemoryInput = {
  content: string;
  source: string;
  metadata: JsonObject;
};

export function parseCreateBody(raw: unknown): CreateMemoryInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(ERROR_INVALID_JSON);
  }

  const body = raw as Record<string, unknown>;
  if (typeof body.content !== "string" || body.content.trim().length === 0) {
    throw new ValidationError(ERROR_CONTENT_EMPTY);
  }

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

  return {
    content: body.content.trim(),
    source,
    metadata: (metadata as JsonObject | undefined) ?? {},
  };
}

export async function createMemory(
  input: CreateMemoryInput,
  deps: CreateDeps,
): Promise<CreateMemoryResponse> {
  const embedded = await deps.embedder.embed(input.content, "document");
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

  await deps.store.insert(document);
  try {
    await deps.index.upsert({
      id: document.id,
      values: embedded.values,
      source: document.source,
    });
  } catch (error) {
    await deps.store.deleteById(document.id);
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
    id: newMemoryId,
  };
}
