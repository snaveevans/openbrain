import type {
  VectorIndex,
  VectorMatch,
  VectorQuery,
  VectorRecord,
} from "@snaveevans/openbrain-common";

export class VectorizeMemoryIndex implements VectorIndex {
  constructor(private readonly index: VectorizeIndex) {}

  async upsert(record: VectorRecord): Promise<void> {
    await this.index.upsert([
      {
        id: record.id,
        values: record.values,
        metadata: { source: record.source },
      },
    ]);
  }

  async deleteById(id: string): Promise<void> {
    await this.index.deleteByIds([id]);
  }

  async query(input: VectorQuery): Promise<VectorMatch[]> {
    const result = await this.index.query(input.values, {
      topK: input.limit,
      filter: input.source === undefined ? undefined : { source: input.source },
    });
    return result.matches.map((match) => ({
      id: match.id,
      score: match.score,
    }));
  }
}
