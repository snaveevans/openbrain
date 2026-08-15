import {
  DEFAULT_SEARCH_LIMIT,
  ERROR_BODY_NOT_OBJECT,
  ERROR_LIMIT_NUMBER,
  ERROR_QUERY_EMPTY,
  ERROR_QUERY_TOO_LARGE,
  ERROR_SOURCE_STRING,
  ERROR_THRESHOLD_RANGE,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
  type SearchHit,
  type SearchMemoriesResponse,
} from "@snaveevans/openbrain-common";

import type { SearchDeps } from "./env.js";
import { ValidationError } from "./errors.js";
import { MAX_EMBED_CONTENT_CHARS } from "./limits.js";

/** Extra Vectorize rows so a later threshold drop can still fill `limit`. */
export const SEARCH_CANDIDATE_LIMIT = 50;

export type SearchMemoryInput = {
  query: string;
  limit: number;
  threshold?: number;
  source?: string;
};

export function publishedSimilarity(score: number): number {
  return Math.min(1, Math.max(0, score));
}

export function parseSearchBody(raw: unknown): SearchMemoryInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError(ERROR_BODY_NOT_OBJECT);
  }

  const body = raw as Record<string, unknown>;
  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    throw new ValidationError(ERROR_QUERY_EMPTY);
  }

  const query = body.query.trim();
  if (query.length > MAX_EMBED_CONTENT_CHARS) {
    throw new ValidationError(ERROR_QUERY_TOO_LARGE);
  }

  const input: SearchMemoryInput = {
    query,
    limit: parseLimit(body.limit),
  };

  if (body.threshold !== undefined) {
    input.threshold = parseThreshold(body.threshold);
  }

  if (body.source !== undefined) {
    input.source = parseSource(body.source);
  }

  return input;
}

export async function searchMemories(
  input: SearchMemoryInput,
  deps: SearchDeps,
): Promise<SearchMemoriesResponse> {
  const embedded = await deps.embedder.embed(input.query, "query");
  if (!Array.isArray(embedded.values) || embedded.values.length === 0) {
    throw new Error("Embedding response did not include a vector.");
  }

  const candidateLimit =
    input.threshold === undefined
      ? input.limit
      : Math.max(input.limit, SEARCH_CANDIDATE_LIMIT);

  const matches = await deps.index.query({
    values: embedded.values,
    limit: candidateLimit,
    source: input.source,
  });

  const ranked = matches
    .map((match) => ({
      id: match.id,
      similarity: publishedSimilarity(match.score),
    }))
    .sort((left, right) => right.similarity - left.similarity);

  const threshold = input.threshold;
  const eligible =
    threshold === undefined
      ? ranked
      : ranked.filter((hit) => hit.similarity >= threshold);

  const documents = await deps.store.getByIds(eligible.map((hit) => hit.id));
  const byId = new Map(documents.map((document) => [document.id, document]));

  const hits: SearchHit[] = [];
  for (const hit of eligible) {
    const document = byId.get(hit.id);
    if (!document) {
      continue;
    }
    hits.push({ ...document, similarity: hit.similarity });
    if (hits.length === input.limit) {
      break;
    }
  }

  return { matches: hits };
}

export function productionSearchDeps(
  store: SearchDeps["store"],
  embedder: SearchDeps["embedder"],
  index: SearchDeps["index"],
): SearchDeps {
  return { store, embedder, index };
}

function parseLimit(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_SEARCH_LIMIT;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(ERROR_LIMIT_NUMBER);
  }
  const truncated = Math.trunc(value);
  if (truncated < MIN_SEARCH_LIMIT) {
    return MIN_SEARCH_LIMIT;
  }
  if (truncated > MAX_SEARCH_LIMIT) {
    return MAX_SEARCH_LIMIT;
  }
  return truncated;
}

function parseThreshold(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    throw new ValidationError(ERROR_THRESHOLD_RANGE);
  }
  return value;
}

function parseSource(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(ERROR_SOURCE_STRING);
  }
  return value;
}
