/**
 * Minimal Cloudflare binding types used by this Worker.
 * Full wrangler types stay generated and gitignored.
 */

interface KVNamespaceGetOptions {
  cacheTtl?: number;
}

interface KVNamespacePutOptions {
  expirationTtl?: number;
  expiration?: number;
  metadata?: unknown;
}

/**
 * Cloudflare KV namespace. In S1 the hot path uses only `get` (the single
 * stateful read for the BYOK gate); `put`/`delete` are declared for the S2+
 * token-lifecycle paths and operator tooling.
 */
interface KVNamespace {
  get(key: string, options?: KVNamespaceGetOptions): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: KVNamespacePutOptions,
  ): Promise<void>;
  delete(key: string): Promise<void>;
}
