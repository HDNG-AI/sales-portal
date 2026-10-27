import type { H3Event } from 'h3';
import { tenantConfigKey } from '../utils/tenant';
import { getPublicConfig } from '../services/tenant-config';
import { createTenantLogger } from '../utils/logger';

/**
 * Computes the Nitro response-cache key for /api/config. The base key uses
 * tenantId (so multiple hostnames for one tenant share a cache entry) and
 * falls back to hostname. Only ?preview=1 bypasses the cache by appending a
 * per-request suffix so every preview render rebuilds against the latest
 * unpublished appSettings. A stale preview cookie must NEVER produce a preview
 * key, otherwise it would poison the shared live cache entry for the tenant.
 */
export function resolveConfigCacheKey(event: H3Event): string {
  const base = tenantConfigKey(
    event.context.tenant.tenantId || event.context.tenant.hostname,
  );
  return getQuery(event).preview === '1'
    ? `${base}:settings-preview:${Date.now()}`
    : base;
}

/**
 * A ?preview=1 request is never read back from the cache: its key carries a
 * per-request timestamp so each preview render rebuilds. Storing it anyway
 * would leave one full tenant config behind per preview render, forever on the
 * in-process cache mount, so preview requests skip the cache entirely, and are
 * marked so that no shared cache downstream keeps them either.
 */
export function shouldBypassConfigCache(event: H3Event): boolean {
  return getQuery(event).preview === '1';
}

/** Builds the public tenant config for the request; shared by the live and preview paths. */
async function loadConfig(event: H3Event) {
  const { hostname } = event.context.tenant;
  const log = createTenantLogger(hostname);

  return withErrorHandling(
    async () => {
      log.debug('Fetching tenant configuration');
      const publicConfig = await getPublicConfig(event);
      if (
        !publicConfig &&
        event.context.tenant.resolution === 'transport-failure'
      ) {
        // Thrown, so nothing is cached and the next request asks again.
        throw createError({
          statusCode: 503,
          statusMessage: 'Service Unavailable',
          message: 'Tenant configuration is temporarily unavailable',
        });
      }
      log.debug('Tenant configuration loaded successfully');

      return publicConfig;
    },
    { tenantId: hostname, operation: 'config.get' },
  );
}

const cachedConfig = defineCachedEventHandler(loadConfig, {
  getKey: (event) => resolveConfigCacheKey(event),
  // Serve a stale cached response while asynchronously revalidating it
  swr: true,
  // Cache for 1 hour
  maxAge: 60 * 60,
});

/**
 * A preview response carries unpublished settings, so no shared cache may
 * keep it. Nitro's cached handler writes `s-maxage` on every response it
 * builds, including one whose cache read was bypassed, so preview requests
 * never go through it: they are built per request and sent as
 * `private, no-store`. Live requests keep the cached path unchanged.
 */
export default defineEventHandler((event) => {
  if (shouldBypassConfigCache(event)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store');
    return loadConfig(event);
  }
  return cachedConfig(event);
});
