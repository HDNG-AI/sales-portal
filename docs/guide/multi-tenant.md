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

### 2. Configuration Loading

The config endpoint (`server/api/config.get.ts`) handles tenant configuration:

- Fetches tenant config from KV storage
- Auto-creates tenant in development mode
- Validates tenant is active
- Returns configuration to the client

### 3. Theme Injection

The client plugin (`app/plugins/tenant-theme.ts`) applies tenant-specific theming:

- Applies `data-theme` attribute to HTML element
- Injects custom CSS for the tenant
- Updates theme on configuration changes

## Tenant Context

The tenant context is available in all server handlers via `event.context.tenant`:

```typescript
// In any server route/middleware
export default defineEventHandler((event) => {
  const { id, hostname } = event.context.tenant;
  // id: Tenant identifier (e.g., "tenant-a.localhost")
  // hostname: Request hostname
});
```

## Storage Keys

Tenant data is stored with the following key patterns:

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

## Development Mode

In development mode, tenants are automatically created when accessing any hostname. This makes it easy to test multi-tenant functionality locally:

1. Add entries to your `/etc/hosts` file:

   ```
   127.0.0.1 tenant-a.localhost
   127.0.0.1 tenant-b.localhost
   ```

2. Access the site via the tenant hostname:

   ```
   http://tenant-a.localhost:3000
   http://tenant-b.localhost:3000
   ```

3. Each tenant will be automatically created with default configuration.

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
