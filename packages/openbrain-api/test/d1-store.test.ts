import { describe, expect, it } from "vitest";

import { D1MemoryStore } from "../src/d1-store.js";
import { FIXED_ID, FIXED_NOW } from "./fakes.js";

class Statement {
  constructor(
    private readonly db: FakeD1,
    private readonly sql: string,
    private readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]) {
    return new Statement(this.db, this.sql, values);
  }

  async first<T>() {
    const rows = this.select();
    return (rows[0] as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.select() as T[], success: true, meta: {} };
  }

  async run<T>() {
    if (this.sql.startsWith("INSERT")) {
      const [
        id,
        content,
        source,
        metadata,
        created_at,
        updated_at,
        embedding_model,
        embedded_at,
      ] = this.values as [
        string,
        string,
        string,
        string,
        string,
        string,
        string | null,
        string | null,
      ];
      this.db.rows.set(id, {
        id,
        content,
        source,
        metadata,
        created_at,
        updated_at,
        embedding_model,
        embedded_at,
      });
    }
    if (this.sql.startsWith("DELETE")) {
      this.db.rows.delete(String(this.values[0]));
    }
    return { results: [] as T[], success: true, meta: {} };
  }

  private select() {
    if (this.sql.includes("WHERE id = ?")) {
      const row = this.db.rows.get(String(this.values[0]));
      return row ? [row] : [];
    }
    if (this.sql.includes("WHERE id IN")) {
      return this.values.flatMap((id) => {
        const row = this.db.rows.get(String(id));
        return row ? [row] : [];
      });
    }
    return [...this.db.rows.values()];
  }
}

class FakeD1 implements D1Database {
  readonly rows = new Map<string, Record<string, unknown>>();
  prepare(query: string) {
    return new Statement(this, query);
  }
}

describe("D1MemoryStore", () => {
  it("round-trips a document including JSON metadata", async () => {
    const db = new FakeD1();
    const store = new D1MemoryStore(db);
    const document = {
      id: FIXED_ID,
      content: "note",
      source: "cli",
      metadata: { tag: "v1" },
      created_at: FIXED_NOW.toISOString(),
      updated_at: FIXED_NOW.toISOString(),
      embedding_model: "test-embedder",
      embedded_at: FIXED_NOW.toISOString(),
    };
    await store.insert(document);
    await expect(store.getById(FIXED_ID)).resolves.toEqual(document);
    await expect(store.getByIds([FIXED_ID, "missing"])).resolves.toEqual([
      document,
    ]);
    await expect(store.deleteById(FIXED_ID)).resolves.toEqual(document);
    await expect(store.getById(FIXED_ID)).resolves.toBeNull();
  });
});
