import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';
import type { LegacyRedirectMap } from '../../../server/utils/legacy-redirects';

const kvGet = vi.fn();
const redirect = vi.fn();
const kv = new Map<string, unknown>();
const originalEnv = process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED;
const map: LegacyRedirectMap = {
  version: 1,
  prefix: '/se/sv',
  exact: {
    '/produkter': '/se/sv/products',
    '/varumarken/actisense': '/se/sv/b/actisense',
  },
  articleNumber: { a3702: '/se/sv/p/maretron-a3702' },
  ancestor: { '/produkter/kontroll': '/se/sv/c/kontroll' },
};

vi.stubGlobal('useStorage', () => ({ getItem: kvGet }));
vi.stubGlobal('sendRedirect', redirect);
vi.stubGlobal('defineEventHandler', (handler: (event: H3Event) => unknown) => handler);

function event(
  path: string,
  opts: { tenantId?: string; method?: string; config?: boolean; refused?: boolean } = {},
): H3Event {
  return {
    path,
    node: { req: { method: opts.method ?? 'GET' } },
    context: {
      tenant: opts.config === false ? { tenantId: opts.tenantId ?? 'alpha' } :
        { tenantId: opts.tenantId ?? 'alpha', config: { tenantId: opts.tenantId ?? 'alpha' } },
      tenantRefusal: opts.refused ? { statusCode: 404 } : undefined,
    },
  } as unknown as H3Event;
}

const enableTenant = (id = 'alpha', input: unknown = map) => {
  kv.set(`legacy:redirects:enabled:${id}`, true);
  kv.set(`legacy:redirects:${id}`, input);
};

async function handler() {
  const module = await import('../../../server/middleware/00.legacy-redirects');
  return module.default;
}

beforeEach(() => {
  vi.resetModules(); // reset module-scope LRU on each case
  vi.clearAllMocks();
  kv.clear();
  kvGet.mockImplementation(async (key: string) => kv.get(key) ?? null);
  redirect.mockReturnValue(undefined);
  Reflect.deleteProperty(process.env, 'LEGACY_REDIRECTS_RUNTIME_ENABLED');
});

afterEach(() => {
  vi.useRealTimers();
  if (originalEnv === undefined) Reflect.deleteProperty(process.env, 'LEGACY_REDIRECTS_RUNTIME_ENABLED');
  else process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = originalEnv;
});

describe('00.legacy-redirects: explicit fail-closed rollout switches', () => {
  it('is disabled by default, making zero KV reads even if map/tenant flags exist', async () => {
    enableTenant();
    await (await handler())(event('/produkter/a3702-info'));
    expect(kvGet).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('requires tenant opt-in in addition to the global runtime switch', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    kv.set('legacy:redirects:alpha', map);
    await (await handler())(event('/produkter/a3702-info'));
    expect(kvGet).toHaveBeenCalledWith('legacy:redirects:enabled:alpha');
    expect(kvGet).not.toHaveBeenCalledWith('legacy:redirects:alpha');
    expect(redirect).not.toHaveBeenCalled();
  });

  it('requires a validated map, never redirecting when absent or corrupt', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    enableTenant('alpha', { ...map, exact: { '/foo': 'https://evil.invalid/' } });
    await (await handler())(event('/produkter/a3702-info'));
    expect(redirect).not.toHaveBeenCalled();
  });

  it('redirects a validated product and brand in ONE permanent hop while preserving query', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    enableTenant();
    const run = await handler();
    const product = event('/produkter/A3702-info?utm_source=legacy');
    await run(product);
    expect(redirect).toHaveBeenCalledWith(product,
      '/se/sv/p/maretron-a3702?utm_source=legacy', 301);
    const brand = event('/varumarken/ACTISENSE?layout=details');
    await run(brand);
    expect(redirect).toHaveBeenCalledWith(brand,
      '/se/sv/b/actisense?layout=details', 301);
  });

  it('skips runtime routes, files, canonical pages and preview URLs before KV access', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    enableTenant();
    const run = await handler();
    for (const path of [
      '/api/orders', '/_nuxt/runtime.js', '/robots.txt', '/sitemap.xml',
      '/se/sv/p/good-product', '/se/sv', '/', '//evil.invalid/path',
      '/produkter/A3702-info?preview=1',
    ]) {
      await run(event(path));
    }
    expect(kvGet).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('never mutates state for POST, and does not answer requests refused by tenant resolution', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    enableTenant();
    const run = await handler();
    await run(event('/produkter/a3702-info', { method: 'POST' }));
    await run(event('/produkter/a3702-info', { config: false }));
    await run(event('/produkter/a3702-info', { refused: true }));
    expect(kvGet).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('isolates tenant maps even on the same hostname/path', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    enableTenant('alpha');
    enableTenant('beta', {
      ...map,
      articleNumber: { a3702: '/se/sv/p/other-tenant-target' },
    });
    const run = await handler();
    const a = event('/produkter/a3702-info', { tenantId: 'alpha' });
    const b = event('/produkter/a3702-info', { tenantId: 'beta' });
    await run(a);
    await run(b);
    expect(redirect).toHaveBeenCalledWith(a, '/se/sv/p/maretron-a3702', 301);
    expect(redirect).toHaveBeenCalledWith(b, '/se/sv/p/other-tenant-target', 301);
  });

  it('skips read errors without emitting 500 or a redirect', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    kvGet.mockRejectedValueOnce(new Error('KV unavailable'));
    await expect((await handler())(event('/produkter/a3702-info'))).resolves.toBeUndefined();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('memoizes KV reads briefly, then picks up a tenant disable after TTL', async () => {
    process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED = '1';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T00:00:00Z'));
    enableTenant();
    const run = await handler();
    await run(event('/produkter/a3702-info'));
    await run(event('/produkter/a3702-info'));
    expect(kvGet).toHaveBeenCalledTimes(2);
    kv.set('legacy:redirects:enabled:alpha', false);
    vi.advanceTimersByTime(30_100);
    redirect.mockClear();
    await run(event('/produkter/a3702-info'));
    expect(redirect).not.toHaveBeenCalled();
    expect(kvGet).toHaveBeenCalledTimes(3);
  });
});
