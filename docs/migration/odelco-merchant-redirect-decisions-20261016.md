---
title: Odelco redirect decisions — Jonas / 2026-10-16
status: merchant-partial-approval
created: 2026-10-16
tags: [odelco, seo, redirects, migration]
---

# Odelco redirect decisions (Jonas, 16 October 2026)

This is **content approval only**, not permission to activate redirects or
modify DNS. The runtime feature is still disabled; a fresh map, staging
acceptance, and release approval are required.

## Approved by Jonas — implemented in curated overrides

| Old URL | Decision |
| --- | --- |
| `/varumarken` | `/se/sv/varumarken` (staging returns 200; route/content must be confirmed in acceptance) |
| `/in-english` | Swedish homepage `/se/sv/` pending an English site |
| `/blog` **and descendants under** `/blog/*` | Homepage `/se/sv/` (explicit exact + ancestor rule). Other historic blog URL shapes need inventory evidence |
| `/cookies` | Existing `/se/sv/integritetspolicy` mapping approved |
| `/varumarken/arco-marine`, `/varumarken/sol-go` | Existing auto brand aliases verified by Jonas |
| `/varumarken/star` | Brand `safiery` — STAR is a Safiery product series, not a standalone brand |
| `/produkter/digital-switching/kontakter-och-hus` | Keep closest `kontaktdon` category |
| `/produkter/kontroll-ochovervakning/elektricitet-ac-dc` | Keep `kontroll-overvakning` parent |
| `/produkter/stroemfoersoerjning/generering-av-stroem` | Change from narrower `generatorer` to broader `stromforsorjning` category |
| `/produkter/stroemfoersoerjning/laddare-och-omvandlare` | Change from narrower `batteriladdare` to broader `stromforsorjning-1` |
| `/produkter` | Keep existing exact `/se/sv/products`; never a catch-all ancestor for missing products |

**SEO note:** mapping a blog article directly to a general homepage may be
considered a soft 404 by search engines. These choices follow Jonas's requested
destinations but still need staging/SEO acceptance, and should be revised if
Search Console shows high-value posts with more relevant replacement content.
Avoid preserving old VirtueMart `clearCart`, `layout`, etc. query parameters at
rollout: the middleware currently preserves the query and needs a separate
sanitization/attribution decision before activation.

### Current category alias check (staging, 16 October)

Read-only category API checks confirmed that `stromforsorjning-1` now resolves
to the canonical published alias `stromforsorjning` and `sakerhet-1` resolves
to `sakerhet`. All 21 distinct category aliases referenced by our overrides
were checked: these were the only two stale aliases. The override file now
uses the current published aliases, so fresh Geins regeneration will not
silently skip those rows. This check is not equivalent to a successful map
regeneration and does not authorize redirect activation.

## Still awaiting Jörgen (do not guess)

1. **Nelco** — Jonas reports the brand exists in Geins, but currently has no
   products. Jörgen must decide whether old links should point to an empty
   brand page, a product successor, or be left without a redirect.
2. **`/produkter/utbildningar`** — choose replacement information page or 404/410.
3. **`/det-har-ar-nmea-2000`** — Jonas proposes the `NMEA 2000 nätverk`
   category. Jörgen must confirm the editorial/SEO intent.

Jonas is also asking Jörgen for **Google Analytics/Search Console access or a
Pages export of the old odelco.se URLs**, to extend the historic link-reachable
crawl with actually indexed and visited URLs.

## Missing ~30 old product URLs (requested by Jonas)

The 21 September analysis reported 614 direct product matches out of 644
distinct crawled `-info` URLs; **this is an older crawl, not a current SKU
audit**. Its generated `redirects.sample.coverage.json`, historic
`crawl.json`, and redirect map were **not committed** to the repository
(the legacy proposal's §10 explicitly says so). Do not invent the list or
pretend all 30 are distinct SKUs — historic URLs may repeat the same product.

This PR extends the standalone generator's `--inventory` mode to write:

- `<out-stem>.missing-products.csv`: `old_url`, `old_path`,
  `legacy_article_number_or_slug`, `ancestor_fallback`.
- `<out-stem>.coverage.json`: existing coverage counts and unmatched paths.

Crucially, **`missing-products.csv` lists every `-info` URL without a
direct articleNumber match even if generic ancestor fallback would otherwise
count it as "covered"**. The URL leaf is only a candidate identifier; Jörgen
must confirm actual old article numbers in Joomla/VirtueMart and potential
new Geins successor articles.

### Read-only report generation (future controlled step)

Provide an old-site inventory JSON of the format
`{"all_discovered":["/produkter/abc-info", ...]}` from the original crawl
or Search Console URL export. Using **approved read-only** Geins credentials
already available to the authorized migration operator, run the documented
`generate-legacy-redirects.mjs --out ... --overrides ... --inventory ...`
command. Inspect the CSV before sharing it with Jörgen. No keys, passwords,
customer prices or API responses need to be posted into GitHub.

Historical manually spot-checked examples (not a complete list):
`ekrano-gx` → candidate successor `BPP900480100`;
`NGW-1-USB` → candidate `NGX-1-USB`;
`BAT412151104` → no Geins match in the old 2026-09-21 snapshot.
All three require fresh Geins/catolog confirmation.

**Release gate:** no KV write, flag change, 301 rollout or DNS change based
on this document alone. Keep unresolved mappings pending Jörgen.
