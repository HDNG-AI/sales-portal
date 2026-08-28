import type { TenantConfig } from '#shared/types/tenant-config';
import {
  createDefaultTheme,
  mergeThemes,
  buildDerivedTheme,
} from './tenant-css';
import {
  tenantIdKey,
  tenantConfigKey,
  collectAllHostnames,
  writeHostnameMappings,
  resolveTenant,
  DEFAULT_GEINS_SETTINGS,
  invalidateTenantCaches,
} from './tenant';
import { withoutUndefined } from './object';

export interface CreateTenantOptions {
  hostname: string;
  tenantId?: string;
  config?: Partial<TenantConfig>;
}

/**
 * Applies a partial update onto a base tenant config: strips explicit
 * `undefined` keys (see withoutUndefined in ./object) before spreading so a
 * caller that omits a field can never blank out an existing/default value,
 * recomputes derived theme/css/themeHash, and pins identity fields so a
 * stray tenantId/hostname in `partial` can't reassign them. This is the
 * only place base+partial tenant configs get merged — every call site
 * (fresh create, existing-tenant update here, and updateTenant below) goes
 * through it so the undefined-stripping can't be forgotten at a future one.
 */
function mergeTenantConfig(
  base: TenantConfig,
  partial: Partial<TenantConfig> | undefined,
  identity: Pick<TenantConfig, 'tenantId' | 'hostname'>,
): TenantConfig {
  const mergedTheme = mergeThemes(base.theme, partial?.theme);
  const { themeWithDerived, css, themeHash } = buildDerivedTheme(mergedTheme);
  const themeChanged = themeHash !== base.themeHash;

  return {
    ...base,
    ...(partial ? withoutUndefined(partial) : {}),
    ...identity,
    theme: themeWithDerived,
    css: themeChanged ? css : base.css,
    themeHash,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Creates or updates a tenant configuration in KV storage.
 */
export async function createTenant(
  options: CreateTenantOptions,
): Promise<TenantConfig> {
  const { hostname, tenantId, config: partialConfig } = options;
  const storage = useStorage('kv');
  const finalTenantId = tenantId || hostname;
  const identity = { tenantId: finalTenantId, hostname };

  const existingConfig = await storage.getItem<TenantConfig>(
    tenantConfigKey(finalTenantId),
  );

  if (existingConfig) {
    if (!partialConfig) return existingConfig;

    const updatedConfig = mergeTenantConfig(
      existingConfig,
      partialConfig,
      identity,
    );
    await storage.setItem(tenantConfigKey(finalTenantId), updatedConfig);
    await writeHostnameMappings(storage, updatedConfig);
    await invalidateTenantCaches(finalTenantId, hostname, useStorage('cache'));
    return updatedConfig;
  }

  const defaultTheme = createDefaultTheme(finalTenantId);
  const defaultThemeDerived = buildDerivedTheme(defaultTheme);

  const baseConfig: TenantConfig = {
    ...identity,
    geinsSettings: { ...DEFAULT_GEINS_SETTINGS },
    mode: 'commerce',
    checkoutMode: 'hosted',
    timezone: 'UTC',
    theme: defaultThemeDerived.themeWithDerived,
    css: defaultThemeDerived.css,
    themeHash: defaultThemeDerived.themeHash,
    branding: { name: finalTenantId, watermark: 'full' },
    features: {
      search: { enabled: true },
      cart: { enabled: true },
    },
    isActive: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const finalConfig = mergeTenantConfig(baseConfig, partialConfig, identity);

  await storage.setItem(tenantConfigKey(finalTenantId), finalConfig);
  await writeHostnameMappings(storage, finalConfig);
  // Clears any negative-cache entry from a lookup that happened before this
  // hostname was onboarded, so it resolves immediately rather than waiting
  // out the 5-minute TTL.
  await invalidateTenantCaches(finalTenantId, hostname, useStorage('cache'));
  return finalConfig;
}

/**
 * Updates an existing tenant configuration
 */
export async function updateTenant(
  hostname: string,
  updates: Partial<TenantConfig>,
  event?: import('h3').H3Event,
): Promise<TenantConfig | null> {
  const storage = useStorage('kv');
  const existing = await resolveTenant(hostname, event);

  if (!existing) {
    return null;
  }

  const tid = existing.tenantId || hostname;
  const updatedConfig = mergeTenantConfig(existing, updates, {
    tenantId: tid,
    hostname: existing.hostname,
  });

  await storage.setItem(tenantConfigKey(tid), updatedConfig);
  await writeHostnameMappings(storage, updatedConfig);
  await invalidateTenantCaches(tid, existing.hostname, useStorage('cache'));
  return updatedConfig;
}

/**
 * Deletes a tenant configuration and all associated hostname mappings.
 */
export async function deleteTenant(hostname: string): Promise<boolean> {
  const storage = useStorage('kv');

  try {
    const tenantId = await storage.getItem<string>(tenantIdKey(hostname));
    const tid = tenantId || hostname;

    const config = await storage.getItem<TenantConfig>(tenantConfigKey(tid));

    if (config) {
      const hostnames = collectAllHostnames(config);
      await Promise.all(
        [...hostnames].map((h) => storage.removeItem(tenantIdKey(h))),
      );
    } else {
      await storage.removeItem(tenantIdKey(hostname));
    }

    await storage.removeItem(tenantConfigKey(tid));
    if (tid !== hostname) {
      await storage.removeItem(tenantConfigKey(hostname));
    }

    await invalidateTenantCaches(tid, hostname, useStorage('cache'));
    return true;
  } catch {
    return false;
  }
}
