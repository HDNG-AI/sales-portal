---
title: Tenant operating timezone with no default
status: accepted
created: 2026-09-20
author: '@geins'
tags: [multi-tenant, tenant-config, i18n, dates]
---

# ADR-024: Tenant operating timezone with no default

## Context

Every date the portal renders — order created, quote valid-until, saved-list
updated — is an instant formatted through `Intl`. With no `timeZone` option,
`Intl` formats in the runtime's own zone: the **server's** during SSR and the
**browser's** after hydration. The two disagree for any buyer whose browser is
not in the server's zone, and the visible symptom is a date that changes by a
day on hydration. It is invisible in a UTC-region deployment reached from a
UTC-region browser and reliably wrong everywhere else.

What the portal actually wants is neither of those two zones. A B2B order
placed at 17:22 UTC belongs to the business day of the merchant's operation,
which is a property of the tenant, not of whoever is looking.

The obvious source for that property is the tenant's market. It works for the
markets this codebase grew up in: `se`, `no`, `dk`, `fi`, `de`, `nl` are each
one zone. It does not generalise. `us` spans six zones, `ru` eleven, and `au`,
`id`, `br`, `cd`, `mx`, `kz`, `cl`, `ca` and `cn`-with-Xinjiang-in-practice all
span more than one. A market-to-zone table is therefore not an incomplete
mapping that could be finished — for those markets the market simply does not
determine the zone, and a table would have to pick one and be wrong for the
rest of the country.

## Decision

Add `timezone?: string` to the tenant config, an IANA zone name, and give it
**no default**.

- The schema (`TimezoneSchema` in `server/schemas/store-settings.ts`) validates
  by attempting to construct an `Intl.DateTimeFormat` with the value, and
  rejects UTC offsets (`+01:00`) explicitly. `Intl` accepts an offset, but an
  offset cannot express DST, so a tenant stored as `+01:00` reads an hour wrong
  for the whole summer — the precise failure a named zone exists to prevent.
- `SALVAGE_DEFAULTS` carries `timezone: undefined`, so a malformed value
  degrades the field to unset rather than failing the whole parse. Without an
  entry the issue path is a single segment, which skips the leaf-strip branch
  and returns `null` — and a `null` resolution is negative-cached, so one bad
  date field would take a storefront down.
- `useTenant().timezone` is `undefined` when unset, not a substituted zone.
- Every consumer spreads the option conditionally:
  `...(timezone.value ? { timeZone: timezone.value } : {})`.

No default rather than `'UTC'`, because the two are not the same claim. `'UTC'`
asserts that an unconfigured tenant operates in UTC, which is true of almost
none of them, and it is indistinguishable at the consumer from a tenant that
deliberately chose UTC. `undefined` asserts nothing and leaves today's
behaviour exactly as it was.

Deriving the zone from the market is explicitly not done, for the reason above.
A merchant who operates in one zone sets one field; that is a smaller ask than
a mapping that is silently wrong for a third of the world's markets.

## Consequences

**Good.** A tenant that sets the field gets the same calendar day from SSR and
from the browser, for every buyer, without a `ClientOnly` wrapper or a
suppress-hydration-warning escape hatch. The field is additive and optional, so
no existing tenant config changes meaning. Rejecting offsets keeps DST correct
by construction. A merchant who genuinely wants UTC can say so, and it reads
differently from one who never chose.

**Bad.** An unconfigured tenant still has the SSR/client split — this ADR makes
the fix available, it does not apply it to anyone who has not opted in. Tenants
that genuinely span zones (a market with buyers in several) get one operating
zone rather than per-buyer local dates; a buyer-preference layer on top of this
field is the shape that would solve that, and is not built.

**Watch for.** Tests that format a fixture instant and assert a calendar day
are asserting the runner's timezone unless they pin one. `2025-12-22T17:22Z` is
the 22nd in UTC CI and the 23rd from UTC+7 east. Pin the tenant zone in any
such test; `tests/setup-components.ts` exports `mockTenantTimezone` for the
component tier.
