import type {
  Embedder,
  EmbedResult,
  EmbedRole,
} from "@snaveevans/openbrain-common";

/** Workers AI model chosen in ADR-0006. Changing this is a new ADR. */
export const EMBEDDING_MODEL = "@cf/google/embeddinggemma-300m";

/**
 * EmbeddingGemma retrieval prefixes. Workers AI only takes `{ text }`;
 * omitting these is a silent ranking bug, not a 500.
 * @see https://huggingface.co/blog/embeddinggemma
 */
export const DOCUMENT_PREFIX = "title: none | text: ";
export const QUERY_PREFIX = "task: search result | query: ";

export class WorkersAiEmbedder implements Embedder {
  constructor(private readonly ai: Ai) {}

  async embed(text: string, role: EmbedRole): Promise<EmbedResult> {
    const prefixed = `${prefixFor(role)}${text}`;
    const response = await this.ai.run(EMBEDDING_MODEL, { text: prefixed });
    const values = response.data?.[0];
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("Embedding response did not include a vector.");
    }
    return { values, model: EMBEDDING_MODEL };
  }
}

function prefixFor(role: EmbedRole): string {
  return role === "query" ? QUERY_PREFIX : DOCUMENT_PREFIX;
}
