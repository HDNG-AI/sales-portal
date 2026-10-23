import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

// ---------------------------------------------------------------------------
// /api/config?preview=1 returns unpublished store settings. Nitro's cached
// handler stamps `s-maxage` on everything it builds, so a preview response
// must never go through it, and must tell shared caches not to store it.
// ---------------------------------------------------------------------------
let query: Record<string, unknown> = {};
let headers: Record<string, string> = {};
const cachedCalls: H3Event[] = [];
const cacheOptions: Record<string, unknown>[] = [];

vi.stubGlobal('getQuery', () => query);
vi.stubGlobal(
  'setResponseHeader',
  (_e: H3Event, name: string, value: string) => {
    headers[name] = value;
  },
);
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal(
  'defineCachedEventHandler',
  (_fn: unknown, opts: Record<string, unknown>) => {
    cacheOptions.push(opts);
    return (event: H3Event) => {
      cachedCalls.push(event);
      return { from: 'cache' };
    };
  },
);
vi.stubGlobal('withErrorHandling', (fn: () => unknown) => fn());
vi.stubGlobal('createError', (e: unknown) => e);

vi.mock('../../server/services/tenant-config', () => ({
  getPublicConfig: vi.fn(async () => ({ from: 'preview' })),
}));
vi.mock('../../server/utils/logger', () => ({
  createTenantLogger: () => ({ debug: () => {} }),
}));
vi.mock('#shared/constants/storage', () => ({
  KV_STORAGE_KEYS: {
    TENANT_CONFIG_PREFIX: 'tenant-config:',
    TENANT_ID_PREFIX: 'tenant-id:',
  },
}));

let handler: (event: H3Event) => unknown;

beforeEach(async () => {
  query = {};
  headers = {};
  cachedCalls.length = 0;
  cacheOptions.length = 0;
  vi.resetModules();
  handler = (await import('../../server/api/config.get')).default as never;
});

const event = () =>
  ({
    context: { tenant: { tenantId: 'acme', hostname: 'acme.localhost' } },
  }) as unknown as H3Event;

describe('/api/config Cache-Control', () => {
  it('sends a preview response as private, no-store and never through the Nitro cache', async () => {
    query = { preview: '1' };
    const body = await handler(event());
    expect(body).toEqual({ from: 'preview' });
    expect(headers['Cache-Control']).toBe('private, no-store');
    expect(cachedCalls).toHaveLength(0);
  });

  it('keeps the live request on the cached path and sets no header of its own', async () => {
    const body = await handler(event());
    expect(body).toEqual({ from: 'cache' });
    expect(cachedCalls).toHaveLength(1);
    expect(headers['Cache-Control']).toBeUndefined();
    expect(cacheOptions[0]).toMatchObject({ swr: true, maxAge: 3600 });
  });

  it('treats other preview values as live', async () => {
    for (const preview of ['0', 'true', '', ['1', '1']]) {
      query = { preview };
      await handler(event());
    }
    expect(cachedCalls).toHaveLength(4);
    expect(headers['Cache-Control']).toBeUndefined();
  });
});
