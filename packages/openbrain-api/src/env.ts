import type {
  Embedder,
  MemoryStore,
  VectorIndex,
} from "@snaveevans/openbrain-common";

export type ApiBindings = {
  API_KEY?: string;
  DB?: D1Database;
  VECTORIZE?: VectorizeIndex;
  AI?: Ai;
};

export type CreateDeps = {
  store: MemoryStore;
  embedder: Embedder;
  index: VectorIndex;
  now: () => Date;
  id: () => string;
};

export type AppOptions = {
  create?: CreateDeps;
  store?: MemoryStore;
};
