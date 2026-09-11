// https://nuxt.com/docs/api/configuration/nuxt-config
import type { Environment } from './shared/types/common';
import type { NuxtPage } from 'nuxt/schema';

/**
 * Resolves the 'kv' storage mount (tenant configs, webhook dedup — see
 * server/utils/tenant.ts, server/utils/webhook-handler.ts) from raw
 * process.env. This runs once when nitro.config is built, not per-request,
 * so it must read process.env directly — useRuntimeConfig() only exists
 * inside the running server, not at config-build time.
 *
 * Fails fast on misconfiguration rather than silently falling back to
 * memory: an unset NUXT_STORAGE_DRIVER in production would otherwise look
 * identical to a working deployment right up until the next restart wipes
 * every admin-onboarded tenant.
 */
function resolveKvStorageMount() {
  const driver = process.env.NUXT_STORAGE_DRIVER || 'memory';

  if (driver === 'memory') {
    return { driver: 'memory' as const };
  }

  if (driver === 'redis') {
    const url = process.env.NUXT_STORAGE_REDIS_URL;
    if (!url) {
      throw new Error(
        'NUXT_STORAGE_DRIVER=redis but NUXT_STORAGE_REDIS_URL is not set. ' +
          'Refusing to silently fall back to in-memory storage in this mode — ' +
          'set the URL or unset NUXT_STORAGE_DRIVER.',
      );
    }
    // Nitro resolves storage drivers by name internally (unstorage is its
    // own dependency, not this app's) — pass the shape it expects rather
    // than importing and pre-instantiating the driver ourselves.
    return { driver: 'redis' as const, url, base: 'kv' };
  }

  throw new Error(
    `Unknown NUXT_STORAGE_DRIVER: "${driver}". Expected "memory" or "redis".`,
  );
}

/**
 * Recursively create /:market/:locale-prefixed copies of page routes.
 * Each prefixed route uses the same component file but with the market/locale
 * segments as route params, so Vue Router matches /se/sv/search natively.
 */
function createPrefixedRoutes(pages: NuxtPage[], depth = 0): NuxtPage[] {
  const result: NuxtPage[] = [];

  for (const page of pages) {
    const prefixedPath =
      depth === 0
        ? `/:market/:locale${page.path === '/' ? '' : page.path}`
        : page.path;

    const prefixed: NuxtPage = {
      ...page,
      name: depth === 0 ? `locale-${page.name ?? ''}` : page.name,
      path: prefixedPath,
      children: page.children?.length
        ? createPrefixedRoutes(page.children, depth + 1)
        : page.children,
    };

    result.push(prefixed);
  }

  return result;
}

export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  // Nuxt's core builder watcher (pages/components/composables auto-scan) —
  // separate from vite.server.watch and nitro.watchOptions below — was the
  // one actually driving EMFILE: it holds a handle per node_modules entry
  // it walks (thousands, via pnpm's symlink-heavy layout), independent of
  // process ulimit. All three watch.ignore/ignore configs are needed since
  // each covers a distinct watcher instance.
  ignore: ['**/node_modules/**', '**/.git/**'],
  // Off when E2E=1: the DevTools frame intercepts taps at phone viewports.
  devtools: { enabled: !process.env.E2E },

  hooks: {
    'pages:extend'(pages) {
      // Register /:market/:locale-prefixed versions of all page routes.
      // This allows named pages (search.vue, checkout.vue, index.vue, etc.)
      // to be reached via /se/sv/search, /se/sv/checkout, /se/sv/ etc.
      // Without this, only the [...slug] catch-all works with prefixed URLs.
      // See: server/middleware/00.locale-market.ts for URL parsing.
      const prefixed = createPrefixedRoutes(pages);
      pages.push(...prefixed);
    },
  },

  modules: [
    // Always needed (aliases, auto-imports, component resolution)
    '~~/modules/graphql-loader',
    '@nuxt/eslint',
    '@nuxt/icon',
    '@nuxt/image',
    '@nuxtjs/tailwindcss',
    '@nuxtjs/i18n',
    '@nuxtjs/seo',
    '@nuxt/test-utils',
    'shadcn-nuxt',
    '@pinia/nuxt',

    // Runtime-only modules (skip during tests — no aliases or auto-imports needed)
    ...(!process.env.VITEST
      ? [
          '@sentry/nuxt/module',
          'nuxt-security',
          '@nuxt/fonts',
          '@nuxt/scripts',
          // Skipped when E2E=1: its vue-tracer overlay is another such layer.
          ...(process.env.E2E ? [] : ['@nuxt/hints']),
        ]
      : []),
  ],

  security: {
    // Nonce-based CSP requires a single SSR pass so header and tag nonces
    // match. Vite dev mode renders in multiple passes, producing different
    // nonces that the browser rejects. Enable nonce + SRI only in prod.
    nonce: process.env.NODE_ENV === 'production',
    sri: process.env.NODE_ENV === 'production',
    headers: {
      // Strict CSP for production only. In dev, nuxt-security still sets
      // other security headers (X-Content-Type-Options, etc.) but CSP is
      // disabled to avoid blocking scripts/styles via nonce mismatches.
      contentSecurityPolicy:
        process.env.NODE_ENV === 'production'
          ? {
              'default-src': ["'none'"],
              'script-src': ["'self'", "'strict-dynamic'", "'nonce-{{nonce}}'"],
              // Inline styles are allowed wholesale. Vue, radix-vue, and the
              // tenant theme block all emit inline styles (element and
              // attribute) whose values are dynamic, so a nonce or hash
              // allowlist can never cover them: a nonce on an SSR <style> does
              // not propagate to client-injected styles, and positioning /
              // transition style attributes change at runtime. Anything short
              // of 'unsafe-inline' silently breaks styling in WebKit/Safari,
              // which enforces this directive far more strictly than Chromium.
              // The meaningful protection — blocking injected scripts — is kept
              // by the strict nonce-based script-src below; CSS injection is a
              // low risk once script execution is locked down.
              'style-src': [
                "'self'",
                "'unsafe-inline'",
                'https://fonts.googleapis.com',
              ],
              'font-src': ["'self'", 'https://fonts.gstatic.com'],
              'img-src': ["'self'", 'data:', 'https:'],
              'connect-src': [
                "'self'",
                'https://merchantapi.geins.io',
                'https://*.sentry.io',
                'https://www.google-analytics.com',
                'https://www.googletagmanager.com',
              ],
              'frame-ancestors': [
                "'self'",
                'https://*.geins.io',
                'https://*.litium.io',
              ],
              'frame-src': ["'self'"],
              'base-uri': ["'none'"],
              'form-action': ["'self'"],
              'object-src': ["'none'"],
              'script-src-attr': ["'none'"],
              'manifest-src': ["'self'"],
              'worker-src': ["'self'"],
              'upgrade-insecure-requests': true,
            }
          : false,
      xContentTypeOptions: 'nosniff',
      xFrameOptions: false,
      referrerPolicy: 'strict-origin-when-cross-origin',
      crossOriginEmbedderPolicy: false,
    },
    rateLimiter: false,
    requestSizeLimiter: false,
    xssValidator: false,
    corsHandler: false,
  },

  fonts: {
    families: [
      { name: 'Geist', provider: 'fontsource', weights: [400, 500, 600, 700] },
      { name: 'Hanuman', provider: 'google', weights: [400, 700] },
    ],
  },

  image: {
    domains: ['commerce.services'],
  },

  i18n: {
    restructureDir: 'app',
    defaultLocale: 'sv',
    locales: [
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
      { code: 'sv', language: 'sv-SE', name: 'Svenska', file: 'sv.json' },
      { code: 'nb', language: 'nb-NO', name: 'Norsk', file: 'nb.json' },
      { code: 'fi', language: 'fi-FI', name: 'Suomi', file: 'fi.json' },
      { code: 'da', language: 'da-DK', name: 'Dansk', file: 'da.json' },
    ],
    langDir: 'locales',
    strategy: 'no_prefix',
    detectBrowserLanguage: false,
  },

  // @nuxtjs/seo configuration — per-tenant values set at request time
  // by server/plugins/03.seo-config.ts via the site-config:init hook
  site: {
    // Placeholder — overridden per-request by server/plugins/03.seo-config.ts
    url: 'https://portal.litium.com',
    name: 'Sales Portal',
  },
  robots: { enabled: true },
  sitemap: {
    enabled: true,
    sources: ['/api/__sitemap__/urls'],
  },
  schemaOrg: { enabled: true },
  ogImage: { enabled: false },
  linkChecker: { enabled: false },

  // Sentry build-time configuration for source maps (optional)
  // If SENTRY_AUTH_TOKEN is not set, source maps won't be uploaded
  // If SENTRY_DSN (server) is not set, server-side error tracking will be disabled at runtime
  sentry: {
    // Sentry organization and project slugs for source map uploads
    // Only required if you want source map uploads
    org: process.env.SENTRY_ORG || '',
    project: process.env.SENTRY_PROJECT || '',
    // Auth token for source map uploads (optional - if not set, source maps won't be uploaded)
    authToken: process.env.SENTRY_AUTH_TOKEN || '',
  },

  // Enable client-side source maps for better error stack traces
  sourcemap: {
    client: 'hidden',
  },

  pinia: {
    storesDirs: ['./app/stores/**'],
  },

  css: ['~/assets/css/tailwind.css'],

  /**
   * ============================================================================
   * RUNTIME CONFIGURATION
   * ============================================================================
   *
   * All values below can be overridden at RUNTIME using environment variables.
   * Nuxt automatically maps config keys to env vars:
   *
   *   runtimeConfig.someKey         → NUXT_SOME_KEY
   *   runtimeConfig.nested.key      → NUXT_NESTED_KEY
   *   runtimeConfig.public.someKey  → NUXT_PUBLIC_SOME_KEY
   *
   * ┌─────────────────────────────────────────────────────────────────────────┐
   * │ WHERE TO SET ENVIRONMENT VARIABLES                                      │
   * ├─────────────────────────────────────────────────────────────────────────┤
   * │ AZURE APP SERVICE (runtime)     │ GITHUB SECRETS (build-time only)     │
   * │ ─────────────────────────────── │ ──────────────────────────────────── │
   * │ NUXT_GEINS_API_ENDPOINT         │ SENTRY_AUTH_TOKEN                    │
   * │ NUXT_GEINS_TENANT_API_URL       │ SENTRY_ORG                           │
   * │ NUXT_STORAGE_DRIVER             │ SENTRY_PROJECT                       │
   * │ NUXT_STORAGE_REDIS_URL          │                                      │
   * │ NUXT_HEALTH_CHECK_SECRET        │                                      │
   * │ NUXT_ADMIN_SECRET               │                                      │
   * │ NUXT_EXTERNAL_API_BASE_URL      │                                      │
   * │ NUXT_SENTRY_DSN                 │                                      │
   * │ NUXT_WEBHOOK_SECRET              │                                      │
   * │ NUXT_LOGGING_VERBOSE_REQUESTS   │                                      │
   * │ NUXT_PUBLIC_FEATURES_ANALYTICS  │                                      │
   * └─────────────────────────────────────────────────────────────────────────┘
   *
   * NOTE: Values set here are defaults. Azure env vars override them at runtime.
   * Do NOT use process.env here - let Nuxt handle the mapping automatically.
   */
  runtimeConfig: {
    // ── Private Config (server-side only, not exposed to client) ────────────

    // Geins API configuration
    // Azure: NUXT_GEINS_API_ENDPOINT, NUXT_GEINS_TENANT_API_URL
    geins: {
      apiEndpoint: 'https://merchantapi.geins.io/graphql',
      tenantApiUrl: 'https://merchantapi.geins.io/store-settings',
    },

    // Diagnostic label only, read by server/api/health.get.ts — the mount
    // itself is decided in resolveKvStorageMount() above from the same
    // NUXT_STORAGE_DRIVER env var, at config-build time (before
    // useRuntimeConfig() exists, so that function can't read it from here).
    // redisUrl is deliberately not mirrored into runtimeConfig — no reader
    // needs the connection string outside resolveKvStorageMount() itself.
    storage: {
      driver: 'memory',
    },

    // Secret for accessing detailed health check metrics
    // Azure: NUXT_HEALTH_CHECK_SECRET=your-secret-here
    healthCheckSecret: '',

    // Secret for the one-off tenant-creation admin endpoint
    // (server/api/admin/tenants.post.ts) — separate from healthCheckSecret
    // since this one gates a write action, not read-only diagnostics.
    // Azure: NUXT_ADMIN_SECRET=your-secret-here
    adminSecret: '',

    // External API base URL for the proxy
    // Azure: NUXT_EXTERNAL_API_BASE_URL=https://your-external-api.com
    externalApiBaseUrl: 'https://api.app.com',
    // Sentry error tracking (server-side only)
    // Azure: NUXT_SENTRY_DSN=https://xxx@sentry.io/xxx
    // Note: DSN is kept server-side only to avoid exposing configuration to clients.
    // Client-side error tracking is disabled by default for security hardening.
    sentry: {
      dsn: '',
    },

    // Shared secret for webhook signature verification
    // Azure: NUXT_WEBHOOK_SECRET=your-shared-secret-here
    webhookSecret: '',

    // Logging configuration
    // Azure: NUXT_LOGGING_VERBOSE_REQUESTS=true
    logging: {
      // When true, request logs include full headers (sanitized).
      // Useful for debugging but can be noisy in production.
      verboseRequests: false,
    },

    // When true, 500 responses include the error stack trace.
    // Always off in production by default — flip to debug live incidents.
    // Correlation ID + message + tenantId are surfaced regardless so
    // support can trace any error via App Insights without this flag.
    // Azure: NUXT_DEBUG_ERRORS=true
    debugErrors: false,

    // ── Public Config (exposed to client) ───────────────────────────────────
    public: {
      // App metadata (typically not overridden)
      appName: 'Sales Portal',
      appVersion: '1.0.1',
      versionX: 'n/a',

      // Build info - set by GitHub Actions during build, not in Azure
      commitSha: process.env.GITHUB_SHA || 'n/a',

      // Environment detection
      environment: (process.env.NODE_ENV as Environment) || 'development',

      // Feature flags
      // Azure: NUXT_PUBLIC_FEATURES_ANALYTICS=true
      features: {
        analytics: false,
      },

      // Client API configuration (usually no need to override)
      api: {
        baseUrl: '/api',
        timeout: 30000,
      },
    },
  },

  nitro: {
    storage: {
      kv: resolveKvStorageMount(),
    },
    // Enable compression
    compressPublicAssets: true,
    // Production optimizations
    minify: true,
    // Replaces Nitro's default "Server Error" scrubber with one that
    // surfaces the real message, correlation ID, tenantId, and stack
    // (stack only when NUXT_DEBUG_ERRORS=true). See server/error.ts.
    errorHandler: '~~/server/error',
    // Dev-server watcher otherwise holds a handle open per file under
    // node_modules (thousands of them), climbing on every rebuild until it
    // hits EMFILE — framework defaults weren't excluding it here.
    watchOptions: {
      ignored: ['**/node_modules/**', '**/.git/**'],
    },
  },

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  icon: {
    // SSR: full lucide collection bundled into the server, served via the
    // /api/_nuxt_icon endpoint as a fallback for icons not in the client
    // bundle below.
    serverBundle: {
      collections: ['lucide'],
    },
    // Client bundle: statically-named icons are auto-discovered via `scan`.
    // Names that are only known at runtime (passed as props, computed from
    // config, looked up in a map) MUST be listed here. The scanner cannot
    // see them, and without an entry here every client-side render of that
    // icon costs a round-trip to /api/_nuxt_icon, with a brief flicker on
    // cold cache and silent failure if the endpoint is unreachable.
    // See docs/conventions/icons.md for the rule and how to extend the list.
    clientBundle: {
      scan: true,
      icons: [
        // pages/portal/index.vue → PortalStatCard
        'lucide:file-text',
        'lucide:shopping-bag',
        'lucide:package',
        'lucide:users',
        // components/portal/PortalShell.vue → tab strip
        'lucide:layout-dashboard',
        'lucide:list',
        'lucide:building-2',
        // pages/portal/favorites.vue → view-toggle (both grid + list)
        'lucide:layout-grid',
        // components/layout/footer/LayoutFooterMain.vue → social row
        'lucide:facebook',
        'lucide:instagram',
        'lucide:twitter',
        'lucide:linkedin',
        'lucide:youtube',
      ],
    },
  },

  shadcn: {
    prefix: '',
    componentDir: './app/components/ui',
  },

  // TypeScript configuration
  typescript: {
    strict: true,
    typeCheck: false, // Disable for faster builds, run separately in CI
  },

  // App configuration
  app: {
    head: {
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      link: [{ rel: 'preconnect', href: 'https://merchantapi.geins.io' }],
    },
  },

  // Experimental features
  experimental: {
    payloadExtraction: true,
    buildCache: true,
  },

  // Vite configuration
  vite: {
    server: {
      allowedHosts: ['.litium.portal'],
      watch: {
        ignored: ['**/node_modules/**', '**/.git/**'],
      },
    },
  },
});
