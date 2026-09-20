---
title: Tenant operating timezone
status: accepted
created: 2026-08-28
updated: 2026-09-20
author: '@geins'
tags: [tenant, i18n, dates]
---

# ADR-024: Tenant operating timezone

## Context

Dates shown in the portal (order placed, invoice date, quote created) need a
timezone to render in. Three candidates were considered and rejected:

- **Server OS timezone.** Whatever the Nitro process happens to run in —
  arbitrary, and different between local dev, CI, and each deploy target.
- **Viewer's browser timezone.** Correct for a UI affordance like a delivery
  picker's `:min` date (see `app/pages/checkout.vue`), but wrong for a record
  like an order timestamp: a buyer in Singapore looking at a Stockholm
  merchant's order should see the merchant's operating time, not their own.
- **A raw UTC offset** (e.g. `GMT+1`). Does not shift for daylight saving —
  Stockholm is GMT+1 in winter and GMT+2 in summer, so a fixed offset is
  wrong for half the year.

## Decision

`TenantConfig.timezone` is an IANA timezone identifier (e.g.
`'Europe/Stockholm'`), never a raw offset. `Intl`'s `timeZone` option
resolves DST correctly per-date for any IANA identifier, which a fixed
offset cannot.

**The field is optional and has no default** (updated 2026-09-20; it
previously defaulted to `'UTC'`). `'UTC'` asserts that an unconfigured
tenant operates in UTC, which is true of almost none of them, and at the
consumer it is indistinguishable from a tenant that chose UTC deliberately.
Unset means the `timeZone` option is omitted entirely, so `Intl` formats in
the runtime's own zone — the behaviour every tenant already had before this
field existed. A tenant that sets the field gets a stable zone from that
point on; one that does not is left exactly as it was, rather than being
re-dated by a substitution nobody chose.

**Not derived from the tenant's market**, which is the obvious shortcut and
does not generalise. It works for the markets this codebase grew up in —
`se`, `no`, `dk`, `fi`, `de`, `nl` are each one zone. But `us` spans six
zones, `ru` eleven, and `au`, `id`, `br`, `mx`, `ca`, `cl` and `kz` all span
more than one. For those markets the market simply does not determine the
zone, so a mapping would have to pick one and be wrong for the rest of the
country. One field set by a merchant who knows their own operating hours is
a smaller ask than a table that is silently wrong for a third of the world.

Validated by `TimezoneSchema` (`server/schemas/store-settings.ts`), which
checks the value by attempting `Intl.DateTimeFormat` construction rather
than checking membership in `Intl.supportedValuesOf('timeZone')` — that
enumeration omits `'UTC'` itself even though the runtime accepts it as a
real `timeZone` value, so a membership check would reject a zone a merchant
can legitimately choose. Offsets are additionally refused by an explicit
leading-sign check, because construction alone does not catch them: `Intl`
rejects `'GMT+1'` but **accepts** `'+01:00'` and `'-0500'`, and an offset
cannot express DST — the precise failure a named zone exists to prevent.
The error message models the correct shape
(`'Must be a valid IANA timezone identifier, e.g. "Europe/Stockholm"'`) so a
bad value is caught with an example at onboarding time, not discovered
later as a mis-rendered date.

Client-side formatting reads the tenant's timezone via `useTenant()` and
passes it through `app/utils/tenant-date.ts`'s `formatTenantDate()`, never
`toLocaleDateString()` without an explicit `timeZone`.

**Backward compatibility:** a `TenantConfig` already in KV from before this
field existed comes back from a raw read without it, and that is now simply
the unset state rather than something to migrate. The
`withTenantConfigDefaults()` backfill that substituted `'UTC'` at every raw
read site is removed — with the field optional it was the identity function.

**Resilience:** `SALVAGE_DEFAULTS` in `server/utils/tenant.ts` carries a
`timezone` entry so a malformed stored value degrades the field to unset
rather than failing the whole parse. Without an entry the issue path is a
single segment, which skips the leaf-strip branch and returns `null` — and a
`null` resolution is negative-cached, so one bad date field would take a
storefront down.

## Consequences

- Dates render correctly across DST transitions everywhere in the portal,
  driven by one per-tenant setting instead of server or browser time.
- A tenant onboarded without specifying a timezone is unchanged: the option
  is omitted and dates render in the runtime's zone, as before. That means
  the SSR/client split is still present for those tenants — this ADR makes
  the fix available, it does not apply it to anyone who has not opted in.
- Tests that format a fixture instant and assert a calendar day are
  asserting the runner's timezone unless they pin one. `2025-12-22T17:22Z`
  is the 22nd in UTC CI and the 23rd from UTC+7 east. Pin the tenant zone in
  any such test.
- `checkout.vue`'s delivery-date picker deliberately keeps using the
  viewer's local timezone for its `:min` bound — that is a UI constraint on
  the viewer's "today," not a record, and stays out of scope for this ADR.
- A merchant that only operates in one market still has to set `timezone`
  explicitly to get anything other than UTC displayed — there is no
  market-to-timezone inference.
