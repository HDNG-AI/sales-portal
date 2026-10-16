---
title: Legacy URL middleware — disabled rollout plan
status: draft
created: 2026-10-14
tags: [routing, seo, tenant, migration, redirects]
---

# Per-tenant legacy URL redirects (implementation, NOT activated)

This is a **generic**, disabled-by-default runtime implementation for the
VirtueMart → sales-portal URL mapping described in
[PR #16](https://github.com/HDNG-AI/sales-portal/pull/16).
It deliberately does **not** include Odelco's merchant-curated mapping data,
generate a map, set KV keys, edit DNS, or deploy a redirect.

## Where it runs

`server/middleware/00.legacy-redirects.ts` sorts **before**
`00.locale-market.ts` so a legacy path can become **one** 301, without a
preliminary 302 to a prefixed URL. Nuxt's existing tenant request-hook has
already resolved the hostname to a server-side `tenantId` and config. That
**trusted context**, never a query parameter or cookie, selects the map.

The pure matcher is `server/utils/legacy-redirects.ts`, mirrored from PR #16.
Tests cover product `-info` suffixes, curated exact paths, old VirtueMart
sorting/paging artifacts, Unicode, and explicit ancestor fallback. Unknown
paths continue through the existing locale/404 pipeline.

## Both switches must be enabled in an approved future rollout

All environments and all tenants remain disabled without **both** switches:

1. Process runtime environment `LEGACY_REDIRECTS_RUNTIME_ENABLED=1`.
   No deployment/env change is included in this PR; the default is OFF.
2. KV key `legacy:redirects:enabled:<tenantId>` must be the JSON **boolean**
   `true`. A missing, false or string-valued key is OFF.

A third requirement is a **valid** map at
`legacy:redirects:<tenantId>`, containing a version-1 object:

```json
{
  "version": 1,
  "prefix": "/se/sv",
  "exact": {
    "/varumarken/actisense": "/se/sv/b/actisense"
  },
  "articleNumber": {
    "a3702": "/se/sv/p/maretron-a3702"
  },
  "ancestor": {}
}
```

The 30-second tenant-keyed in-process LRU bounds KV overhead. Disabled status
is memoized too, and a flag change may take up to 30 seconds to be seen by each
worker. A process restart invalidates that local cache. KV read failures or
invalid/missing maps **fall through** to the normal app, not a 500 or an unsafe
redirect. A valid map never permits a cross-origin target; suspicious targets
invalidate the entire map before any redirect.

A rollback disables the per-tenant key (allow 30 seconds per worker) or
removes the process flag and restarts the service. Do not treat browser-cached
301 redirects as immediately reversible.

## What this middleware intentionally does not do

- It does not expose any administrative write API, credentials, tenant-config
  schema field, manual mapping UI or production configuration.
- It does not run on API routes, static asset filenames, already-canonical
  `/{market}/{locale}/...` routes, store-settings previews, non-GET/HEAD
  requests, tenant lookup failures or the root path.
- It does not create a missing destination page. Curated `_review` rows must
  be merchant-approved before writing a KV map.
- It does not decide whether discontinued content should return 404, 410, or
  redirect; those are SEO/content decisions.
- It preserves incoming query parameters for campaign attribution; redirects
  are internal paths only. Confirm this with Odelco's marketing owner at rollout.
- It does not claim that the old inventory from September still matches the
  current catalog. Regenerate and compare first.

## Required acceptance before *any* staging activation

- Merge/review PR #16's generator separately and confirm its language/paging
  integrity. Review all flagged category/brand/CMS rows with Odelco.
- Use **approved read-only** Geins credentials to generate a fresh map, then
  compare current product inventory and old-site/Search Console URL coverage.
  Treat the resulting map as tenant data, never commit credentials or maps.
- Obtain Erik's review of middleware ordering and tenant KV segregation.
  Confirm host routing, the 30-second TTL, and that map validation matches
  the generator's normalized outputs.
- In an isolated/staging-only experiment, run existing approved old paths
  and representative unmapped URLs through **one tenant**, checking 301 targets,
  headers, loops, locale correctness, no cross-tenant redirects and 404
  fallthrough. Record success/failure with paths scrubbed of private data.
- Keep production and other tenants OFF until written merchant + technical
  approval and an explicit deployment/rollback window.

Current status: code and tests only. **No live redirect or staging activation.**
