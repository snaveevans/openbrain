import {
  ERROR_MEMORY_NOT_FOUND,
  type DeleteMemoryResponse,
  type VectorIndex,
} from "@snaveevans/openbrain-common";

import type { DeleteDeps } from "./env.js";
import { LookupError, parseMemoryId } from "./fetch.js";

export { parseMemoryId };

export type DeleteMemoryResult =
  { kind: "deleted"; body: DeleteMemoryResponse } | { kind: "orphan_cleared" };

export async function deleteMemory(
  id: string,
  deps: DeleteDeps,
): Promise<DeleteMemoryResult> {
  const memory = await deps.store.getById(id);
  if (memory) {
    const removed = await deps.store.deleteById(id);
    if (!removed) {
      throw new Error("Document disappeared before it could be deleted.");
    }
    await deps.index.deleteById(id);
    return { kind: "deleted", body: { memory: removed, deleted: true } };
  }

  if (await deps.index.has(id)) {
    await deps.index.deleteById(id);
    return { kind: "orphan_cleared" };
  }

  throw new LookupError(ERROR_MEMORY_NOT_FOUND);
}

export function productionDeleteDeps(
  store: DeleteDeps["store"],
  index: VectorIndex,
): DeleteDeps {
  return { store, index };
}
