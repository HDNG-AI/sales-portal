// createError is an explicit h3 import, not an auto-import global, matching
// server/error.ts's own choice: it collides with a same-named Nuxt app-side
// composable (nuxt/dist/app/composables/error) — the auto-import resolver
// picks that one over h3's server-side export in some tooling contexts,
// constructing an unthrown app-side error object instead of the real thing.
import { createError } from 'h3';
import { COOKIE_NAMES } from '#shared/constants/storage';
import { resolveLocaleMarket } from '#shared/utils/locale-market';
import { resolveTenant, resolvePreviewTenant } from '../utils/tenant';

/**
 * Normalizes a hostname by removing the port number.
 * This ensures consistent storage keys regardless of the port used.
 */
function normalizeHostname(hostname: string): string {
  // Remove port if present (e.g., "tenant-a.localhost:3000" -> "tenant-a.localhost")
  return hostname.split(':')[0] ?? hostname;
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', async (event) => {
    // Locale-market normalisation lives in `server/middleware/00.locale-market.ts`
    // and runs AFTER plugins. Root `/` requests still flow through here, get
    // a tenant attached, and only later get redirected by the middleware. The
    // headersSent guard stays as a defence-in-depth check for any future
    // plugin that responds early.
    if (event.node.res.headersSent) return;

    // Skip tenant context for health checks and internal endpoints (webhooks)
    const path = event.path || '';
    if (path.startsWith('/api/health') || path.startsWith('/api/internal/')) {
      event.context.tenant = { hostname: '' };
      return;
    }

    // For page routes, a thrown error — or a response sent directly from
    // this plugin's `request` hook — flows through Nitro's HTML renderer
    // (app/error.vue) before route-rules have applied their headers, both
    // of which crash (see server/utils/tenant-error-response.ts's comment).
    // So for page routes this plugin only stashes the failure on
    // event.context.tenantResolutionError; server/middleware/00.locale-market.ts
    // is what actually calls sendTenantErrorPage, since middleware runs
    // after route-rules and after this plugin's i18n-context-registering
    // sibling. API/asset routes are fine with the normal throw; h3
    // serializes it as JSON without touching that renderer.
    const isPageRoute =
      !path.startsWith('/api/') &&
      !path.startsWith('/_nuxt/') &&
      !path.startsWith('/__nuxt');

    // Get the request host for dynamic request routing
    // without considering the `X-Forwarded-Host` header which could be spoofed.
    const rawHostname = getRequestHost(event, { xForwardedHost: false });
    const hostname = normalizeHostname(rawHostname ?? '');

    // Validate hostname is present to prevent empty tenant IDs
    // polluting cache keys and storage
    if (!hostname) {
      if (isPageRoute) {
        event.context.tenantResolutionError = {
          statusCode: 400,
          message: 'Missing host header',
        };
        return;
      }
      throw createError({ statusCode: 400, message: 'Missing host header' });
    }

    // Detect store-settings preview intent. Preview is activated ONLY by the
    // `?preview=1` query and is never inferred from a cookie: a clean top-level
    // visit must always render the live, published theme. CMS preview
    // (PREVIEW_MODE) is a separate flag and is not touched here.
    const isStoreSettingsPreview = getQuery(event).preview === '1';

    // Attach tenant data to the event context to make it
    // available to all server routes and middleware.
    event.context.tenant = { hostname };

    // For page routes, eagerly resolve the tenant and cache the tenantId in a cookie.
    // resolveTenant() returns null for both missing and inactive tenants.
    // Static assets and API routes are excluded.
    if (isPageRoute) {
      const tenant = isStoreSettingsPreview
        ? await resolvePreviewTenant(hostname, event)
        : await resolveTenant(hostname, event);
      if (!tenant) {
        event.context.tenantResolutionError = {
          statusCode: 404,
          message:
            'This site is not available. If you believe this is an error, please contact support.',
        };
        return;
      }

      // Store the real tenantId and full config in context
      const tenantId = tenant.tenantId || hostname;
      event.context.tenant.tenantId = tenantId;
      event.context.tenant.config = tenant;

      // Validate locale/market from plugin 00 against tenant config.
      // Only runs when a locale/market prefix was detected and tenant has geinsSettings.
      const localeMarket = event.context.localeMarket;

      if (localeMarket && tenant.geinsSettings) {
        const { resolved, corrected } = resolveLocaleMarket(localeMarket, {
          availableLocales: tenant.geinsSettings.availableLocales,
          availableMarkets: tenant.geinsSettings.availableMarkets,
          defaultLocale: tenant.geinsSettings.locale,
          defaultMarket: tenant.geinsSettings.market,
        });

        event.context.resolvedLocaleMarket = resolved;

        if (corrected) {
          // Build corrected redirect URL, preserving query string
          const fullPath = event.path || '/';
          const queryIndex = fullPath.indexOf('?');
          const pathOnly =
            queryIndex >= 0 ? fullPath.slice(0, queryIndex) : fullPath;
          const query = queryIndex >= 0 ? fullPath.slice(queryIndex) : '';

          const segments = pathOnly.split('/').filter(Boolean);
          const remainingSegments = segments.slice(2);
          const remainingPath =
            remainingSegments.length > 0
              ? '/' + remainingSegments.join('/')
              : '/';

          // Reset cookies to corrected values
          const cookieOpts = {
            httpOnly: false,
            secure: !import.meta.dev,
            sameSite: 'lax' as const,
            path: '/',
            maxAge: 365 * 24 * 60 * 60,
          };
          setCookie(event, COOKIE_NAMES.LOCALE, resolved.locale, cookieOpts);
          setCookie(event, COOKIE_NAMES.MARKET, resolved.market, cookieOpts);

          const redirectPath =
            remainingPath === '/'
              ? `/${resolved.market}/${resolved.locale}/${query}`
              : `/${resolved.market}/${resolved.locale}${remainingPath}${query}`;

          return sendRedirect(event, redirectPath, 302);
        }
      }

      const cachedTenantId = getTenantCookie(event);

      // Detect tenant switch: clear stale cookies so the locale-market plugin
      // redirects to fresh defaults for the new tenant. A `?preview=1` request
      // must never clear the live visitor's locale/market/cart cookies, so its
      // unpublished overlay can't mutate persistent client state.
      if (
        !isStoreSettingsPreview &&
        cachedTenantId &&
        cachedTenantId !== tenantId
      ) {
        deleteCookie(event, COOKIE_NAMES.LOCALE, { path: '/' });
        deleteCookie(event, COOKIE_NAMES.MARKET, { path: '/' });
        deleteCookie(event, COOKIE_NAMES.CART_ID, { path: '/' });
      }

      // A `?preview=1` request must not persist a tenant cookie, so its
      // unpublished overlay never writes to persistent client state.
      if (
        !isStoreSettingsPreview &&
        (!cachedTenantId || cachedTenantId !== tenantId)
      ) {
        setTenantCookie(event, tenantId);
      }
    } else if (path.startsWith('/api/')) {
      // For API routes, always resolve from hostname (cookie is only a hint, never trusted)
      const tenant = isStoreSettingsPreview
        ? await resolvePreviewTenant(hostname, event)
        : await resolveTenant(hostname, event);
      if (tenant) {
        event.context.tenant.tenantId = tenant.tenantId || hostname;
        event.context.tenant.config = tenant;
      }
    }
  });
});
