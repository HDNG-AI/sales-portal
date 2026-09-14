# Multi-Tenant Architecture

The Sales Portal is designed to serve multiple tenants (merchants/brands) from a single deployment. This document explains how the multi-tenant system works.

## How Tenancy Works

The system identifies tenants based on the request hostname. Each tenant is mapped to a configuration that defines their branding, theme, and features.

```
┌─────────────────┐      ┌─────────────────┐      ┌─────────────────┐
│ tenant-a.com    │      │ tenant-b.com    │      │ tenant-c.com    │
└────────┬────────┘      └────────┬────────┘      └────────┬────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │    Sales Portal Server    │
                    │                           │
                    │  1. Extract hostname      │
                    │  2. Lookup tenant config  │
                    │  3. Inject into context   │
                    │  4. Serve themed response │
                    └───────────────────────────┘
```

## Request Flow

### 1. Hostname Detection

The server plugin (`server/plugins/02.tenant-context.ts`) extracts the hostname from incoming requests:

- Extracts hostname from request headers
- Ignores port number
- Attaches tenant context to the H3 event

### 2. Tenant Resolution

`resolveTenant()` (`server/utils/tenant.ts`) turns that hostname into a config, trying the
negative cache, then KV storage, then the merchant API — the full order is in
[Architecture](/architecture#request-flow). A cache hit is re-checked against the config's own
hostname list, so a stale alias mapping heals itself. A hostname the merchant API does not know
does not resolve, and the tenant plugin answers 404 — see [Local Development](#local-development).

The resolved config is written to `event.context.tenant.config` once per request. Downstream
plugins, services and routes read it from context instead of resolving again.

### 3. Configuration for the Client

`GET /api/config` (`server/api/config.get.ts`) returns the already-resolved config as
`PublicTenantConfig`, with secrets stripped. It does not resolve tenants itself.

### 4. Theme Injection

The server plugin `server/plugins/04.tenant-css.ts` injects the tenant's visual assets into the
rendered HTML from the `render:html` hook:

- the `data-theme` attribute on `<html>`
- the tenant's CSS as an unlayered `<style>` tag, so it always beats the `@layer base` defaults
- the favicon `<link>`, when `branding.faviconUrl` is set
- Google Fonts preconnect hints and the stylesheet `<link>`

These are raw HTML strings that no client-side code touches during hydration, which is what keeps
the first paint free of a flash of unstyled content.

## Tenant Context

The tenant context is available in all server handlers via `event.context.tenant`:

```typescript
// In any server route/middleware
export default defineEventHandler((event) => {
  const { hostname, tenantId, config } = event.context.tenant;
  // hostname: what the browser asked for, port stripped (e.g. "tenant-a.litium.portal")
  // tenantId: the resolved tenant's own id (e.g. "tenant-a") — set for page routes,
  //           optional on API routes
  // config:   the full TenantConfig, resolved once per request
});
```

## Storage Keys

A tenant with several hostnames (primary plus aliases) stores its config once, behind a two-step
lookup — `hostname` → `tenantId` → `TenantConfig`:

| Key Pattern                | Purpose                    |
| -------------------------- | -------------------------- |
| `tenant:id:{hostname}`     | Maps hostname to tenant ID |
| `tenant:config:{tenantId}` | Full tenant configuration  |

## Tenant Configuration

The tenant API contract is defined as a Zod schema in `server/schemas/store-settings.ts` (see [ADR-007](/adr/007-tenant-config-schema-service-layer)). All types are inferred from the schema.

The server uses `TenantConfig` (full config including secrets). The client receives `PublicTenantConfig` (secrets stripped):

```typescript
// PublicTenantConfig — what the client receives from GET /api/config
interface PublicTenantConfig {
  tenantId: string;
  hostname: string;
  mode: 'commerce' | 'catalog';
  theme: ThemeConfig;
  branding: BrandingConfig;
  features: Record<string, FeatureConfig>;
  seo?: SeoConfig;
  contact?: ContactConfig;
  css: string;
  isActive: boolean;
  locale: string;
  availableLocales: string[];
}
```

### Branding Configuration

```typescript
interface BrandingConfig {
  name: string;
  watermark: 'full' | 'minimal' | 'none';
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  logoSymbolUrl?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
}
```

### Features Configuration

Features are a record of feature flags with optional access control:

```typescript
// Feature flag with access control
interface FeatureConfig {
  enabled: boolean;
  access?: 'all' | 'authenticated' | { group: string } | { role: string } | { accountType: string };
}

// Example feature map
features: {
  search: { enabled: true },
  cart: { enabled: true, access: 'authenticated' },
  quotes: { enabled: true, access: { role: 'order_placer' } },
  wishlist: { enabled: false },
}
```

### Tenant Config Service Layer

Server-side code should use the service layer (`server/services/tenant-config.ts`) for structured access:

```typescript
import {
  getTheme,
  getBranding,
  isFeatureEnabled,
  getPublicConfig,
} from '../services/tenant-config';

// Section accessors
const theme = await getTheme(event);
const branding = await getBranding(event);
const enabled = await isFeatureEnabled(event, 'cart');

// Full public config (for API response)
const config = await getPublicConfig(event);
```

## Local Development

Tenant resolution works the same locally as in production: a hostname either exists in the
merchant API or it answers 404. There is no development fallback that invents a tenant for an
unknown name, however you start the server (`pnpm dev`, `pnpm local:dev`, or the Playwright
web server). A 404 on a hostname you expected to work means that exact hostname is not
registered — check the registration before anything else.

Configs come from one place. `resolveTenant()` calls the merchant API over plain `fetch`, from a
laptop exactly as from Azure, so any hostname it knows already works locally given DNS pointing at
your machine. Nothing in this repository seeds a tenant of its own — develop against the
team-owned test tenant, whose hostname the e2e variables in `.env` already name
(`PLAYWRIGHT_BASE_URL`, `E2E_EXPECTED_TENANT_ID`).

To browse a tenant, point the hostname it is registered under at your machine and use the dev
server's port:

```
# /etc/hosts
127.0.0.1 <the hostname the merchant API knows>
```

The lookup matches the exact full hostname and does no subdomain parsing. `pnpm local:setup`
installs a dnsmasq wildcard sending all of `*.litium.portal` to `127.0.0.1`, saving an
`/etc/hosts` line per tenant.

`.litium.portal` is a local-only convention, and the merchant API knows almost nothing under it,
so the dev server rewrites the lookup: a request for `name.litium.portal` is resolved as
`name.litium.store`, where a Geins tenant lives by default
(`devLookupHostname` in `server/utils/dev-hostname.ts`, behind `import.meta.dev`). Any registered
tenant is therefore browsable locally by name alone, with nothing to configure — and a name the
merchant API does not know under either suffix still answers an honest 404. Only the lookup moves:
the response is served under the `.litium.portal` host the browser asked for, and
`event.context.tenant.hostname` keeps that name, so cookies, redirects, the tenant logger and the
404 body all stay on it. The rewritten name surfaces in one place, the resolution line — the
development 404 page shows it, and it is logged — where `[tenant] resolve host=…` names the
`.litium.store` hostname that was actually looked up, not the one you typed. Production and the
Azure dev environment receive real hostnames and rewrite nothing.

## Client-Side Usage

Use the `useTenant` composable to access tenant data in components:

```vue
<script setup>
const { tenant, hasFeature, isLoading } = useTenant();
</script>

<template>
  <div v-if="!isLoading">
    <h1>{{ tenant?.branding?.name }}</h1>
    <SearchBar v-if="hasFeature('search')" />
  </div>
</template>
```

## Admin Tenant Onboarding

`POST /api/admin/tenants` (`server/api/admin/tenants.post.ts`) creates or
updates one tenant directly in KV, bypassing the normal merchant-admin →
merchant API flow. It's a one-off onboarding tool, not the primary way
tenants get configured — most tenants are still configured externally per
[Tenant Configuration](#tenant-configuration) above. Use this endpoint when
bringing up a tenant that doesn't have a merchant-API record yet, or to
patch a field on one that does.

Gated by the `X-Admin-Key: <NUXT_ADMIN_SECRET>` header (separate secret from
the health-check one — this gates a write, and a header rather than a query
param so the secret never lands in a logged request URL). Calling it again
with the same `tenantId` updates the existing tenant in place rather than
creating a duplicate — the request's `hostname` must already be one of that
tenant's known hostnames/aliases, or the call is rejected; fields omitted
from the request body are left untouched, not blanked (see
`mergeTenantConfig` in `server/utils/tenant-crud.ts`).

### Parameters

| Field                              | Required                  | Notes                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hostname`                         | yes                       | Primary hostname visitors use (`www.example.com`).                                                                                                                                                                                                |
| `tenantId`                         | no                        | Defaults to `hostname` if omitted. Use a short, stable id — this is the KV key.                                                                                                                                                                   |
| `aliases`                          | no                        | Additional hostnames that resolve to the same tenant — e.g. a `.localhost` dev domain alongside the production one.                                                                                                                               |
| `branding.name`                    | no                        | Defaults to `tenantId`.                                                                                                                                                                                                                           |
| `branding.watermark`               | no                        | Defaults to `'none'` when `branding` is given at all, `'full'` otherwise.                                                                                                                                                                         |
| `mode` / `checkoutMode`            | no                        | Default to `'commerce'` / `'hosted'`.                                                                                                                                                                                                             |
| `geinsSettings.apiKey`             | only with `geinsSettings` | The Geins account's API key.                                                                                                                                                                                                                      |
| `geinsSettings.accountName`        | only with `geinsSettings` | The Geins account slug used for API auth — **not necessarily the image CDN subdomain**, see below.                                                                                                                                                |
| `geinsSettings.channel` / `.tld`   | only with `geinsSettings` | Split from the platform's combined `channelId` format (`"1\|se"` → `channel: "1"`, `tld: "se"`).                                                                                                                                                  |
| `geinsSettings.locale` / `.market` | only with `geinsSettings` | Use the full locale tag (`sv-SE`), not the bare language code (`sv`) — matches `DEFAULT_GEINS_SETTINGS` and every existing tenant.                                                                                                                |
| `geinsSettings.imageBaseUrl`       | no                        | Overrides the `accountName`-derived image CDN host. Set this whenever a tenant's image subdomain differs from its Geins account name — the derived default is `https://{accountName}.commerce.services`, which is wrong whenever the two diverge. |
| `geinsSettings.environment`        | no                        | Defaults to `'production'`.                                                                                                                                                                                                                       |
| `theme`                            | no                        | Merged onto the default theme; omitted keys keep their default/existing value.                                                                                                                                                                    |

### Example

```bash
curl -X POST "https://<host>/api/admin/tenants" \
  -H "X-Admin-Key: $NUXT_ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "hostname": "www.example-store.com",
    "tenantId": "example-store",
    "aliases": ["example-store.localhost"],
    "branding": { "name": "Example Store" },
    "geinsSettings": {
      "apiKey": "<geins-api-key>",
      "accountName": "example_store_prod",
      "channel": "1",
      "tld": "se",
      "locale": "sv-SE",
      "market": "se",
      "environment": "production",
      "imageBaseUrl": "https://example-store.commerce.services"
    }
  }'
```

## Related Documentation

- [Theming System](/guide/theming) — How to customize tenant appearance
- [API Reference](/guide/api-reference) — Tenant-related API endpoints
- [Architecture Overview](/architecture) — Full system architecture
