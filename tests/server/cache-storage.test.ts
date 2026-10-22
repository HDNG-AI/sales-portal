/**
 * The `cache` mount must evict. Nitro's default for it, unstorage's `memory`
 * driver, never does — the first test pins that, so the reason for the second
 * does not quietly disappear on a dependency bump.
 *
 * Both run the driver Nitro itself resolves (unstorage, through nuxt and
 * nitropack), not a reimplementation, with the options the app mounts.
 */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  CACHE_STORAGE_MAX_BYTES,
  CACHE_STORAGE_MAX_ENTRIES,
  CACHE_STORAGE_MOUNT,
} from '../../server/utils/cache-storage';

interface Driver {
  setItem(key: string, value: unknown): void;
  getItem(key: string): unknown;
  getKeys(): string[];
}

/** unstorage is not a direct dependency; reach it the way Nitro does. */
async function loadDriver(name: string): Promise<(opts?: object) => Driver> {
  const fromRoot = createRequire(import.meta.url);
  const fromNuxt = createRequire(fromRoot.resolve('nuxt/package.json'));
  const fromNitro = createRequire(fromNuxt.resolve('nitropack/package.json'));
  const path = fromNitro.resolve(`unstorage/drivers/${name}`);
  return (await import(pathToFileURL(path).href)).default;
}

/** A Nitro cache entry for one resolved URL, roughly as stored. */
function entry(i: number) {
  return {
    value: { type: 'product', canonicalAppPath: `/se/sv/p/item-${i}` },
    mtime: Date.now(),
    expires: Date.now() + 60_000,
    integrity: 'abc123',
  };
}

describe('cache storage mount', () => {
  it("documents why: Nitro's default memory driver keeps every key", async () => {
    const memory = (await loadDriver('memory'))();
    for (let i = 0; i < CACHE_STORAGE_MAX_ENTRIES + 100; i++) {
      memory.setItem(`nitro:handlers:_:host::/scan/${i}`, entry(i));
    }
    expect(memory.getKeys()).toHaveLength(CACHE_STORAGE_MAX_ENTRIES + 100);
  });

  it('evicts the least recently used entry beyond the entry bound', async () => {
    const { driver, ...options } = CACHE_STORAGE_MOUNT;
    const lru = (await loadDriver(driver))(options);
    for (let i = 0; i < CACHE_STORAGE_MAX_ENTRIES + 100; i++) {
      lru.setItem(`nitro:handlers:_:host::/scan/${i}`, entry(i));
    }
    expect(lru.getKeys()).toHaveLength(CACHE_STORAGE_MAX_ENTRIES);
    expect(lru.getItem('nitro:handlers:_:host::/scan/0')).toBeNull();
    expect(
      lru.getItem(
        `nitro:handlers:_:host::/scan/${CACHE_STORAGE_MAX_ENTRIES + 99}`,
      ),
    ).not.toBeNull();
  });

  it('evicts on serialised size before the entry bound is reached', async () => {
    const { driver, ...options } = CACHE_STORAGE_MOUNT;
    const lru = (await loadDriver(driver))(options);
    const oneMb = { value: 'x'.repeat(1024 * 1024) };
    const fits = Math.floor(CACHE_STORAGE_MAX_BYTES / (1024 * 1024));
    for (let i = 0; i < fits + 10; i++) lru.setItem(`big:${i}`, oneMb);
    expect(lru.getKeys().length).toBeLessThan(fits);
    expect(lru.getKeys().length).toBeLessThan(CACHE_STORAGE_MAX_ENTRIES);
  });
});
