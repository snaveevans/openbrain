import type {
  JsonObject,
  MemoryDocument,
  MemoryStore,
} from "@snaveevans/openbrain-common";

type MemoryRow = {
  id: string;
  content: string;
  source: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  embedding_model: string | null;
  embedded_at: string | null;
};

const COLUMNS =
  "id, content, source, metadata, created_at, updated_at, embedding_model, embedded_at";

export class D1MemoryStore implements MemoryStore {
  constructor(private readonly db: D1Database) {}

  async insert(document: MemoryDocument): Promise<MemoryDocument> {
    await this.db
      .prepare(
        `INSERT INTO memories (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        document.id,
        document.content,
        document.source,
        JSON.stringify(document.metadata),
        document.created_at,
        document.updated_at,
        document.embedding_model ?? null,
        document.embedded_at ?? null,
      )
      .run();
    return document;
  }

  async getById(id: string): Promise<MemoryDocument | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM memories WHERE id = ?`)
      .bind(id)
      .first<MemoryRow>();
    return row ? rowToDocument(row) : null;
  }

  async deleteById(id: string): Promise<MemoryDocument | null> {
    const existing = await this.getById(id);
    if (!existing) {
      return null;
    }
    await this.db.prepare(`DELETE FROM memories WHERE id = ?`).bind(id).run();
    return existing;
  }

  async getByIds(ids: readonly string[]): Promise<MemoryDocument[]> {
    if (ids.length === 0) {
      return [];
    }
    const placeholders = ids.map(() => "?").join(", ");
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM memories WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<MemoryRow>();
    return result.results.map(rowToDocument);
  }
}

function rowToDocument(row: MemoryRow): MemoryDocument {
  const document: MemoryDocument = {
    id: row.id,
    content: row.content,
    source: row.source,
    metadata: parseMetadata(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
  if (row.embedding_model) {
    document.embedding_model = row.embedding_model;
  }
  if (row.embedded_at) {
    document.embedded_at = row.embedded_at;
  }
  return document;
}

function parseMetadata(raw: string): JsonObject {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as JsonObject;
    }
  } catch {
    // Corrupt sidecar should not take down fetch; treat as empty.
  }
  return {};
}
