export type {
  JsonObject,
  Memory,
  MemoryDocument,
  SearchHit,
} from "./memory.js";
export {
  DEFAULT_SEARCH_LIMIT,
  DEFAULT_SOURCE,
  MAX_SEARCH_LIMIT,
  MIN_SEARCH_LIMIT,
} from "./memory.js";

export type {
  CreateMemoryRequest,
  CreateMemoryResponse,
  DeleteMemoryResponse,
  ErrorBody,
  FetchMemoryResponse,
  HealthResponse,
  SearchMemoriesRequest,
  SearchMemoriesResponse,
} from "./http.js";
export { API_KEY_ENV, API_KEY_HEADER, HEALTH_SERVICE } from "./http.js";

export {
  ERROR_API_KEY_NOT_CONFIGURED,
  ERROR_BODY_NOT_OBJECT,
  ERROR_CONTENT_EMPTY,
  ERROR_CONTENT_TOO_LARGE,
  ERROR_ID_UUID,
  ERROR_INVALID_JSON,
  ERROR_MEMORY_NOT_FOUND,
  ERROR_MEMORY_TOO_LARGE,
  ERROR_METADATA_OBJECT,
  ERROR_METHOD_NOT_ALLOWED,
  ERROR_NOT_FOUND,
  ERROR_QUERY_EMPTY,
  ERROR_UNAUTHORIZED,
} from "./messages.js";

export type {
  Embedder,
  EmbedResult,
  EmbedRole,
  MemoryStore,
  VectorIndex,
  VectorMatch,
  VectorQuery,
  VectorRecord,
} from "./ports.js";
