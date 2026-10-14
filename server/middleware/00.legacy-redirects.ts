import type { LegacyRedirectMap } from '../utils/legacy-redirects';
import { resolveLegacyRedirect, validateLegacyRedirectMap } from '../utils/legacy-redirects';
import { isPagePath } from '../utils/is-page-path';

/**
 * Explicit TWO-KEY opt-in, all disabled by default:
 *
 *   LEGACY_REDIRECTS_RUNTIME_ENABLED=1  (runtime switch, NOT set by this PR)
 *   kv legacy:redirects:enabled:<tenantId> === true
 *   kv legacy:redirects:<tenantId> contains a validated generated map
 *
 * Request-hook tenant resolution runs before Nitro server middleware; this
 * filename sorts before 00.locale-market.ts, avoiding 302 -> 301 double hops.
 * No tenant-specific data or Odelco defaults are hardcoded in the application.
 */
type CacheEntry = { value: LegacyRedirectMap | null; expiresAt: number };
const CACHE_MS = 30_000;
const MAX_CACHED_TENANTS = 100;
const mapCache = new Map<string, CacheEntry>();

async function readEnabledTenantMap(tenantId: string): Promise<LegacyRedirectMap | null> {
  const now = Date.now();
  const cached = mapCache.get(tenantId);
  if (cached && cached.expiresAt > now) {
    // Bounded LRU; the disabled state is also cached for 30 seconds.
    mapCache.delete(tenantId);
    mapCache.set(tenantId, cached);
    return cached.value;
  }
  mapCache.delete(tenantId);
  try {
    const kv = useStorage('kv');
    const enabled = await kv.getItem<unknown>(`legacy:redirects:enabled:${tenantId}`);
    let map: LegacyRedirectMap | null = null;
    if (enabled === true) {
      map = validateLegacyRedirectMap(
        await kv.getItem<unknown>(`legacy:redirects:${tenantId}`),
      );
    }
    mapCache.set(tenantId, { value: map, expiresAt: now + CACHE_MS });
    while (mapCache.size > MAX_CACHED_TENANTS) {
      const oldest = mapCache.keys().next().value;
      if (!oldest) break;
      mapCache.delete(oldest);
    }
    return map;
  } catch {
    // Storage unavailable -> current routing continues. Never 500 all pages.
    return null;
  }
}

export default defineEventHandler(async (event) => {
  // Feature must be explicitly enabled in the process environment AND in the
  // tenant's KV. This PR sets neither key; an approved rollout is separate.
  if (process.env.LEGACY_REDIRECTS_RUNTIME_ENABLED !== '1') return;

  const method = event.node.req.method ?? 'GET';
  if (method !== 'GET' && method !== 'HEAD') return;

  const url = event.path || '/';
  const queryStart = url.indexOf('?');
  const path = queryStart < 0 ? url : url.slice(0, queryStart);
  const query = queryStart < 0 ? '' : url.slice(queryStart);

  if (!isPagePath(path) || path === '/' || path.startsWith('//')) return;
  // Modern routes are already localized. Never rewrite canonical storefront URLs.
  if (/^\/[a-z]{2}\/[a-z]{2}(?:\/|$)/.test(path)) return;
  // Do not redirect admin preview URLs using production map data.
  if (query && new URLSearchParams(query.slice(1)).get('preview') === '1') return;

  const tenant = event.context.tenant;
  const tenantId = tenant?.tenantId;
  if (event.context.tenantRefusal || !tenant?.config || !tenantId) return;

  const map = await readEnabledTenantMap(tenantId);
  if (!map) return;

  const target = resolveLegacyRedirect(map, path);
  if (!target || target === path) return;
  // A permanent redirect can only be activated after SEO/merchant approval.
  // Queries are preserved so campaign attribution can survive the migration.
  return sendRedirect(event, target + query, 301);
});
