---
title: Odelco legacy URL redirect map
status: proposed
created: 2026-09-21
tags: [routing, urls, seo, redirects, migration]
---

# Odelco legacy URL redirect map

Keeping bookmarks and inbound links working when odelco.se moves to sales-portal.

## Recommendation in three sentences

Put the map behind a new `server/middleware/00.legacy-redirects.ts` that runs **before**
`00.locale-market.ts`, and store the map itself as a per-tenant blob in the KV mount that
already holds `tenant:config:` — no Odelco strings in source, no tenant-config schema change.
The map is generated from the Geins Merchant API, not hand-written: product URLs join on
`articleNumber` (3,470 rows, fully mechanical, 95% hit rate against the live old site), and
only the category/brand/CMS rows (~75) need human judgement because the taxonomy was
genuinely reorganised during migration.
Expect ~3,573 rows / ~356 KB, one KV read per tenant per worker cold start, and zero added
cost on normal traffic because the middleware only engages on a path prefix the map declares.

---

## 1. Premise correction — read this first

The task brief described the system being replaced as a **"ralph" storefront**
(`@geins/ralph-storefront`, Nuxt 2) deployed at `ralph-storefront-production.up.railway.app`
and serving `odelco.se`. Neither half of that holds up against the live systems.

**`odelco.se` is a Joomla 4 + VirtueMart site, not a ralph storefront.**

```
$ curl -sI https://odelco.se/          →  server: nginx, x-powered-by: PHP/8.3.33
$ curl -s  https://odelco.se/ | head   →  <meta name="generator" content="Joomla! - Open Source Content Management">
                                          class="... version-3.13 joomla-4"
                                          /templates/vp_smart/css/virtuemart.css
$ curl -sI 'https://odelco.se/index.php?option=com_virtuemart'   →  200
$ curl -sI https://odelco.se/se/sv/    →  404      (ralph's market/locale root)
$ curl -sI https://odelco.se/p/test    →  404      (ralph's product prefix)
```

**`ralph-storefront-production.up.railway.app` serves BoatTools, not Odelco.**

```
$ curl -sI https://ralph-storefront-production.up.railway.app/
    302 → /se/sv/
$ curl -s  https://ralph-storefront-production.up.railway.app/se/sv/ | grep og:site_name
    content="BoatTools SE"
```

Meanwhile the Geins channel that the local `~/Projects/Heading/odelco` clone is configured
against reports its own storefront URL, and it points at the Joomla site:

```
channel(channelId:"1|se") → { name: "odelco.se.odelco", url: "https://odelco.se",
                              defaultMarketId: "SE|SEK", defaultLanguageId: "sv-SE" }
```

So the migration whose inbound links need preserving is **VirtueMart → sales-portal**, and
that is what this proposal maps. The ralph → sales-portal mapping is a different, far easier
problem; it is included as §4.2 because BoatTools will need it, but it is not Odelco's.

The local clone at `~/Projects/Heading/odelco` is a real ralph codebase, and it is configured
with Odelco's Geins credentials — but there is no evidence it is deployed anywhere serving
Odelco traffic. `shop.`, `butik.`, `store.`, `webshop.` and `new.odelco.se` do not resolve.
See §9 for what would settle this.

---

## 2. What the old site actually serves

Derived from a read-only BFS crawl (701 pages fetched, 1,170 URLs discovered; GET only)
plus reading `nuxt.config.js` / `config/route-paths.js` in the ralph clone for §4.2.

| Entity              | Old URL shape                             | Real example                                                               |
| ------------------- | ----------------------------------------- | -------------------------------------------------------------------------- |
| Product (flat)      | `/produkter/{articleNumber}-info`         | `/produkter/a3702-info`                                                    |
| Product (nested)    | `/produkter/{cat}/…/{articleNumber}-info` | `/produkter/elektricitet-ac-dc/batteriövervakning/bam010700000r-info`      |
| Product (no prefix) | `/{cat}/{articleNumber}-info`             | `/installationsverktyg/a2c3931270001-info`                                 |
| Category            | `/produkter/{path}/results,{n}-{m}`       | `/produkter/digital-switching/knappar-och-paneler/results,1-0?clearCart=0` |
| Category (sorted)   | `…/dirDesc`, `…/dirAsc`                   | `/produkter/kontroll-ochovervakning/motordata/dirDesc`                     |
| Brand               | `/varumarken/{slug}?layout=details`       | `/varumarken/actisense?layout=details`                                     |
| Brand (alt)         | `/produkter/manufacturer/{slug}`          | `/produkter/manufacturer/maretron`                                         |
| Brand index         | `/varumarken`                             |                                                                            |
| CMS                 | `/{alias}` or `/{parent}/{child}`         | `/om-odelco`, `/kontakt/kontakta-oss`                                      |
| Non-SEF             | `/index.php?option=com_virtuemart&…`      |                                                                            |

Four properties of the old URLs that the matcher has to survive:

1. **The same product is served at three different depths.** Matching on the `-info` leaf
   covers all of them; enumerating ancestor paths does not.
2. **Mixed case.** `/produkter/BAM030710100-info` and `/produkter/bam010700000r-info` both
   occur. Lookup must be case-folded.
3. **Raw UTF-8 in paths.** `batteriövervakning` appears unencoded. Lookup must
   percent-decode first.
4. **Paging and sort noise is structural, not query-string.** `results,1-0` and `dirDesc`
   are _path segments_. They must be stripped before lookup and dropped from the target.

**There is no sitemap.** `odelco.se/sitemap.xml` 404s, `robots.txt` is the stock Joomla file
with no `Sitemap:` directive, and the jmap sitemap component is not installed
(`?option=com_jmap&view=sitemap&format=xml` returns an XML `404 Kan inte hitta komponent`
body under an HTTP 200). The URL inventory here is therefore **link-reachable only** — see §9.

## 3. What sales-portal serves

Per [ADR-015](../../adr/015-type-prefixed-routing.md), every entity URL is
`/{market}/{locale}/{type-prefix}/{slug…}`. For this channel the prefix is `/se/sv`
(market alias `se` from `SE|SEK`, locale `sv` from `sv-SE`).

The Geins canonical URLs are _not_ the app URLs, and the gap is the whole reason a transform
step exists:

| Entity   | Geins `canonicalUrl`                                                            | sales-portal path                            |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| Product  | `/se/sv/p/kontroll-overvakning/batteriovervakning/str1-radar-tank-level-sender` | identical                                    |
| Category | `/se/sv/l/digital-switching/knappar-paneler`                                    | `/se/sv/c/digital-switching/knappar-paneler` |
| Brand    | `/se/sv/l/actisense`                                                            | `/se/sv/b/actisense`                         |
| CMS page | (alias only)                                                                    | `/se/sv/{alias}`                             |

**Geins uses `/l/` for both categories and brands.** The entity type must come from the query
that produced the URL, never inferred from the URL — the same trap `stripGeinsPrefix(path, itemType)`
in `shared/utils/menu.ts` documents, and the one that caused Failure A in
[ADR-019](../../adr/019-bulletproof-routing.md). `toAppPath(canonicalUrl, type)` in the
generator takes the type as a required argument for exactly this reason.

## 4. Mapping rules

### 4.1 VirtueMart → sales-portal (Odelco, the live problem)

| #   | Old                                                         | New                              | Kind                                            | Evidence                                                                                         |
| --- | ----------------------------------------------------------- | -------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1   | `…/{articleNumber}-info` (any depth)                        | product `canonicalUrl`           | **Data join** on `articleNumber`, case-folded   | 614/644 crawled product URLs matched (95.3%)                                                     |
| 2   | `/produkter/{vm-path}`                                      | `/se/sv/c/{geins-path}`          | **Curated.** No string rule works               | Automatic slug normalisation matched 18/257 (7%)                                                 |
| 3   | `/varumarken/{slug}`                                        | `/se/sv/b/{alias}`               | **Mostly pattern** (identity), 2 curated        | 14/18 identical; `egis-mobile`→`egis`, `odelco`→`odelco-diverse`; `nelco`, `star` have no target |
| 4   | `/produkter/manufacturer/{slug}`                            | `/se/sv/b/{alias}`               | **Pattern** rewrite                             | 7 crawled                                                                                        |
| 5   | `/{alias}` where alias ∈ Geins `cmsPages`                   | `/se/sv/{alias}`                 | **Pattern** (prefix add)                        | `om-odelco`, `produktomraden` match verbatim                                                     |
| 6   | `/{old-cms-path}` renamed                                   | `/se/sv/{alias}`                 | **Curated**                                     | `/kontakt/kontakta-oss`→`contact`, `/allmanna-forsaljningsvillkor`→`allmanna-villkor`            |
| 7   | `…/results,{n}-{m}`, `…/dirDesc`, `?clearCart=`, `?layout=` | stripped                         | **Pattern** (normalisation, applies before 1–6) |                                                                                                  |
| 8   | unmatched path under a mapped category                      | nearest mapped ancestor category | **Fallback**                                    | recovers 184 of 900 crawled URLs                                                                 |
| 9   | anything else                                               | fall through → 404               |                                                 | 40 of 900                                                                                        |

Rules 1, 3, 4, 5, 7 are cheap. **Rules 2 and 6 are the human work**, and rule 2 is the
expensive one: the old taxonomy was genuinely reorganised, not just re-slugged. Two examples
that show why no normaliser saves you —

```
old  /produkter/stroemfoersoerjning/laddare-och-omvandlare    (chargers AND inverters)
new  /se/sv/c/stromforsorjning-1/batteriladdare               (chargers)
     /se/sv/c/stromforsorjning-1/vaxelriktare                 (inverters)   ← one-to-many

old  /produkter/kontroll-ochovervakning/...                   ("och" glued to "overvakning")
new  /se/sv/c/kontroll-overvakning/...
```

The old site also transliterates (`ä`→`ae`, `ö`→`oe`: `stroem`, `naetverk`, `oevervakning`)
while Geins strips diacritics (`strom`, `natverk`, `overvakning`), and drops the conjunction
(`knappar-och-paneler` → `knappar-paneler`). Undoing that mechanically lifts the match rate
from 0% to 7%, which is not worth shipping. **32 curated category rows + the ancestor
fallback cover 217 crawled category paths** — that is the trade this design makes.

### 4.2 ralph → sales-portal (BoatTools; not Odelco)

Included because the brief assumed it and because BoatTools will need it. It is nearly
free — ralph and sales-portal already share the `/{market}/{locale}/{prefix}/` shape, and
sales-portal's `ROUTE_PATHS` are identical to ralph's `config/route-paths.js`
(`/c`, `/p`, `/b`, `/s`, `/dc`, `/l`):

| ralph                                                               | sales-portal                                     | Kind                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| `/{market}/{locale}/p/{slug}`                                       | identical                                        | none needed                                                     |
| `/{market}/{locale}/b/{slug}`                                       | identical                                        | none needed                                                     |
| `/{market}/{locale}/s/{query}`                                      | identical                                        | none needed                                                     |
| `/{market}/{locale}/c/{slug}`                                       | identical                                        | none needed                                                     |
| `/{market}/{locale}/l/{slug}`                                       | `/…/c/{slug}` or `/…/b/{slug}`                   | **one rule**, already handled by `resolve-url.global.ts` Tier 1 |
| `/{market}/{locale}/{cms-alias}`                                    | identical                                        | none needed                                                     |
| `/kassan`, `/mina-sidor/*`, `/favoriter`, `/varumarken`, `/nyheter` | `/checkout`, `/portal/*`, `/portal/favorites`, … | ~7 static rows                                                  |

ralph's `/l/` ambiguity is _already_ solved in this repo by ADR-019 Tier 1
(`app/middleware/resolve-url.global.ts` fast-path guard on `l` and `dc`). A BoatTools cutover
needs roughly seven hand-written rows for the i18n-translated static pages, and nothing else.

## 5. Where the redirect lives

### Options considered

**A. Nitro `routeRules` in `nuxt.config.ts`** — rejected.
`routeRules` compile into a build-time matcher, so 3,470 entries would be baked into the
bundle and every map refresh would need a redeploy. Worse, they are _global_: sales-portal is
one deployment serving many tenants, so an Odelco rule would fire on every tenant's hostname.
That is the "Never hardcode tenant-specific values" rule in CLAUDE.md, violated structurally
rather than by accident. There is currently no `routeRules` key in `nuxt.config.ts` at all.

**B. Reuse the ADR-017 / ADR-019 404-miss resolver** — rejected as the primary mechanism.
It cannot do this job, and I verified all three reasons rather than assuming them:

1. _`urlHistory` does not cover a platform migration._ Geins retains old slugs only for
   renames **inside Geins**. Probed directly:
   `urlHistory(url:"/produkter/a3702-info") → null`.
2. _The alias lookup cannot match._ The resolver tries the last path segment as a product /
   category / brand alias. The old leaf is `a3702-info`; the Geins alias is
   `maretron-a3702`. No overlap. The join key is `articleNumber`, which the resolver
   does not query.
3. _It runs too late._ A bare `/produkter/a3702-info` hits `server/middleware/00.locale-market.ts`
   first, which finds no market/locale prefix and **302s to `/se/sv/produkter/a3702-info`**.
   The resolver would then emit a second hop. Two redirects per inbound link, for 3,470 URLs,
   is a needless bleed of link equity.

It stays exactly where it is as the _downstream_ net for renamed Geins slugs. It is
complementary, not competing.

**C. Edge / CDN rules (Azure Front Door, Cloudflare)** — rejected as primary.
Fastest possible, zero app cost, but Front Door's Rules Engine caps at ~25 rules per ruleset
against 3,573 entries; the map is derived from Geins and wants regenerating as the catalog
moves, which is awkward across a deploy boundary; and it splits routing knowledge across two
systems, so the next person debugging a 404 has two places to look. Worth revisiting **only**
if measured 301 latency becomes a problem, and then only for the handful of highest-traffic
paths.

**D. Server middleware + per-tenant map in KV** — **recommended.**

```
server/middleware/00.legacy-redirects.ts     runs BEFORE 00.locale-market.ts
KV key  legacy:redirects:{tenantId}          same mount as tenant:config:
```

- **Ordering.** Nitro sorts server middleware by filename, and `00.legacy-redirects.ts`
  sorts before `00.locale-market.ts`. Relying on that alphabetical accident is too subtle
  for something this load-bearing — number it explicitly (e.g. renaming the existing pair to
  `01.`/`02.` would be cleaner, but that edits tracked files, so it is a call for review).
  Running first is what buys the single 301 instead of a 302→301 pair.
- **Zero cost on normal traffic.** The middleware reads the map's own top-level path
  segments (`produkter`, `varumarken`, plus the CMS roots) as its guard set and returns
  immediately for anything outside it. Today's hot paths (`/se/sv/p/…`, `/se/sv/c/…`)
  never touch the map.
- **No tenant-config schema change.** The presence of `legacy:redirects:{tenantId}` in KV
  _is_ the feature switch. This matters: CLAUDE.md requires tenant-config fields to be
  optional-with-a-default because tenants are configured externally and cannot know about a
  new field. Adding no field sidesteps the compatibility question entirely. Memoize both the
  hit and the miss per tenant per worker, so a tenant with no map pays one KV read per cold
  start and nothing after.
- **Nothing Odelco-specific in source.** The Odelco map is data in KV; the code is generic.
- **On a miss, fall through — never 404 from the middleware.** Existing behaviour is
  preserved exactly: `00.locale-market` → catch-all → ADR-019 resolver → 404.

The matcher is ~25 lines. `resolveLegacyPath()` in
[`infra/scripts/generate-legacy-redirects.mjs`](./generate-redirects.mjs) is that function, with its assertions
already written — port it to `server/utils/` and keep the two in lockstep.

### Redirect semantics

- **301** for every mapped row. Permanent, and we want the link equity to move.
- **410 Gone**, not a redirect, for a discontinued product with no successor. Rule 8's
  ancestor fallback deliberately does **not** reach root-level product URLs: redirecting
  `/produkter/ekrano-gx-info` into a 3,470-item list is a soft 404 in Google's eyes and is
  worse than an honest 410. This is why `/produkter` → `/se/sv/products` is an **exact** row
  and never an **ancestor** row; there is an assertion pinning that distinction.
- **Preserve the query string?** No. Every query on an old URL (`clearCart`, `layout`,
  `limitstart`) is VirtueMart machinery with no meaning in the new app. Drop it.

## 6. Scale

Measured, not estimated — Geins Merchant API against channel `1|se`, 2026-09-21.

|            | Geins (new) | Old site (crawl-discovered)       |
| ---------- | ----------- | --------------------------------- |
| Products   | **3,470**   | 644 distinct `-info` URLs reached |
| Categories | **45**      | 217 distinct paths, 6 top-level   |
| Brands     | **22**      | 18                                |
| CMS pages  | **7**       | ~20 content-ish paths             |

Generated map: **75 exact + 3,470 articleNumber + 28 ancestor = 3,573 rows, 356 KB JSON.**
Small enough to hold in memory per worker; too large for `routeRules` or a CDN ruleset.

Coverage of the 900 distinct old URLs the crawl reached: **860 (95.6%)** —
62 exact, 614 articleNumber, 184 ancestor. The 40 misses are enumerated in
`redirects.sample.coverage.json` and broken down in §9.

## 7. Data needed

Everything except the curated rows comes from one read-only source.

| Need                                     | Source                                       | Have it?                                                                             |
| ---------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| Product `articleNumber` → `canonicalUrl` | Geins `products(filter:{sort:ALPHABETICAL})` | yes, 3,470                                                                           |
| Category alias → `canonicalUrl`          | Geins `categories`                           | yes, 45                                                                              |
| Brand alias → `canonicalUrl`             | Geins `brands`                               | yes, 22                                                                              |
| CMS aliases                              | Geins `cmsPages`                             | yes, 7                                                                               |
| Market/locale prefix                     | Geins `channel`                              | yes, `/se/sv`                                                                        |
| Old URL inventory                        | crawl (no sitemap exists)                    | **partial** — see §9                                                                 |
| Old→new category decisions               | human                                        | 32 drafted in `infra/scripts/legacy-redirects.overrides.odelco.json`, **unreviewed** |

> **A paging trap worth knowing about.** `products(skip,take)` without an explicit sort
> returns an unstable page order. A full `0..3470` sweep at `take:200` returned 3,470 rows
> but only **2,801 distinct products** — 669 silently lost and 669 silently duplicated. With
> `filter:{sort:ALPHABETICAL}`, rows == count == distinct == 3,470. The generator asserts
> this and refuses to write a map if it ever stops holding. A redirect map built without that
> sort would have quietly 404'd a fifth of the catalog. (`take` caps at 200, `skip` at 6000.)

## 8. Rollout

1. **Review the curated rows.** `infra/scripts/legacy-redirects.overrides.odelco.json`, ~75 rows, `_review` keys flag every
   judgement call. This needs someone who knows the catalog — several rows are "closest
   surviving parent", not equivalents.
2. **Hand-map the ~30 discontinued products**, or accept 410 for them. Some have obvious
   successors (`ekrano-gx` → `BPP900480100`; `NGW-1-USB` → `NGX-1-USB`); some are genuinely
   gone (`BAT412151104` returns 0 results in Geins search).
3. **Port `resolveLegacyPath()`** into `server/utils/` and add
   `server/middleware/00.legacy-redirects.ts`, with the ordering assertion from §5.
4. **Regenerate and load into KV** at `legacy:redirects:odelco`. Regeneration takes ~40s.
5. **Verify before DNS moves.** Replay the crawl inventory against a preview deployment and
   assert the 95.6% figure holds end-to-end, not just in the generator's own report.
6. **Cut DNS.** Keep the old host reachable if possible; if the Joomla site is decommissioned
   at cutover there is no second chance to enumerate URLs.
7. **Submit the new sitemap** (sales-portal already serves one via
   `server/api/__sitemap__/urls.ts`) and watch Search Console's coverage report for 60–90
   days. Real 404 logs will find the URLs the crawl could not.
8. **Expire the map after ~12 months.** Write the date down now. Redirect maps are exactly
   the kind of thing that outlives its usefulness and becomes load-bearing by accident.

## 9. What I could not determine

Listed most-consequential first. Every one of these is a real gap, not a hedge.

1. **Whether odelco.se is the right migration source at all.** The brief said ralph; the live
   site is Joomla/VirtueMart. I am confident about _what each system is_ (§1 evidence), but
   not about which one the business considers "current". If there is an Odelco ralph
   deployment I could not find, §4.1 maps the wrong site and §4.2 maps the right one. **A
   human confirming "odelco.se is what customers use today" settles this in one sentence.**

2. **The true size of the old URL inventory.** No sitemap exists, so my crawl is
   link-reachable only: 701 pages fetched, 900 distinct URLs after normalisation, against
   3,470 products in Geins. Orphaned-but-indexed URLs — discontinued products, old blog
   posts, campaign landing pages — are invisible to a crawler and are exactly the URLs with
   aged inbound links. **A Google Search Console "Pages" export for odelco.se would settle
   this**, and would also rank the map by actual traffic instead of by crawl reachability.
   Rule 1 is inventory-independent (it keys on `articleNumber`, so it covers all 3,470
   products whether or not I crawled them), but rules 2 and 6 are only as complete as the
   inventory.

3. **Non-SEF VirtueMart URLs.** `/index.php?option=com_virtuemart&view=productdetails&virtuemart_product_id=NNN`
   carries a numeric VirtueMart product ID with no bridge to any Geins field. If those are
   indexed, mapping them needs a VirtueMart DB export (`#__virtuemart_products` joined to
   `product_sku`). I found none in the crawl, but the crawl only sees linked URLs and the
   site serves SEF URLs internally — absence here is weak evidence.

4. **~30 products on the old site with no Geins counterpart** (4.7% of crawled product URLs).
   I spot-checked three and they are three different failure modes: article number changed
   (`ekrano-gx` → `BPP900480100`), superseded model (`NGW-1-USB` → `NGX-1-USB`), and genuinely
   discontinued (`BAT412151104`, 0 search hits). Only a human with the catalog can sort these.

5. **Four CMS areas with no target**: `/blog` and its posts, `/in-english`, the editorial
   `/det-har-ar-nmea-2000`, and `/produkter/utbildningar`. Geins has 7 CMS pages; the old
   site has more content than that. Decision needed: rebuild in Geins CMS, redirect to a
   related page, or 410.

6. **`/varumarken` (the brand index) has no destination.** sales-portal has no
   `app/pages/b/index.vue`. Either build one or accept the 404.

7. **Whether an English locale is coming.** The channel serves `sv-SE` only, so `/in-english`
   has nowhere to land today. If an `en` locale is planned, that row should wait rather than
   be redirected somewhere wrong and then re-redirected.

8. **Traffic weighting.** I can rank by crawl depth but not by value. Without analytics or
   Search Console data I cannot tell you which 20 of these 3,573 rows carry 80% of the
   inbound links — which is the list you would actually want to verify by hand.

## 10. Files

| File                                                   | What it is                                               | In git?                         |
| ------------------------------------------------------ | -------------------------------------------------------- | ------------------------------- |
| `docs/migration/odelco-legacy-redirects.md`            | this document                                            | yes                             |
| `infra/scripts/generate-legacy-redirects.mjs`          | the generator + `resolveLegacyPath()` + self-check       | yes                             |
| `infra/scripts/legacy-redirects.overrides.odelco.json` | the ~75 curated rows, `_review` keys flag open questions | yes                             |
| the 3,573-row map                                      | 356 KB of tenant data                                    | **no — generated, lives in KV** |
| the coverage report                                    | lists the misses                                         | **no — generated**              |

The map itself is deliberately not committed. It is tenant-specific data, it goes
stale silently the moment the catalogue moves, and it regenerates in well under a
minute. Its home is KV at `legacy:redirects:<tenantId>`, alongside
`tenant:config:`. The numbers quoted throughout this document come from a real
run against the live Geins API on 2026-09-21.

Run it:

```bash
node infra/scripts/generate-legacy-redirects.mjs --selfcheck

GEINS_API_KEY=<odelco merchant api key> \
GEINS_CHANNEL_ID='1|se' \
  node infra/scripts/generate-legacy-redirects.mjs \
    --out redirects.json \
    --overrides infra/scripts/legacy-redirects.overrides.odelco.json \
    --inventory crawl.json          # optional: coverage report only
```

Node ≥ 18, no dependencies, no repo imports. `GEINS_API_KEY` and `GEINS_CHANNEL_ID` are
required and it **exits non-zero with a specific message** rather than writing an empty or
partial map — including if product paging ever goes lossy again (§7).

Read-only: the Merchant API exposes no catalog mutations, every call is a GraphQL query over
HTTP GET, and the generator writes nothing but its own output files.
