import type {
  Memory,
  MemoryDocument,
  SearchHit,
} from "@snaveevans/openbrain-common";

/**
 * Agent-facing memory-model text rendering (memory-model.md). A stable
 * agent-facing format, not an internal dump:
 *
 * ```
 * id: <uuid>
 * source: <source>
 * created_at: <timestamp>
 * updated_at: <timestamp>
 * embedded_at: <timestamp>
 * embedding_model: <model>
 * similarity: <0.0000>        # search hits only, four decimals
 * metadata: <json>
 *
 * <content>
 * ```
 *
 * Ranked search lists number hits from `1` and separate them with a line
 * containing only `---`. The block ends with `<content>` (no trailing newline).
 */

/** One memory block. `includeSimilarity` adds the search-only line. */
export function renderMemoryBlock(
  memory: Memory,
  includeSimilarity: boolean,
): string {
  const lines: string[] = [
    `id: ${memory.id}`,
    `source: ${memory.source}`,
    `created_at: ${memory.created_at}`,
    `updated_at: ${memory.updated_at}`,
    `embedded_at: ${memory.embedded_at}`,
    `embedding_model: ${memory.embedding_model}`,
  ];
  if (includeSimilarity) {
    lines.push(`similarity: ${(memory.similarity ?? 0).toFixed(4)}`);
  }
  lines.push(`metadata: ${JSON.stringify(memory.metadata)}`);
  lines.push("");
  lines.push(memory.content);
  return lines.join("\n");
}

/** `fetch` / `create_memory` success: one block, no `similarity`. */
export function renderSingle(memory: MemoryDocument): string {
  return renderMemoryBlock(memory, false);
}

/** `delete_memory` success: `Memory <id> was deleted.` + blank line + block. */
export function renderDeleted(memory: MemoryDocument): string {
  return `Memory ${memory.id} was deleted.\n\n${renderMemoryBlock(memory, false)}`;
}

/** `fetch` / `delete_memory` REST 404: absence is data, not a tool failure. */
export function renderNotFound(id: string): string {
  return `Memory ${id} was not found.`;
}

/**
 * `search_memories` success. Zero hits → `No memories matched "<query>".`.
 * Non-empty → hits numbered from `1`, each a memory-model block (with
 * `similarity` to four decimals), separated by a line containing only `---`.
 */
export function renderSearch(matches: SearchHit[], query: string): string {
  if (matches.length === 0) {
    return `No memories matched "${query}".`;
  }
  return matches
    .map((hit, index) => `${index + 1}.\n${renderMemoryBlock(hit, true)}`)
    .join("\n---\n");
}
