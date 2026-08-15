import type { MemoryDocument } from "./memory.js";

/**
 * Embedder the REST Worker talks to. Adapters apply model-specific
 * query vs document prefixes. Callers must not point this at a
 * different model at runtime (ADR-0006).
 */
export type EmbedRole = "document" | "query";

export interface EmbedResult {
  values: number[];
  model: string;
}

export interface Embedder {
  embed(text: string, role: EmbedRole): Promise<EmbedResult>;
}

/**
 * Document store (D1). System of record for the memory row, including
 * embed metadata. Does not hold the vector (ADR-0005).
 */
export interface MemoryStore {
  insert(document: MemoryDocument): Promise<MemoryDocument>;
  getById(id: string): Promise<MemoryDocument | null>;
  deleteById(id: string): Promise<MemoryDocument | null>;
  /** Found rows only. Missing ids are omitted. Order is unspecified. */
  getByIds(ids: readonly string[]): Promise<MemoryDocument[]>;
}

/**
 * Ranking index (Vectorize). Holds the dense vector plus enough
 * sidecar to filter by `source` and join back to the D1 row.
 */
export interface VectorRecord {
  id: string;
  values: number[];
  source: string;
}

export interface VectorQuery {
  values: number[];
  limit: number;
  source?: string;
}

export interface VectorMatch {
  id: string;
  /** Index metric score (Vectorize cosine is in `[-1, 1]`). */
  score: number;
}

export interface VectorIndex {
  upsert(record: VectorRecord): Promise<void>;
  deleteById(id: string): Promise<void>;
  /** True when the index holds a vector for this id. */
  has(id: string): Promise<boolean>;
  query(input: VectorQuery): Promise<VectorMatch[]>;
}
