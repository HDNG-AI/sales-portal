/**
 * Local-dev escape hatch: redirects the @geins SDK's hardcoded outbound
 * hosts to a local mock backend, without DNS or TLS tricks.
 *
 * @geins/core|crm|cms|oms hardcode their endpoints
 * (node_modules/@geins/core/dist/constants/endpoints.d.ts):
 *   https://merchantapi.geins.io/graphql
 *   https://merchantapi.geins.io/auth/sign/{API-KEY}
 *   https://auth-service.geins.io/api/{ACCOUNT}_{ENV}
 * and there's no settings field to override them. But every internal call
 * site resolves and invokes the *global* `fetch` at request time (verified
 * against the compiled SDK — it's a bare `fetch(...)` call, never imported
 * or cached into a module-level const), so patching `globalThis.fetch`
 * before the server starts accepting requests intercepts all of them
 * equally, regardless of which SDK method triggered the call.
 *
 * Enable by setting NUXT_MOCK_BACKEND_URL in .env, e.g.:
 *   NUXT_MOCK_BACKEND_URL=http://localhost:4000
 * (the mock-backend project's routes mirror the real paths above 1:1, so
 * this is a pure origin swap — path and query pass through untouched.)
 * Leave it unset to talk to the real Geins backend as normal.
 *
 * Only ever active outside production, and only for the two exact
 * hostnames above — every other fetch call in the app (Sentry, other
 * external APIs, etc.) passes through to the real fetch untouched.
 */

const MOCK_BACKEND_URL = process.env.NUXT_MOCK_BACKEND_URL;
// console.log(`[mock-backend-fetch] MOCK_BACKEND_URL=${MOCK_BACKEND_URL}`);

const REDIRECT_HOSTS = new Set([
  'merchantapi.geins.io',
  'auth-service.geins.io',
]);

export default defineNitroPlugin(() => {
  if (!MOCK_BACKEND_URL || process.env.NODE_ENV === 'production') return;

  const mockOrigin = new URL(MOCK_BACKEND_URL).origin;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : input.toString();

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return originalFetch(input, init);
    }

    if (!REDIRECT_HOSTS.has(parsed.hostname)) {
      return originalFetch(input, init);
    }

    const target = mockOrigin + parsed.pathname + parsed.search;
    console.log(
      `[mock-backend-fetch] ${parsed.hostname}${parsed.pathname} -> ${target}`,
    );

    if (input instanceof Request) {
      return originalFetch(new Request(target, input), init);
    }
    return originalFetch(target, init);
  }) as typeof fetch;

  console.log(
    `[mock-backend-fetch] Redirecting ${[...REDIRECT_HOSTS].join(', ')} -> ${mockOrigin}`,
  );
});
