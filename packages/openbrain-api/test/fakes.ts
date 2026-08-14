import type {
  Embedder,
  MemoryDocument,
  MemoryStore,
  VectorIndex,
  VectorMatch,
} from "@snaveevans/openbrain-common";

import type { CreateDeps } from "../src/env.js";

export const TEST_MODEL = "test-embedder";
export const FIXED_NOW = new Date("2026-08-14T12:00:00.000Z");
export const FIXED_ID = "00000000-0000-4000-8000-000000000001";

export class MemoryStoreFake implements MemoryStore {
  readonly rows = new Map<string, MemoryDocument>();
  failNextInsert = false;

  async insert(document: MemoryDocument): Promise<MemoryDocument> {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("store write failed");
    }
    this.rows.set(document.id, document);
    return document;
  }

  async getById(id: string): Promise<MemoryDocument | null> {
    return this.rows.get(id) ?? null;
  }

  async deleteById(id: string): Promise<MemoryDocument | null> {
    const existing = this.rows.get(id) ?? null;
    if (existing) {
      this.rows.delete(id);
    }
    return existing;
  }

  async getByIds(ids: readonly string[]): Promise<MemoryDocument[]> {
    return ids.flatMap((id) => {
      const row = this.rows.get(id);
      return row ? [row] : [];
    });
  }
}

export class EmbedderFake implements Embedder {
  lastText: string | undefined;
  lastRole: "document" | "query" | undefined;
  failNext = false;
  values = [0.1, 0.2, 0.3];

  async embed(text: string, role: "document" | "query") {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("embed failed");
    }
    this.lastText = text;
    this.lastRole = role;
    return { values: this.values, model: TEST_MODEL };
  }
}

export class VectorIndexFake implements VectorIndex {
  readonly records = new Map<string, { values: number[]; source: string }>();
  failNextUpsert = false;

  async upsert(record: { id: string; values: number[]; source: string }) {
    if (this.failNextUpsert) {
      this.failNextUpsert = false;
      throw new Error("index write failed");
    }
    this.records.set(record.id, {
      values: record.values,
      source: record.source,
    });
  }

  async deleteById(id: string) {
    this.records.delete(id);
  }

  async query(): Promise<VectorMatch[]> {
    return [];
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
