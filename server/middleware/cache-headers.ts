import { stripLocaleMarketPrefix } from '#shared/utils/locale-market';
import { getPreviewCookie } from '../utils/cookies';
import { hasUserToken } from '../utils/request-identity';

/**
 * Pages whose response depends on the caller's session: their route
 * middleware redirects on auth or cart state, or the HTML carries per-user
 * data. Matched after the /{market}/{locale} prefix, on the path and every
 * sub-path.
 */
const SESSION_PAGES = [
  '/cart',
  '/checkout',
  '/login',
  '/account',
  '/portal',
  '/order-confirmation',
  '/quote-confirmation',
];

function isSessionPage(path: string): boolean {
  const bare = stripLocaleMarketPrefix(path.split('?')[0]!).replace(/\/+$/, '');
  return SESSION_PAGES.some(
    (page) => bare === page || bare.startsWith(`${page}/`),
  );
}

/**
 * CDN-ready cache headers for page routes: per-host via Vary, stale for 10min
 * while revalidating. See ADR-010.
 *
 * Preview requests must never be cached at the CDN. Their HTML is rendered
 * against unpublished overlays that would otherwise leak to every other
 * visitor sharing the host. Store-settings preview is driven purely by
 * ?preview=1 (never a cookie); CMS preview still uses the preview_mode cookie.
 *
 * Session-dependent responses are never shared either. `Vary: host` does not
 * separate callers on one host, so a signed-in request (B2B prices, company
 * data) and every response of a session page are private. That includes the
 * anonymous redirect: a shared copy of `/checkout -> /` would be replayed to
 * signed-in buyers too.
 */
export default defineEventHandler((event) => {
  const path = event.path || '';

  if (
    path.startsWith('/api/') ||
    path.startsWith('/_nuxt/') ||
    path.startsWith('/__nuxt')
  ) {
    return;
  }

  const query = getQuery(event);
  const isPreview = query.preview === '1' || getPreviewCookie(event);

  if (isPreview || hasUserToken(event) || isSessionPage(path)) {
    setHeader(event, 'Cache-Control', 'private, no-store');
    return;
  }

  setHeader(event, 'Vary', 'host, accept-encoding');
  setHeader(
    event,
    'Cache-Control',
    'public, s-maxage=60, stale-while-revalidate=600',
  );
});
