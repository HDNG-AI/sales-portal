import type {
  TenantConfig,
  CmsConfigUpdate,
} from '#shared/types/tenant-config';
import {
  createDefaultTheme,
  mergeThemes,
  buildDerivedTheme,
} from './tenant-css';
import {
  tenantIdKey,
  tenantConfigKey,
  collectAllHostnames,
  hostnamesToInvalidate,
  writeHostnameMappings,
  resolveTenant,
  DEFAULT_GEINS_SETTINGS,
  invalidateTenantCaches,
  tenantOverrideKey,
  type TenantPortalOverrides,
} from './tenant';
import { withoutUndefined } from './object';
import { KV_STORAGE_KEYS } from '../../shared/constants/storage';

/**
 * Tenant config fields a change to which alters where money, orders or a
 * hostname go — not just how the storefront looks. `geinsSettings.*` is the
 * Geins account (API key, account, channel) every product, cart and order
 * call runs against; `aliases`/`hostname` decide which storefront a domain
 * serves; `checkoutMode`/`mode`/`isActive` switch checkout or the whole
 * storefront on and off.
 */
const CRITICAL_FIELDS = [
  'aliases',
  'checkoutMode',
  'hostname',
  'isActive',
  'mode',
];
const CRITICAL_PREFIXES = ['geinsSettings.'];

/** Bookkeeping fields every write touches; a change to them alone is no change. */
const UNTRACKED_FIELDS = new Set([
  'updatedAt',
  'createdAt',
  'css',
  'themeHash',
]);

/** Fields compared one level deeper, so the audit names the exact setting. */
const NESTED_FIELDS = new Set(['geinsSettings']);

export interface TenantChange {
  created: boolean;
  /** Dotted field names that differ, sorted. Never values. */
  changedFields: string[];
  /** The subset of changedFields listed in CRITICAL_FIELDS/CRITICAL_PREFIXES. */
  criticalFields: string[];
}

function flattenForAudit(config: TenantConfig | null): Map<string, string> {
  const flat = new Map<string, string>();
  if (!config) return flat;
  for (const [key, value] of Object.entries(config)) {
    if (UNTRACKED_FIELDS.has(key) || value === undefined) continue;
    if (NESTED_FIELDS.has(key) && value && typeof value === 'object') {
      for (const [sub, subValue] of Object.entries(value)) {
        flat.set(`${key}.${sub}`, JSON.stringify(subValue));
      }
    } else {
      flat.set(key, JSON.stringify(value));
    }
  }
  return flat;
}

/**
 * Names what an admin write changed, for the audit trail. Values are
 * compared but never returned: `geinsSettings.apiKey` is a credential, and
 * an audit line that echoed it would turn the log into a key store.
 */
export function describeTenantChange(
  previous: TenantConfig | null,
  next: TenantConfig,
): TenantChange {
  const before = flattenForAudit(previous);
  const after = flattenForAudit(next);
  const changedFields = [...new Set([...before.keys(), ...after.keys()])]
    .filter((field) => before.get(field) !== after.get(field))
    .sort();
  const criticalFields = changedFields.filter(
    (field) =>
      CRITICAL_FIELDS.includes(field) ||
      CRITICAL_PREFIXES.some((prefix) => field.startsWith(prefix)),
  );
  return { created: previous === null, changedFields, criticalFields };
}

export function tenantHistoryKeyPrefix(tenantId: string): string {
  return `${KV_STORAGE_KEYS.TENANT_HISTORY_PREFIX}${tenantId}:`;
}

/**
 * Keeps the config an admin write is about to replace, so a bad or
 * malicious change can be put back from KV instead of reconstructed from
 * memory. Same store and same sensitivity as the live config itself.
 */
async function snapshotPreviousConfig(
  storage: ReturnType<typeof useStorage>,
  previous: TenantConfig,
): Promise<void> {
  const stamp = `${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}`;
  await storage.setItem(
    `${tenantHistoryKeyPrefix(previous.tenantId)}${stamp}`,
    previous,
  );
}

/**
 * Refuses a config whose hostnames (primary or alias) already route to a
 * different tenant. writeHostnameMappings deliberately overwrites such a
 * mapping for the merchant-API refresh path, so an admin write must stop
 * here first: otherwise listing another tenant's live domain as an alias
 * silently moves that domain — its storefront, cart and checkout — onto
 * this tenant. Moving a hostname means removing it from its owner first.
 */
async function assertHostnamesUnclaimed(
  storage: ReturnType<typeof useStorage>,
  config: TenantConfig,
): Promise<void> {
  for (const hostname of collectAllHostnames(config)) {
    const owner = await storage.getItem<string>(tenantIdKey(hostname));
    if (owner && owner !== config.tenantId) {
      throw createAppError(
        ErrorCode.CONFLICT,
        `Hostname "${hostname}" already belongs to tenant "${owner}"; remove it there first`,
      );
    }
  }
}

/**
 * A partial tenant update as accepted by createTenant/updateTenant: every
 * field is optional like `Partial<TenantConfig>`, except `cms`, whose
 * update shape additionally allows `null` per slot/menu key to mean
 * "remove this key" — see CmsConfigUpdate.
 */
export type TenantConfigUpdate = Omit<Partial<TenantConfig>, 'cms'> & {
  cms?: CmsConfigUpdate;
};

export interface CreateTenantOptions {
  hostname: string;
  tenantId?: string;
  config?: TenantConfigUpdate;
}

/**
 * Merges a `cms` update onto a base `cms` config, per slot/menu key:
 * a key present in `partial` overwrites that key alone (siblings and the
 * other of slots/menus are untouched), a key set to `null` removes it,
 * and an absent `partial` (or an absent `slots`/`menus` sub-object)
 * leaves the corresponding base entirely unchanged — the same
 * omit-means-untouched contract every other tenant config field gets
 * from mergeTenantConfig, just applied one level deeper since `cms` is
 * itself a keyed map rather than a fixed set of named fields.
 */
export function mergeCmsConfig(
  base: TenantConfig['cms'],
  partial: CmsConfigUpdate | undefined,
): TenantConfig['cms'] {
  if (!partial) return base;

  function mergeMap<T>(
    baseMap: Partial<Record<string, T>> | undefined,
    partialMap: Partial<Record<string, T | null>> | undefined,
  ): Partial<Record<string, T>> | undefined {
    if (!partialMap) return baseMap;
    const result: Partial<Record<string, T>> = { ...baseMap };
    for (const [key, value] of Object.entries(partialMap)) {
      if (value === null) {
        Reflect.deleteProperty(result, key);
      } else if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  const slots = mergeMap(base?.slots, partial.slots);
  const menus = mergeMap(base?.menus, partial.menus);

  if (slots === undefined && menus === undefined) return base;
  return {
    ...(slots !== undefined ? { slots } : {}),
    ...(menus !== undefined ? { menus } : {}),
  };
}

/**
 * Persists portal-owned CMS wiring independently from the disposable
 * effective Geins tenant cache.
 *
 * A Geins config-refresh may delete tenant:config:<id>, but must never
 * delete tenant:override:<id>.
 */
async function persistCmsOverride(
  storage: ReturnType<typeof useStorage>,
  tenantId: string,
  update: CmsConfigUpdate | undefined,
): Promise<void> {
  if (!update) return;

  const key = tenantOverrideKey(tenantId);
  const existing = await storage.getItem<TenantPortalOverrides>(key);

  const cms = mergeCmsConfig(existing?.cms, update);

  await storage.setItem(key, {
    ...(existing ?? {}),
    ...(cms ? { cms } : {}),
  } satisfies TenantPortalOverrides);
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
 *
 * `cms` is carved out of the generic shallow spread and merged separately
 * via mergeCmsConfig — a plain `...partial` would replace the entire `cms`
 * object (both slots AND menus) the moment a caller touches either one,
 * silently dropping every key it didn't mention.
 */
function mergeTenantConfig(
  base: TenantConfig,
  partial: TenantConfigUpdate | undefined,
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
    cms: mergeCmsConfig(base.cms, partial?.cms),
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
  const cacheStorage = useStorage('cache');
  const finalTenantId = tenantId || hostname;
  const identity = { tenantId: finalTenantId, hostname };

  const rawExistingConfig = await storage.getItem<TenantConfig>(
    tenantConfigKey(finalTenantId),
  );
  const existingConfig = rawExistingConfig;

  if (existingConfig) {
    // The request's hostname must already belong to this tenant — a
    // matching tenantId alone isn't proof the caller controls this
    // hostname, since tenantId is a predictable slug, not a secret. This
    // stops a request naming an unrelated hostname from silently
    // retargeting or claiming it for an existing tenant. Adding a new
    // hostname to a tenant is the `aliases` field's job, not this one.
    if (!collectAllHostnames(existingConfig).has(hostname)) {
      throw createAppError(
        ErrorCode.CONFLICT,
        `tenantId "${finalTenantId}" already exists for a different hostname`,
      );
    }
    if (!partialConfig) return existingConfig;

    const updatedConfig = mergeTenantConfig(existingConfig, partialConfig, {
      tenantId: finalTenantId,
      hostname: existingConfig.hostname,
    });
    await assertHostnamesUnclaimed(storage, updatedConfig);
    await snapshotPreviousConfig(storage, existingConfig);
    await storage.setItem(tenantConfigKey(finalTenantId), updatedConfig);
    await persistCmsOverride(storage, finalTenantId, partialConfig.cms);
    // Sequenced, not Promise.all: clearing the negative cache before
    // tenantIdKey(<alias>) is durable leaves a window where a request for
    // that alias still misses KV and writes the negative entry straight
    // back, undoing the invalidation that just ran.
    await writeHostnameMappings(storage, updatedConfig);
    await invalidateTenantCaches(
      finalTenantId,
      hostnamesToInvalidate(hostname, updatedConfig),
      cacheStorage,
    );
    return updatedConfig;
  }

  // theme/css/themeHash are placeholders here — mergeTenantConfig below is
  // the only place that actually derives them (mergeThemes(baseConfig.theme,
  // partialConfig?.theme) followed by buildDerivedTheme), so deriving them
  // again here would just repeat the same 42-color computation, CSS
  // generation, and hash for no reason.
  const baseConfig: TenantConfig = {
    ...identity,
    geinsSettings: { ...DEFAULT_GEINS_SETTINGS },
    mode: 'commerce',
    checkoutMode: 'hosted',
    theme: createDefaultTheme(finalTenantId),
    css: '',
    themeHash: '',
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

  await assertHostnamesUnclaimed(storage, finalConfig);
  await storage.setItem(tenantConfigKey(finalTenantId), finalConfig);
  await persistCmsOverride(storage, finalTenantId, partialConfig?.cms);
  await writeHostnameMappings(storage, finalConfig);
  // Clears any negative-cache entry from a lookup that happened before this
  // hostname was onboarded, so it resolves immediately rather than waiting
  // out the 5-minute TTL. After the mappings, never beside them — see above.
  await invalidateTenantCaches(
    finalTenantId,
    hostnamesToInvalidate(hostname, finalConfig),
    cacheStorage,
  );
  return finalConfig;
}

/**
 * Updates an existing tenant configuration
 */
export async function updateTenant(
  hostname: string,
  updates: TenantConfigUpdate,
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

  await assertHostnamesUnclaimed(storage, updatedConfig);
  await snapshotPreviousConfig(storage, existing);
  await storage.setItem(tenantConfigKey(tid), updatedConfig);
  await persistCmsOverride(storage, tid, updates.cms);
  await writeHostnameMappings(storage, updatedConfig);
  await invalidateTenantCaches(
    tid,
    // The hostname the caller named, not existing.hostname: updatedConfig
    // already carries the canonical one, so passing it again added nothing
    // while dropping the alias a request may have arrived through — which is
    // precisely the entry that survives when that alias is being removed.
    hostnamesToInvalidate(hostname, updatedConfig),
    useStorage('cache'),
  );
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

    await Promise.all([
      storage.removeItem(tenantConfigKey(tid)),
      storage.removeItem(tenantOverrideKey(tid)),
      invalidateTenantCaches(
        tid,
        hostnamesToInvalidate(hostname, config),
        useStorage('cache'),
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}
