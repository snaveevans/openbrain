import {
  ERROR_ID_UUID,
  ERROR_MEMORY_NOT_FOUND,
  type FetchMemoryResponse,
  type MemoryStore,
} from "@snaveevans/openbrain-common";

import { ValidationError } from "./errors.js";
import { isUuidV4 } from "./uuid.js";

export function parseMemoryId(id: string): string {
  if (!isUuidV4(id)) {
    throw new ValidationError(ERROR_ID_UUID);
  }
  return id;
}

export async function fetchMemory(
  id: string,
  store: MemoryStore,
): Promise<FetchMemoryResponse> {
  const memory = await store.getById(id);
  if (!memory) {
    throw new LookupError(ERROR_MEMORY_NOT_FOUND);
  }
  return { memory };
}

export class LookupError extends Error {
  readonly status = 404 as const;

  constructor(message: string) {
    super(message);
    this.name = "LookupError";
  }
}
