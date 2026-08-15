import type {
  Embedder,
  MemoryDocument,
  MemoryStore,
  VectorIndex,
  VectorMatch,
  VectorQuery,
} from "@snaveevans/openbrain-common";

import type { CreateDeps } from "../src/env.js";

export const TEST_MODEL = "test-embedder";
export const FIXED_NOW = new Date("2026-08-14T12:00:00.000Z");
export const FIXED_ID = "00000000-0000-4000-8000-000000000001";
export const SECOND_ID = "00000000-0000-4000-8000-000000000002";

export class MemoryStoreFake implements MemoryStore {
  readonly rows = new Map<string, MemoryDocument>();
  failNextInsert = false;
  failNextGet = false;
  failNextDelete = false;
  failNextGetByIds = false;
  gets = 0;
  inserts = 0;
  deletes = 0;
  getByIdsCalls = 0;

  async insert(document: MemoryDocument): Promise<MemoryDocument> {
    this.inserts += 1;
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("store write failed");
    }
    this.rows.set(document.id, document);
    return document;
  }

  async getById(id: string): Promise<MemoryDocument | null> {
    this.gets += 1;
    if (this.failNextGet) {
      this.failNextGet = false;
      throw new Error("store read failed");
    }
    return this.rows.get(id) ?? null;
  }

  async deleteById(id: string): Promise<MemoryDocument | null> {
    this.deletes += 1;
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("store delete failed");
    }
    const existing = this.rows.get(id) ?? null;
    if (existing) {
      this.rows.delete(id);
    }
    return existing;
  }

  async getByIds(ids: readonly string[]): Promise<MemoryDocument[]> {
    this.getByIdsCalls += 1;
    if (this.failNextGetByIds) {
      this.failNextGetByIds = false;
      throw new Error("store hydrate failed");
    }
    return ids.flatMap((id) => {
      const row = this.rows.get(id);
      return row ? [row] : [];
    });
  }
}

export class EmbedderFake implements Embedder {
  lastText: string | undefined;
  lastRole: "document" | "query" | undefined;
  calls = 0;
  failNext = false;
  emptyNext = false;
  values = [0.1, 0.2, 0.3];

  async embed(text: string, role: "document" | "query") {
    this.calls += 1;
    this.lastText = text;
    this.lastRole = role;
    if (this.failNext) {
      this.failNext = false;
      throw new Error("embed failed");
    }
    if (this.emptyNext) {
      this.emptyNext = false;
      return { values: [], model: TEST_MODEL };
    }
    return { values: this.values, model: TEST_MODEL };
  }
}

export class VectorIndexFake implements VectorIndex {
  readonly records = new Map<
    string,
    { values: number[]; source: string; score?: number }
  >();
  failNextUpsert = false;
  failNextDelete = false;
  failNextQuery = false;
  upserts = 0;
  deletes = 0;
  queries = 0;
  hasCalls = 0;
  lastQuery: VectorQuery | undefined;

  async upsert(record: { id: string; values: number[]; source: string }) {
    this.upserts += 1;
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("index write failed");
    }
    this.records.set(record.id, {
      values: record.values,
      source: record.source,
      score: 0,
    });
  }

  async deleteById(id: string) {
    this.deletes += 1;
    if (this.failNextDelete) {
      this.failNextDelete = false;
      throw new Error("index delete failed");
    }
    this.records.delete(id);
  }

  async has(id: string) {
    this.hasCalls += 1;
    return this.records.has(id);
  }

  async query(input: VectorQuery): Promise<VectorMatch[]> {
    this.queries += 1;
    this.lastQuery = input;
    if (this.failNextQuery) {
      this.failNextQuery = false;
      throw new Error("index query failed");
    }
    return [...this.records.entries()]
      .filter(
        ([, record]) =>
          input.source === undefined || record.source === input.source,
      )
      .map(([id, record]) => ({ id, score: record.score ?? 0 }))
      .sort((left, right) => right.score - left.score)
      .slice(0, input.limit);
  }
}

export function createDeps(overrides: Partial<CreateDeps> = {}): {
  deps: CreateDeps;
  store: MemoryStoreFake;
  embedder: EmbedderFake;
  index: VectorIndexFake;
} {
  const store = new MemoryStoreFake();
  const embedder = new EmbedderFake();
  const index = new VectorIndexFake();
  return {
    store,
    embedder,
    index,
    deps: {
      store,
      embedder,
      index,
      now: () => FIXED_NOW,
      id: () => FIXED_ID,
      ...overrides,
    },
  };
}
