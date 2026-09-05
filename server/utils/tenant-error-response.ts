import { getRequestHeader, setResponseHeader, setResponseStatus } from 'h3';
import { renderErrorHtml } from '../error';

/**
 * Responds directly for a page-route request that has no tenant attached
 * (missing Host header, or no tenant resolves for the hostname), instead
 * of `throw createError(...)`.
 *
 * Why: Nitro's `request` hooks (used by server/plugins/*.ts) run before
 * Nitro applies route-rule response headers (security headers, etc.), and
 * `@nuxtjs/i18n` sets up its own per-request context via its own `request`
 * hook too. Sending a response — or throwing — from within a plugin's
 * `request` hook either aborts that sequential hook chain before i18n's
 * hook runs (crashing `app/error.vue`'s `useI18n()` when Nuxt tries to
 * render the thrown error — "Nuxt I18n server context has not been set up
 * yet.") or gets the response flushed before route-rules can attach their
 * headers to it ("Cannot set headers after they are sent to the client").
 * `server/middleware/00.locale-market.ts` sidesteps the exact same class
 * of problem for `sendRedirect` by living in `server/middleware/` (h3
 * middleware, which runs after route-rules have already applied their
 * headers) rather than `server/plugins/` — this function must only ever
 * be called from that same middleware layer, never from a Nitro plugin's
 * `request` hook. server/plugins/02.tenant-context.ts detects the failure
 * and stashes it on `event.context.tenantResolutionError`; this middleware
 * layer is what actually calls this function.
 */
export function sendTenantErrorPage(
  event: import('h3').H3Event,
  statusCode: number,
  message: string,
) {
  const hostname = event.context.tenant?.hostname;
  setResponseStatus(event, statusCode);
  // Matches server/error.ts's own header-setting — support/App Insights
  // look up requests by these headers, not just by the response body.
  if (event.context.correlationId) {
    setResponseHeader(event, 'x-correlation-id', event.context.correlationId);
  }
  const accept = getRequestHeader(event, 'accept') ?? '';
  if (accept.includes('text/html')) {
    setResponseHeader(event, 'content-type', 'text/html; charset=utf-8');
    return send(
      event,
      renderErrorHtml({
        statusCode,
        statusMessage: statusCode === 404 ? 'Not Found' : 'Bad Request',
        message,
        correlationId: event.context.correlationId,
        tenantId: undefined,
        hostname,
        isTenantNotProvisioned: statusCode === 404,
      }),
      'text/html',
    );
  }
  setResponseHeader(event, 'content-type', 'application/json');
  return send(
    event,
    JSON.stringify({
      error: true,
      statusCode,
      statusMessage: statusCode === 404 ? 'Not Found' : 'Bad Request',
      message,
      path: event.path,
      ...(event.context.correlationId
        ? { correlationId: event.context.correlationId }
        : {}),
      ...(hostname ? { hostname } : {}),
    }),
    'application/json',
  );
}
