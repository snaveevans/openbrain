-- Memory documents (ADR-0005). Vectors live in Vectorize (ADR-0006).
CREATE TABLE memories (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  source TEXT NOT NULL DEFAULT 'manual',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  embedding_model TEXT,
  embedded_at TEXT
);

CREATE INDEX memories_created_at_idx ON memories (created_at DESC);
CREATE INDEX memories_source_idx ON memories (source);
