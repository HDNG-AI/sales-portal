/**
 * The `cache` storage mount: where Nitro keeps every `defineCachedEventHandler`
 * and `defineCachedFunction` entry (`/api/config`, `/api/resolve-url`, the
 * category tree).
 *
 * Left unconfigured, Nitro puts that mount on unstorage's `memory` driver: a
 * plain `Map` that ignores TTLs. `maxAge` and `staleMaxAge` only decide whether
 * an entry is served or revalidated; nothing ever deletes one. Every distinct
 * key therefore stays in the heap for the life of the process, and
 * `/api/resolve-url` keys on the requested path, so a crawler or path scanner
 * adds one permanent entry per URL it tries.
 *
 * The `lru-cache` driver keeps the same semantics (a miss recomputes, exactly
 * as after a restart) but evicts the least recently used entry once either
 * bound is reached. The bounds sit far above what one process legitimately
 * holds: a handful of tenants times their markets, locales and live URLs.
 */

/** Entries kept before the least recently used is evicted. */
export const CACHE_STORAGE_MAX_ENTRIES = 5000;

/** Serialised bytes kept before the least recently used is evicted. */
export const CACHE_STORAGE_MAX_BYTES = 64 * 1024 * 1024;

export const CACHE_STORAGE_MOUNT = {
  driver: 'lru-cache' as const,
  max: CACHE_STORAGE_MAX_ENTRIES,
  maxSize: CACHE_STORAGE_MAX_BYTES,
};
