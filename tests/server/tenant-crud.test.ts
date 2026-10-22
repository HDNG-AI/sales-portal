import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TenantConfig } from '#shared/types/tenant-config';
import partialPayloadFixture from '../fixtures/store-settings/partial-payload.json';
import { createDefaultTheme } from '../../server/utils/tenant-css';

import {
  createTenant,
  updateTenant,
  deleteTenant,
  mergeCmsConfig,
  setTenantOperatingTimezone,
  setTenantProductTextPlacement,
} from '../../server/utils/tenant-crud';
import {
  tenantConfigKey,
  tenantIdKey,
  resolveTenant,
  tenantRefreshStateKey,
  tenantOverrideKey,
  TENANT_REMOTE_REFRESH_MS,
  isTenantRefreshFresh,
  hostnamesToInvalidate,
  DEFAULT_GEINS_SETTINGS,
  mergeTenantPortalOverrides,
  resolvePreviewTenant,
} from '../../server/utils/tenant';

// Use the REAL createAppError / ErrorCode so the ownership-check test below
// verifies the actual thrown error shape, not a mock's.
const errorsModule = await import('../../server/utils/errors');
vi.stubGlobal('createAppError', errorsModule.createAppError);
vi.stubGlobal('ErrorCode', errorsModule.ErrorCode);

const {
  mockUseStorage,
  mockClearSdkCache,
  mockUseRuntimeConfig,
  kvStore,
  cacheStore,
} = vi.hoisted(() => {
  function createStatefulStorage(store: Map<string, unknown>) {
    return {
      getItem: vi.fn(async (key: string) =>
        store.has(key) ? store.get(key) : null,
      ),
      setItem: vi.fn(async (key: string, value: unknown) => {
        store.set(key, value);
      }),
      removeItem: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };
  }

  const kvStore = new Map<string, unknown>();
  const cacheStore = new Map<string, unknown>();
  const kvStorage = createStatefulStorage(kvStore);
  const cacheStorage = createStatefulStorage(cacheStore);

  return {
    mockUseStorage: vi.fn((namespace: string) =>
      namespace === 'cache' ? cacheStorage : kvStorage,
    ),
    mockClearSdkCache: vi.fn(),
    mockUseRuntimeConfig: vi.fn(() => ({
      geins: { tenantApiUrl: 'https://merchant.example/api/tenant' },
    })),
    kvStore,
    cacheStore,
  };
});

vi.stubGlobal('useStorage', mockUseStorage);
// resolveTenant() falls back to fetchTenantConfig() on a KV miss, which
// calls useRuntimeConfig(event) to read the merchant API URL before it ever
// reaches its own try/catch — needed even for tests that expect the fetch
// itself to fail, not just ones that expect it to succeed. Unlike
// useStorage (a true undefined global in this test tier), useRuntimeConfig
// resolves through a real `nuxt/app` import, so it needs mocking at the
// module level rather than vi.stubGlobal.
vi.mock('#imports', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRuntimeConfig: mockUseRuntimeConfig };
});
vi.mock('#app/nuxt', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, useRuntimeConfig: mockUseRuntimeConfig };
});
vi.mock('nitropack/runtime/internal/config', async (importOriginal) => {
  const actual = (await importOriginal().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { ...actual, useRuntimeConfig: mockUseRuntimeConfig };
});
vi.mock('../../server/services/_sdk', () => ({
  clearSdkCache: mockClearSdkCache,
}));
vi.mock('../../server/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const GEINS_SETTINGS = {
  apiKey: 'key-1',
  accountName: 'acct',
  channel: '1',
  tld: 'se',
  locale: 'sv-SE',
  market: 'se',
  environment: 'production' as const,
  availableLocales: ['sv-SE'],
  availableMarkets: ['se'],
};

beforeEach(() => {
  // Preview tests use vi.unstubAllGlobals() to restore fetch. That also
  // removes this suite's global Nuxt storage/error shims; reinstall them
  // for each subsequent test to prevent order-dependent failures.
  vi.stubGlobal('useStorage', mockUseStorage);
  vi.stubGlobal('createAppError', errorsModule.createAppError);
  vi.stubGlobal('ErrorCode', errorsModule.ErrorCode);
  kvStore.clear();
  cacheStore.clear();
  // mockUseStorage.mockClear() only clears calls to useStorage() itself —
  // the getItem/setItem/removeItem spies on the objects it returns are
  // separate vi.fn()s that survive across tests unless cleared too.
  vi.clearAllMocks();
});

describe('createTenant', () => {
  it('creates a fresh tenant with sane defaults when no config is given', async () => {
    const tenant = await createTenant({ hostname: 'a.example.com' });

    expect(tenant.tenantId).toBe('a.example.com');
    expect(tenant.mode).toBe('commerce');
    expect(tenant.checkoutMode).toBe('hosted');
    expect(tenant.branding).toEqual({
      name: 'a.example.com',
      watermark: 'full',
    });
    expect(tenant.geinsSettings).toEqual(DEFAULT_GEINS_SETTINGS);
    expect(tenant.isActive).toBe(false);
    // No zone is substituted on create — see
    // docs/adr/024-tenant-operating-timezone.md for why not 'UTC'.
    expect(tenant.timezone).toBeUndefined();
    expect(kvStore.get(tenantConfigKey('a.example.com'))).toEqual(tenant);
  });

  it('leaves timezone unset on a stored config from before the field existed', async () => {
    // Simulate a KV record written before `timezone` was added to
    // TenantConfig — a raw storage read wouldn't re-run schema defaults.
    // Absent stays absent: a substituted zone would re-date existing orders.
    const legacy = {
      tenantId: 'legacy-tenant',
      hostname: 'legacy.example.com',
      geinsSettings: DEFAULT_GEINS_SETTINGS,
      mode: 'commerce',
      checkoutMode: 'hosted',
      theme: {},
      branding: { name: 'Legacy', watermark: 'full' },
      features: {},
      isActive: true,
      createdAt: '2020-01-01T00:00:00.000Z',
      updatedAt: '2020-01-01T00:00:00.000Z',
    };
    kvStore.set(tenantConfigKey('legacy-tenant'), legacy);

    const tenant = await createTenant({
      hostname: 'legacy.example.com',
      tenantId: 'legacy-tenant',
    });

    expect(tenant.timezone).toBeUndefined();
  });

  it('applies partial config over the defaults on fresh create', async () => {
    const tenant = await createTenant({
      hostname: 'boattools.example.com',
      tenantId: 'boattools',
      config: {
        isActive: true,
        branding: { name: 'Boat Tools', watermark: 'none' },
        geinsSettings: {
          ...GEINS_SETTINGS,
          imageBaseUrl: 'https://cdn.example.com',
        },
        timezone: 'Europe/Stockholm',
      },
    });

    expect(tenant.tenantId).toBe('boattools');
    expect(tenant.isActive).toBe(true);
    expect(tenant.branding).toEqual({ name: 'Boat Tools', watermark: 'none' });
    expect(tenant.geinsSettings.imageBaseUrl).toBe('https://cdn.example.com');
    expect(tenant.timezone).toBe('Europe/Stockholm');
  });

  it('does not leak theme-internal keys (colors, radius, typography) onto the top-level config', async () => {
    // mergeThemes() returns a full theme object shaped { name, displayName,
    // colors, radius, typography } — none of those are TenantConfig's own
    // top-level keys (theme.colors lives under `theme`, not the config
    // root). Spreading that theme object directly into the returned
    // TenantConfig would pollute it with keys that don't belong there.
    const tenant = await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: {
        theme: { name: 'custom', colors: { primary: 'oklch(0.5 0.1 200)' } },
        geinsSettings: GEINS_SETTINGS,
      },
    });

    expect(tenant).not.toHaveProperty('colors');
    expect(tenant).not.toHaveProperty('radius');
    expect(tenant).not.toHaveProperty('typography');
    expect(tenant).not.toHaveProperty('displayName');
    // theme.name is legitimate; a top-level `name` is not.
    expect(tenant).not.toHaveProperty('name');
    expect(tenant.theme.name).toBe('custom');
  });

  it('maps every alias hostname to the tenant, alongside the primary hostname', async () => {
    await createTenant({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      config: {
        isActive: true,
        aliases: ['boattools.localhost'],
        geinsSettings: GEINS_SETTINGS,
      },
    });

    expect(kvStore.get(tenantIdKey('www.boattools.store'))).toBe('boattools');
    expect(kvStore.get(tenantIdKey('boattools.localhost'))).toBe('boattools');
  });

  it("rejects a hostname that is not already one of the existing tenant's hostnames", async () => {
    await createTenant({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      config: { isActive: true, geinsSettings: GEINS_SETTINGS },
    });

    await expect(
      createTenant({
        hostname: 'attacker-controlled.example',
        tenantId: 'boattools',
        config: { branding: { name: 'Hijacked', watermark: 'none' } },
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('allows a request whose hostname is an existing alias, not just the primary', async () => {
    await createTenant({
      hostname: 'www.boattools.store',
      tenantId: 'boattools',
      config: {
        isActive: true,
        aliases: ['boattools.localhost'],
        geinsSettings: GEINS_SETTINGS,
      },
    });

    const updated = await createTenant({
      hostname: 'boattools.localhost',
      tenantId: 'boattools',
      config: { branding: { name: 'Renamed', watermark: 'none' } },
    });

    expect(updated.branding).toEqual({ name: 'Renamed', watermark: 'none' });
  });

  it('preserves fields the update omits instead of blanking them (regression: undefined-spread clobber)', async () => {
    await createTenant({
      hostname: 'boattools.example.com',
      tenantId: 'boattools',
      config: {
        isActive: true,
        branding: { name: 'Boat Tools', watermark: 'none' },
        mode: 'commerce',
        checkoutMode: 'hosted',
        geinsSettings: GEINS_SETTINGS,
      },
    });

    // Second call omits branding/mode/checkoutMode entirely — as
    // tenants.post.ts does when the caller's request body doesn't include
    // them, producing `{ branding: undefined, mode: undefined, ... }`.
    const updated = await createTenant({
      hostname: 'boattools.example.com',
      tenantId: 'boattools',
      config: {
        isActive: true,
        branding: undefined,
        mode: undefined,
        checkoutMode: undefined,
        geinsSettings: {
          ...GEINS_SETTINGS,
          imageBaseUrl: 'https://cdn.example.com',
        },
      },
    });

    expect(updated.branding).toEqual({ name: 'Boat Tools', watermark: 'none' });
    expect(updated.mode).toBe('commerce');
    expect(updated.checkoutMode).toBe('hosted');
    expect(updated.geinsSettings.imageBaseUrl).toBe('https://cdn.example.com');
  });

  it('is a true no-op when called for an existing tenant with no config', async () => {
    const created = await createTenant({
      hostname: 'a.example.com',
      config: { geinsSettings: GEINS_SETTINGS },
    });
    const kvStorage = mockUseStorage('kv');
    kvStorage.setItem.mockClear();

    const result = await createTenant({ hostname: 'a.example.com' });

    expect(result).toEqual(created);
    expect(kvStorage.setItem).not.toHaveBeenCalled();
  });

  it('invalidates SDK, negative, and response caches on every write', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: { geinsSettings: GEINS_SETTINGS },
    });

    expect(mockClearSdkCache).toHaveBeenCalledWith('a-tenant');
    const escaped = tenantConfigKey('a-tenant').replace(/\W/g, '');
    expect(cacheStore.has(`nitro/handlers:_:${escaped}.json`)).toBe(false);
    // removeItem was called (deleting a key that was never set is a no-op,
    // so absence from the store *is* the assertion — confirm the call too).
    const cacheStorage = mockUseStorage('cache');
    expect(cacheStorage.removeItem).toHaveBeenCalledWith(
      `nitro/handlers:_:${escaped}.json`,
    );
  });

  it('actually clears a stale cached /api/config response on update', async () => {
    await createTenant({
      hostname: 'boattools.example.com',
      tenantId: 'boattools',
      config: { geinsSettings: GEINS_SETTINGS },
    });

    const escaped = tenantConfigKey('boattools').replace(/\W/g, '');
    const nitroCacheKey = `nitro/handlers:_:${escaped}.json`;
    cacheStore.set(nitroCacheKey, { stale: true });

    await createTenant({
      hostname: 'boattools.example.com',
      tenantId: 'boattools',
      config: {
        geinsSettings: {
          ...GEINS_SETTINGS,
          imageBaseUrl: 'https://cdn.example.com',
        },
      },
    });

    expect(cacheStore.has(nitroCacheKey)).toBe(false);
  });
});

describe('updateTenant', () => {
  it('returns null when the hostname does not resolve to a tenant', async () => {
    const stub = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network in test'));

    const result = await updateTenant('unknown.example.com', {
      branding: { name: 'X', watermark: 'full' },
    });

    expect(result).toBeNull();
    stub.mockRestore();
  });

  it('merges updates onto the resolved tenant and invalidates its caches', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: {
        // isActive: true — resolveTenant()/getTenantById() only resolve
        // active tenants (see the isActive comment in tenants.post.ts).
        isActive: true,
        branding: { name: 'Original', watermark: 'full' },
        geinsSettings: GEINS_SETTINGS,
      },
    });
    mockClearSdkCache.mockClear();

    const updated = await updateTenant('a.example.com', {
      branding: { name: 'Renamed', watermark: 'none' },
    });

    expect(updated?.branding).toEqual({ name: 'Renamed', watermark: 'none' });
    // geinsSettings wasn't part of this update — must survive untouched.
    expect(updated?.geinsSettings).toEqual(GEINS_SETTINGS);
    expect(mockClearSdkCache).toHaveBeenCalledWith('a-tenant');
  });

  it('updating one cms slot through the real update path does not wipe sibling slots or menus', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: {
        isActive: true,
        geinsSettings: GEINS_SETTINGS,
        cms: {
          slots: {
            frontpage_content: { family: 'Frontpage', areaName: 'Content' },
            product_detail: { family: 'Product', areaName: 'Below Details' },
          },
          menus: { header_main: { menuLocationId: 'main' } },
        },
      },
    });

    const updated = await updateTenant('a.example.com', {
      cms: {
        slots: {
          frontpage_content: {
            family: 'Frontpage',
            areaName: 'The front page area',
          },
        },
      },
    });

    expect(updated?.cms?.slots).toEqual({
      frontpage_content: {
        family: 'Frontpage',
        areaName: 'The front page area',
      },
      product_detail: { family: 'Product', areaName: 'Below Details' },
    });
    // menus wasn't part of this update — must survive untouched, same as
    // geinsSettings does for the plain-field case above.
    expect(updated?.cms?.menus).toEqual({
      header_main: { menuLocationId: 'main' },
    });
  });

  it('setting a cms slot to null through the real update path removes just that key', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: {
        isActive: true,
        geinsSettings: GEINS_SETTINGS,
        cms: {
          slots: {
            frontpage_content: { family: 'Frontpage', areaName: 'Content' },
            product_detail: { family: 'Product', areaName: 'Below Details' },
          },
        },
      },
    });

    const updated = await updateTenant('a.example.com', {
      cms: { slots: { product_detail: null } },
    });

    expect(updated?.cms?.slots).toEqual({
      frontpage_content: { family: 'Frontpage', areaName: 'Content' },
    });
  });
});

describe('mergeCmsConfig', () => {
  it('returns undefined when neither base nor partial has a cms config', () => {
    expect(mergeCmsConfig(undefined, undefined)).toBeUndefined();
  });

  it('returns base unchanged when partial is undefined', () => {
    const base = {
      slots: { frontpage_content: { family: 'F', areaName: 'A' } },
    };
    expect(mergeCmsConfig(base, undefined)).toBe(base);
  });

  it('creates a slots map from nothing when base is undefined', () => {
    const result = mergeCmsConfig(undefined, {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    });
    expect(result).toEqual({
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    });
  });

  it('adds a new key without touching existing keys', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    };
    const result = mergeCmsConfig(base, {
      slots: {
        product_detail: { family: 'Product', areaName: 'Below Details' },
      },
    });
    expect(result?.slots).toEqual({
      frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      product_detail: { family: 'Product', areaName: 'Below Details' },
    });
  });

  it('overwrites an existing key without touching others', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
        product_detail: { family: 'Product', areaName: 'Below Details' },
      },
    };
    const result = mergeCmsConfig(base, {
      slots: {
        frontpage_content: {
          family: 'Frontpage',
          areaName: 'The front page area',
        },
      },
    });
    expect(result?.slots).toEqual({
      frontpage_content: {
        family: 'Frontpage',
        areaName: 'The front page area',
      },
      product_detail: { family: 'Product', areaName: 'Below Details' },
    });
  });

  it('removes a key when its update value is null, leaving siblings intact', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
        product_detail: { family: 'Product', areaName: 'Below Details' },
      },
    };
    const result = mergeCmsConfig(base, { slots: { product_detail: null } });
    expect(result?.slots).toEqual({
      frontpage_content: { family: 'Frontpage', areaName: 'Content' },
    });
  });

  it('deleting a key that was never present is a no-op, not an error', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    };
    const result = mergeCmsConfig(base, { slots: { product_detail: null } });
    expect(result?.slots).toEqual({
      frontpage_content: { family: 'Frontpage', areaName: 'Content' },
    });
  });

  it('an empty slots object in partial changes nothing', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    };
    const result = mergeCmsConfig(base, { slots: {} });
    expect(result?.slots).toEqual(base.slots);
  });

  it('updating slots leaves menus untouched, and vice versa', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
      menus: { header_main: { menuLocationId: 'main' } },
    };
    const slotsUpdated = mergeCmsConfig(base, {
      slots: {
        product_detail: { family: 'Product', areaName: 'Below Details' },
      },
    });
    expect(slotsUpdated?.menus).toEqual(base.menus);

    const menusUpdated = mergeCmsConfig(base, {
      menus: { footer: { menuLocationId: 'footer-1' } },
    });
    expect(menusUpdated?.slots).toEqual(base.slots);
  });

  it('handles add, overwrite, and delete together in one call', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
        product_list_top: { family: 'Productlist', areaName: 'Above List' },
        product_detail: { family: 'Product', areaName: 'Below Details' },
      },
    };
    const result = mergeCmsConfig(base, {
      slots: {
        // overwrite
        frontpage_content: {
          family: 'Frontpage',
          areaName: 'The front page area',
        },
        // delete
        product_list_top: null,
        // add
        product_list_bottom: {
          family: 'Productlist',
          areaName: 'The bottom part of the product list',
        },
      },
    });
    expect(result?.slots).toEqual({
      frontpage_content: {
        family: 'Frontpage',
        areaName: 'The front page area',
      },
      product_detail: { family: 'Product', areaName: 'Below Details' },
      product_list_bottom: {
        family: 'Productlist',
        areaName: 'The bottom part of the product list',
      },
    });
  });

  it('deleting every key leaves an empty slots object, not undefined', () => {
    const base = {
      slots: {
        frontpage_content: { family: 'Frontpage', areaName: 'Content' },
      },
    };
    const result = mergeCmsConfig(base, { slots: { frontpage_content: null } });
    expect(result?.slots).toEqual({});
  });
});

describe('deleteTenant', () => {
  it('removes the tenant config and its hostname mappings', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: { geinsSettings: GEINS_SETTINGS },
    });

    const ok = await deleteTenant('a.example.com');

    expect(ok).toBe(true);
    expect(kvStore.has(tenantConfigKey('a-tenant'))).toBe(false);
    expect(kvStore.has(tenantIdKey('a.example.com'))).toBe(false);
  });

  it('invalidates caches for the deleted tenant', async () => {
    await createTenant({
      hostname: 'a.example.com',
      tenantId: 'a-tenant',
      config: { geinsSettings: GEINS_SETTINGS },
    });
    mockClearSdkCache.mockClear();

    await deleteTenant('a.example.com');

    expect(mockClearSdkCache).toHaveBeenCalledWith('a-tenant');
  });
});

// These assert the negative cache's actual state, not a call to
// clearNegativeCache. The cache is a module-level Map inside
// server/utils/tenant.ts, and invalidateTenantCaches clears it from inside
// that same module — a spy on the export would never see the call, so a test
// written that way passes whether or not the hostnames are cleared. Driving
// resolveTenant before and after is the only way to observe it.
describe('negative cache invalidation across aliases', () => {
  const PRIMARY = 'primary.example.com';
  const ALIAS = 'alias.example.com';

  /** Puts `hostname` in the negative cache by resolving it while unknown. */
  async function negativeCache(hostname: string) {
    const miss = await resolveTenant(hostname);
    expect(miss, `${hostname} should not resolve yet`).toBeNull();
  }

  beforeEach(() => {
    // Every KV miss falls through to the merchant API; a 404 is what puts the
    // hostname in the negative cache in the first place.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('not found', { status: 404 })),
    );
  });

  it('clears the negative cache for an alias when the tenant is created', async () => {
    await negativeCache(ALIAS);

    await createTenant({
      hostname: PRIMARY,
      tenantId: 'aliased',
      config: {
        isActive: true,
        aliases: [ALIAS],
        geinsSettings: GEINS_SETTINGS,
      },
    });

    // Without the alias in the invalidation set this stays null for the rest
    // of the negative-cache TTL, with the fresh config already in KV.
    const resolved = await resolveTenant(ALIAS);
    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe('aliased');
  });

  it('clears the negative cache for an alias added by updateTenant', async () => {
    await createTenant({
      hostname: PRIMARY,
      tenantId: 'aliased',
      config: { isActive: true, geinsSettings: GEINS_SETTINGS },
    });
    await negativeCache(ALIAS);

    await updateTenant(PRIMARY, { aliases: [ALIAS] });

    const resolved = await resolveTenant(ALIAS);
    expect(resolved).not.toBeNull();
    expect(resolved?.tenantId).toBe('aliased');
  });
});

describe('hostnamesToInvalidate', () => {
  const config = {
    hostname: 'primary.example.com',
    aliases: ['alias-one.example.com', 'alias-two.example.com'],
  } as TenantConfig;

  it('unions the config hostnames with the one the caller named', () => {
    expect([...hostnamesToInvalidate('primary.example.com', config)]).toEqual(
      expect.arrayContaining([
        'primary.example.com',
        'alias-one.example.com',
        'alias-two.example.com',
      ]),
    );
  });

  it('keeps a named hostname the config no longer claims', () => {
    // The whole reason the named hostname is a separate argument. An alias
    // being removed is the one holding a stale entry, and it is gone from the
    // config by the time the write completes.
    expect(hostnamesToInvalidate('removed.example.com', config)).toContain(
      'removed.example.com',
    );
  });

  it('falls back to the named hostname alone when there is no config', () => {
    expect([...hostnamesToInvalidate('only.example.com', null)]).toEqual([
      'only.example.com',
    ]);
  });
});

describe('write ordering', () => {
  it('publishes hostname mappings before clearing the negative cache', async () => {
    // Clearing first leaves a window: a request for the alias arriving before
    // tenantIdKey(<alias>) is durable misses KV and writes the negative entry
    // straight back, undoing the invalidation. invocationCallOrder is a global
    // counter across all vi.fn()s, so it orders calls on different mocks.
    const kv = mockUseStorage('kv') as unknown as {
      setItem: { mock: { calls: unknown[][]; invocationCallOrder: number[] } };
    };
    const cache = mockUseStorage('cache') as unknown as {
      removeItem: { mock: { invocationCallOrder: number[] } };
    };

    await createTenant({
      hostname: 'ordered.example.com',
      tenantId: 'ordered',
      config: {
        isActive: true,
        aliases: ['ordered-alias.example.com'],
        geinsSettings: GEINS_SETTINGS,
      },
    });

    const mappingWrites = kv.setItem.mock.calls
      .map((call, i) => ({
        key: call[0] as string,
        order: kv.setItem.mock.invocationCallOrder[i]!,
      }))
      .filter(({ key }) => key.startsWith('tenant:id:'));
    const lastMappingWrite = Math.max(...mappingWrites.map((w) => w.order));
    const firstInvalidation = Math.min(
      ...cache.removeItem.mock.invocationCallOrder,
    );

    expect(mappingWrites.length).toBeGreaterThan(0);
    expect(lastMappingWrite).toBeLessThan(firstInvalidation);
  });
});

describe('Geins Store Settings freshness (missed Studio webhook)', () => {
  const hostname = 'staging-odelco.example.com';
  const tenantId = 'odelco';

  function remotePayload() {
    return {
      ...partialPayloadFixture,
      tenantId,
      geinsSettings: {
        ...partialPayloadFixture.geinsSettings,
        defaultHostName: hostname,
      },
      appSettings: {
        ...partialPayloadFixture.appSettings,
        theme: {
          ...partialPayloadFixture.appSettings.theme,
          typography: {
            ...partialPayloadFixture.appSettings.theme.typography,
            fontFamily: 'Geist',
          },
        },
      },
    };
  }

  async function seedCachedInter(source: 'remote' | 'local' = 'remote') {
    await createTenant({
      hostname,
      tenantId,
      config: {
        isActive: true,
        geinsSettings: GEINS_SETTINGS,
        theme: {
          ...createDefaultTheme(tenantId),
          typography: { fontFamily: 'Inter', headingFontFamily: 'Roboto Slab' },
        },
      },
    });
    kvStore.set(tenantRefreshStateKey(tenantId), {
      source,
      checkedAt: Date.now() - TENANT_REMOTE_REFRESH_MS - 1,
    });
  }

  it('re-fetches an expired published theme and busts the /api/config cache', async () => {
    await seedCachedInter();
    cacheStore.set('nitro/handlers:_:tenantconfigodelco.json', { old: true });
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(remotePayload()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);

    const result = await resolveTenant(hostname);

    expect(result?.theme.typography?.fontFamily).toBe('Geist');
    expect(result?.timezone).toBe('Europe/Stockholm');
    expect(kvStore.get(tenantConfigKey(tenantId))).toMatchObject({
      timezone: 'Europe/Stockholm',
      theme: { typography: { fontFamily: 'Geist' } },
    });
    expect(cacheStore.has('nitro/handlers:_:tenantconfigodelco.json')).toBe(false);
    expect(mockClearSdkCache).toHaveBeenCalledWith(tenantId);
    expect(kvStore.get(tenantRefreshStateKey(tenantId))).toMatchObject({
      source: 'remote',
    });

    // Repeat requests within the freshness window should not hit Geins again.
    await resolveTenant(hostname);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('serves last known good config on transient Geins transport failure', async () => {
    await seedCachedInter();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

    const result = await resolveTenant(hostname);

    expect(result?.theme.typography?.fontFamily).toBe('Inter');
    expect(kvStore.get(tenantRefreshStateKey(tenantId))).toMatchObject({
      source: 'remote',
    });
  });

  it('does not overwrite a locally administered tenant with Geins data', async () => {
    await seedCachedInter('local');
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(remotePayload()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);

    const result = await resolveTenant(hostname);

    expect(result?.theme.typography?.fontFamily).toBe('Inter');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed when a previously remote tenant disappears from Geins', async () => {
    await seedCachedInter();
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ));

    expect(await resolveTenant(hostname)).toBeNull();
  });

  it('treats a legacy, unstamped cached tenant as requiring a provenance check', () => {
    expect(isTenantRefreshFresh(null)).toBe(false);
    expect(isTenantRefreshFresh({
      checkedAt: Date.now() - TENANT_REMOTE_REFRESH_MS - 1,
      source: 'remote',
    })).toBe(false);
    expect(isTenantRefreshFresh({
      checkedAt: Date.now(),
      source: 'remote',
    })).toBe(true);
    expect(isTenantRefreshFresh({
      checkedAt: 0,
      source: 'local',
    })).toBe(true);
  });
});

describe('approved Odelco operating timezone', () => {
  it('uses Europe/Stockholm even when Geins omits timezone or previously sent UTC', () => {
    const base = {
      tenantId: 'odelco',
      hostname: 'staging-odelco.hdng.ai',
      aliases: ['odelco.litium.store'],
      timezone: 'UTC',
      theme: { typography: { fontFamily: 'Inter' } },
      cms: {
        menus: { header_main: { menuLocationId: 'main-desktop' } },
      },
    } as TenantConfig;

    const actual = mergeTenantPortalOverrides(base, undefined);
    expect(actual.timezone).toBe('Europe/Stockholm');
    expect(actual.hostname).toBe(base.hostname);
    expect(actual.aliases).toBe(base.aliases);
    expect(actual.theme).toBe(base.theme);
    expect(actual.cms).toBe(base.cms);
    expect(base.timezone).toBe('UTC'); // No mutation of Geins data
  });

  it('preserves CMS per-key overrides while protecting the approved timezone', () => {
    const base = {
      tenantId: 'odelco',
      hostname: 'staging-odelco.hdng.ai',
      cms: {
        slots: { frontpage_content: { family: 'Frontpage', areaName: 'Content' } },
        menus: { header_main: { menuLocationId: 'main' } },
      },
    } as TenantConfig;
    const result = mergeTenantPortalOverrides(base, {
      cms: { menus: { header_main: { menuLocationId: 'main-desktop' } } },
    });
    expect(result.timezone).toBe('Europe/Stockholm');
    expect(result.cms?.slots).toEqual(base.cms?.slots);
    expect(result.cms?.menus?.header_main).toEqual({ menuLocationId: 'main-desktop' });
  });

  it('does not assign a timezone to any other tenant', () => {
    const base = {
      tenantId: 'another-merchant',
      hostname: 'another.example',
      timezone: undefined,
    } as TenantConfig;
    expect(mergeTenantPortalOverrides(base, null)).toBe(base);
    expect(mergeTenantPortalOverrides({ ...base, timezone: 'UTC' }, undefined).timezone).toBe('UTC');
  });

  it('applies the same approved timezone to the Geins preview lookup without writing KV', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({
        ...partialPayloadFixture,
        tenantId: 'odelco',
        geinsSettings: {
          ...partialPayloadFixture.geinsSettings,
          defaultHostName: 'staging-odelco.example.com',
        },
        appSettings: partialPayloadFixture.appSettings,
      }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      const result = await resolvePreviewTenant('staging-odelco.example.com');
      expect(result?.timezone).toBe('Europe/Stockholm');
      expect(fetcher).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('persistent operating timezone overrides', () => {
  const hostname = 'staging-odelco.example.com';
  const tenantId = 'odelco';

  function merchantData(zone?: string) {
    return {
      ...partialPayloadFixture,
      tenantId,
      geinsSettings: {
        ...partialPayloadFixture.geinsSettings,
        defaultHostName: hostname,
        additionalHostNames: ['odelco-alias.example.com'],
      },
      appSettings: {
        ...partialPayloadFixture.appSettings,
        ...(zone ? { timezone: zone } : {}),
      },
    };
  }

  async function seedRemotelyManagedTenant() {
    await createTenant({
      hostname,
      tenantId,
      config: {
        isActive: true,
        aliases: ['odelco-alias.example.com'],
        geinsSettings: GEINS_SETTINGS,
        theme: {
          ...createDefaultTheme(tenantId),
          typography: { fontFamily: 'Inter' },
        },
      },
    });
    kvStore.set(tenantRefreshStateKey(tenantId), {
      checkedAt: Date.now(),
      source: 'remote',
    });
  }

  it('stores an administrator timezone independently of the disposable tenant config', async () => {
    await seedRemotelyManagedTenant();
    kvStore.set(tenantOverrideKey(tenantId), {
      cms: { menus: { header_main: { menuLocationId: 'main-desktop' } } },
    });
    cacheStore.set('nitro/handlers:_:tenantconfigodelco.json', { old: true });

    const saved = await setTenantOperatingTimezone(
      'odelco-alias.example.com',
      'Europe/Stockholm',
    );
    expect(saved).toEqual({ tenantId, timezone: 'Europe/Stockholm' });
    expect(kvStore.get(tenantOverrideKey(tenantId))).toEqual({
      timezone: 'Europe/Stockholm',
      cms: { menus: { header_main: { menuLocationId: 'main-desktop' } } },
    });
    // Crucial: only expiry changes; do NOT convert remote -> local.
    expect(kvStore.get(tenantRefreshStateKey(tenantId))).toMatchObject({
      source: 'remote',
      checkedAt: 0,
    });
    expect(cacheStore.has('nitro/handlers:_:tenantconfigodelco.json')).toBe(false);
    expect(kvStore.get(tenantConfigKey(tenantId))).toMatchObject({
      theme: { typography: { fontFamily: 'Inter' } },
    });
  });

  it('re-fetches after the admin write and preserves both Studio theme and portal timezone', async () => {
    await seedRemotelyManagedTenant();
    await setTenantOperatingTimezone(hostname, 'Europe/Stockholm');
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(merchantData()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      const updated = await resolveTenant(hostname);
      expect(updated?.timezone).toBe('Europe/Stockholm');
      expect(updated?.hostname).toBe(hostname);
      expect(updated?.aliases).toContain('odelco-alias.example.com');
      expect(kvStore.get(tenantRefreshStateKey(tenantId))).toMatchObject({
        source: 'remote',
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(kvStore.get(tenantOverrideKey(tenantId))).toMatchObject({
        timezone: 'Europe/Stockholm',
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('gives an explicit non-UTC Geins timezone priority over a saved portal timezone', () => {
    const base = {
      tenantId,
      timezone: 'Europe/London',
    } as TenantConfig;
    expect(mergeTenantPortalOverrides(base, {
      timezone: 'Europe/Stockholm',
    }).timezone).toBe('Europe/London');
    expect(mergeTenantPortalOverrides(base, undefined).timezone).toBe('Europe/London');
    expect(mergeTenantPortalOverrides({
      ...base,
      timezone: 'UTC',
    }, { timezone: 'Europe/Stockholm' }).timezone).toBe('Europe/Stockholm');
    expect(mergeTenantPortalOverrides({
      ...base,
      timezone: undefined,
    }, { timezone: 'Europe/Stockholm' }).timezone).toBe('Europe/Stockholm');
  });

  it('ignores an invalid persisted timezone and retains safe legacy fallback', () => {
    const base = { tenantId, timezone: undefined } as TenantConfig;
    expect(mergeTenantPortalOverrides(base, {
      timezone: '+02:00',
    }).timezone).toBe('Europe/Stockholm');
    const other = { ...base, tenantId: 'other-merchant' };
    expect(mergeTenantPortalOverrides(other, {
      timezone: '+02:00',
    })).toBe(other);
  });

  it('allows local-only tenants to update without touching other settings', async () => {
    await createTenant({
      hostname: 'independent.example.com',
      tenantId: 'independent',
      config: { isActive: true, geinsSettings: GEINS_SETTINGS },
    });
    const result = await setTenantOperatingTimezone(
      'independent.example.com',
      'Europe/Oslo',
    );
    expect(result?.timezone).toBe('Europe/Oslo');
    expect(kvStore.get(tenantConfigKey('independent'))).toMatchObject({
      timezone: 'Europe/Oslo',
      tenantId: 'independent',
    });
    expect(kvStore.get(tenantRefreshStateKey('independent'))).toMatchObject({
      source: 'local',
    });
  });

  it('persists timezone through the existing tenant onboarding/update utility', async () => {
    await createTenant({
      hostname: 'operator.example.com',
      tenantId: 'operator',
      config: {
        isActive: true,
        geinsSettings: GEINS_SETTINGS,
        timezone: 'Europe/Stockholm',
      },
    });
    expect(kvStore.get(tenantOverrideKey('operator'))).toEqual({
      timezone: 'Europe/Stockholm',
    });
    await updateTenant('operator.example.com', {
      cms: { menus: { header_main: { menuLocationId: 'main-desktop' } } },
    });
    expect(kvStore.get(tenantOverrideKey('operator'))).toMatchObject({
      timezone: 'Europe/Stockholm',
      cms: { menus: { header_main: { menuLocationId: 'main-desktop' } } },
    });
  });

  it('reads the same saved portal timezone for preview without writing to KV', async () => {
    kvStore.set(tenantOverrideKey(tenantId), { timezone: 'Europe/Oslo' });
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(merchantData()), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetcher);
    try {
      const kv = mockUseStorage('kv');
      kv.setItem.mockClear();
      const config = await resolvePreviewTenant(hostname);
      expect(config?.timezone).toBe('Europe/Oslo');
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(kv.setItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not persist an invalid timezone or alter tenant configuration', async () => {
    await seedRemotelyManagedTenant();
    await expect(setTenantOperatingTimezone(hostname, 'GMT+2')).rejects.toThrow();
    expect(kvStore.has(tenantOverrideKey(tenantId))).toBe(false);
    expect(kvStore.get(tenantRefreshStateKey(tenantId))).toMatchObject({
      source: 'remote',
    });
  });
});

describe('portal-owned product text placement (Odelco Victron)', () => {
  it('overrides semantic placement without losing other tenant layout settings', () => {
    const base = {
      tenantId: 'odelco',
      layout: { vatDisplay: 'ex', productTextPlacement: 'legacy' },
      timezone: 'Europe/Stockholm',
    } as TenantConfig;
    const overridden = mergeTenantPortalOverrides(base, {
      layout: { productTextPlacement: 'semantic' },
    });
    expect(overridden.layout).toMatchObject({
      vatDisplay: 'ex',
      productTextPlacement: 'semantic',
    });
    expect(base.layout?.productTextPlacement).toBe('legacy');
    expect(mergeTenantPortalOverrides(base, null).layout?.productTextPlacement).toBe('legacy');
  });

  it('ignores malformed saved KV opt-ins, keeping the legacy mode', () => {
    const base = {
      tenantId: 'odelco',
      layout: { productTextPlacement: 'legacy' },
      timezone: 'Europe/Stockholm',
    } as TenantConfig;
    expect(mergeTenantPortalOverrides(base, {
      layout: { productTextPlacement: 'bogus' as 'semantic' },
    }).layout?.productTextPlacement).toBe('legacy');
  });

  it('persists the admin opt-in separately for a remote Geins tenant', async () => {
    await createTenant({
      hostname: 'staging-odelco.example.com',
      tenantId: 'odelco',
      config: { isActive: true, geinsSettings: GEINS_SETTINGS },
    });
    kvStore.set(tenantRefreshStateKey('odelco'), {
      checkedAt: Date.now(),
      source: 'remote',
    });
    kvStore.set(tenantOverrideKey('odelco'), {
      timezone: 'Europe/Stockholm',
      cms: { menus: { header_main: { menuLocationId: 'primary' } } },
    });

    const result = await setTenantProductTextPlacement(
      'staging-odelco.example.com',
      'semantic',
    );
    expect(result).toEqual({
      tenantId: 'odelco',
      productTextPlacement: 'semantic',
    });
    expect(kvStore.get(tenantOverrideKey('odelco'))).toEqual({
      timezone: 'Europe/Stockholm',
      cms: { menus: { header_main: { menuLocationId: 'primary' } } },
      layout: { productTextPlacement: 'semantic' },
    });
    expect(kvStore.get(tenantRefreshStateKey('odelco'))).toMatchObject({
      source: 'remote', checkedAt: 0,
    });
    const merged = mergeTenantPortalOverrides(
      kvStore.get(tenantConfigKey('odelco')) as TenantConfig,
      kvStore.get(tenantOverrideKey('odelco')) as never,
    );
    expect(merged.layout?.productTextPlacement).toBe('semantic');
    expect(merged.timezone).toBe('Europe/Stockholm');

    await setTenantProductTextPlacement('staging-odelco.example.com', 'legacy');
    expect(kvStore.get(tenantOverrideKey('odelco'))).toMatchObject({
      layout: { productTextPlacement: 'legacy' },
    });
  });

  it('rejects invalid placement values without a KV write', async () => {
    await createTenant({
      hostname: 'staging-odelco.example.com',
      tenantId: 'odelco',
      config: { isActive: true, geinsSettings: GEINS_SETTINGS },
    });
    await expect(setTenantProductTextPlacement(
      'staging-odelco.example.com',
      'unsupported' as 'semantic',
    )).rejects.toThrow();
    expect(kvStore.has(tenantOverrideKey('odelco'))).toBe(false);
  });
});
