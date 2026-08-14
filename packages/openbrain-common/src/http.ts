import type { MemoryDocument, SearchHit, JsonObject } from "./memory.js";

export const API_KEY_HEADER = "x-api-key";
export const API_KEY_ENV = "API_KEY";

export const HEALTH_SERVICE = "openbrain";

export interface HealthResponse {
  ok: boolean;
  service: typeof HEALTH_SERVICE;
}

export interface ErrorBody {
  error: string;
}

export interface CreateMemoryRequest {
  content: string;
  source?: string;
  metadata?: JsonObject;
}

export interface CreateMemoryResponse {
  memory: MemoryDocument;
}

export interface FetchMemoryResponse {
  memory: MemoryDocument;
}

export interface DeleteMemoryResponse {
  memory: MemoryDocument;
  deleted: true;
}

export interface SearchMemoriesRequest {
  query: string;
  limit?: number;
  threshold?: number;
  source?: string;
}

export interface SearchMemoriesResponse {
  matches: SearchHit[];
}
