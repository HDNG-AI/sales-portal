#!/usr/bin/env node
/**
 * Build a legacy -> sales-portal 301 redirect map for ONE tenant from Geins data.
 *
 * Standalone: Node >= 18, no dependencies, no repo imports.
 *
 *   GEINS_API_KEY=... GEINS_CHANNEL_ID='1|se' \
 *     node generate-redirects.mjs --out redirects.json \
 *       [--overrides overrides.json] [--inventory data/crawl.json]
 *
 * Env:
 *   GEINS_API_KEY       (required) Geins Merchant API key. Read-only; the
 *                       Merchant API exposes no mutations for catalog data.
 *   GEINS_CHANNEL_ID    (required) e.g. '1|se'.
 *   GEINS_API_ENDPOINT  (optional) default https://merchantapi.geins.io/graphql
 *   GEINS_LANGUAGE_ID   (optional) default: channel.defaultLanguageId
 *   GEINS_MARKET_ID     (optional) default: channel.defaultMarketId
 *
 * Flags:
 *   --out <file>        (required) output path for the map
 *   --overrides <file>  hand-curated old->new rows the API cannot derive
 *                       (category taxonomy, renamed brands, CMS aliases)
 *   --inventory <file>  crawl.json {all_discovered:[...]} — only used to
 *                       REPORT what the map fails to cover. Never required.
 *   --selfcheck         run the built-in assertions and exit
 *
 * Exits non-zero with a specific message on any missing input. It never
 * writes a map it could not populate from the API.
 */

import { writeFileSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Path transforms. These mirror shared/utils/route-helpers.ts
// (alternateEntityPath) and shared/utils/menu.ts (GEINS_TYPE_MAP) in the
// sales-portal repo. Duplicated deliberately: this script must run standalone,
// outside the Nuxt build. If the app's helpers change, change these to match.
// ---------------------------------------------------------------------------

/** Geins single/two-letter entity prefixes that appear in canonical URLs. */
const GEINS_PREFIXES = new Set(['p', 'c', 'b', 'l', 's', 'dc']);

/** Entity type -> the app route prefix (ADR-015). Geins uses /l/ for BOTH
 *  categories and brands, so the type must come from the query that produced
 *  the URL — never guessed from the URL itself. */
const APP_PREFIX = { product: 'p', category: 'c', brand: 'b' };

/**
 * Geins canonicalUrl -> sales-portal app path.
 *   ('/se/sv/p/cat/sub/item', 'product')  -> '/se/sv/p/cat/sub/item'
 *   ('/se/sv/l/digital-switching', 'category') -> '/se/sv/c/digital-switching'
 *   ('/se/sv/l/actisense', 'brand')       -> '/se/sv/b/actisense'
 * Returns null for anything it cannot build a safe internal path from.
 */
export function toAppPath(canonicalUrl, type) {
  if (typeof canonicalUrl !== 'string' || !canonicalUrl.startsWith('/')) return null;
  if (canonicalUrl.startsWith('//')) return null;
  const prefix = APP_PREFIX[type];
  if (!prefix) return null;

  const segments = canonicalUrl.split('?')[0].split('#')[0].split('/').filter(Boolean);
  if (segments.length < 3) return null;
  const [market, locale] = segments;
  if (!/^[a-z]{2}$/.test(market) || !/^[a-z]{2}$/.test(locale)) return null;

  let rest = segments.slice(2);
  if (GEINS_PREFIXES.has(rest[0])) rest = rest.slice(1);
  if (rest.length === 0) return null;

  return `/${market}/${locale}/${prefix}/${rest.join('/')}`;
}

/** VirtueMart / Joomla listing noise that carries no meaning in the new app. */
const NOISE = /\/(dirDesc|dirAsc|results,[\d-]+|by,[^/]+|orderby[^/]*)$/;

/**
 * Normalise an inbound legacy path for lookup: percent-decode, drop the query
 * and hash, strip the trailing slash, and peel VirtueMart's sort/paging
 * segments. `/produkter/x/results,1-0?clearCart=0` and `/produkter/x/dirDesc`
 * both normalise to `/produkter/x`.
 */
export function normalizeLegacyPath(rawPath) {
  let p = rawPath.split('?')[0].split('#')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* malformed %-escape: match on the raw form */
  }
  p = p.replace(/\/+$/, '') || '/';
  let prev = null;
  while (prev !== p) {
    prev = p;
    p = p.replace(NOISE, '');
  }
  return p.toLowerCase();
}

/**
 * Resolve one legacy path against the map. THIS IS THE FUNCTION THE SERVER
 * MIDDLEWARE SHOULD PORT — keep the two in lockstep.
 *
 * Order matters:
 *   1. exact          — curated + derived rows (categories, brands, CMS).
 *   2. articleNumber  — any path whose last segment is `<articleNumber>-info`,
 *                       at any depth. The old site served the same product at
 *                       /produkter/<an>-info AND /produkter/<cat>/<an>-info,
 *                       so matching the suffix beats enumerating ancestors.
 *   3. ancestor       — longest mapped prefix, for a discontinued product or a
 *                       retired sub-category. Lands the visitor on the nearest
 *                       surviving list page instead of a 404.
 * Returns null when nothing matches; the caller must then fall through to the
 * normal pipeline (locale-market -> catch-all -> ADR-019 resolver -> 404).
 */
export function resolveLegacyPath(map, rawPath) {
  const path = normalizeLegacyPath(rawPath);

  const exact = map.exact[path];
  if (exact) return { to: exact, via: 'exact' };

  const leaf = path.slice(path.lastIndexOf('/') + 1);
  if (leaf.endsWith('-info')) {
    const an = leaf.slice(0, -'-info'.length);
    const hit = map.articleNumber[an];
    if (hit) return { to: hit, via: 'articleNumber' };
  }

  // Only `ancestor` rows are walked. An `exact` row is exact by definition, so
  // mapping `/produkter` -> the all-products page cannot quietly turn into a
  // catch-all that swallows every dead product URL into a soft 404.
  for (let cut = path.lastIndexOf('/'); cut > 0; cut = path.lastIndexOf('/', cut - 1)) {
    const hit = map.ancestor[path.slice(0, cut)];
    if (hit) return { to: hit, via: 'ancestor' };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Geins Merchant API (read-only GraphQL queries over GET).
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`\n[generate-redirects] ${msg}\n`);
  process.exit(1);
}

async function gql(endpoint, apiKey, query) {
  const url = `${endpoint}?query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: {
      'X-ApiKey': apiKey,
      // Geins rejects GET GraphQL without this CSRF preflight marker.
      'GraphQL-Require-Preflight': '1',
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) fail(`Geins API HTTP ${res.status} for query: ${query.slice(0, 90)}…`);
  if (body.errors?.length) fail(`Geins API error: ${body.errors.map((e) => e.message).join('; ')}`);
  return body.data;
}

const chan = (c) => `channelId:"${c.channelId}",languageId:"${c.languageId}",marketId:"${c.marketId}"`;

/**
 * Page the whole product catalog.
 *
 * `filter:{sort:ALPHABETICAL}` is NOT cosmetic. Without an explicit sort the
 * API's page order is unstable across requests: a full 0..count sweep of
 * odelco returned 3470 rows but only 2801 distinct products — 669 silently
 * lost, 669 silently duplicated. With the sort, rows === count === distinct.
 * The assertion below is what stops that regression reaching a redirect map.
 */
async function fetchAllProducts(endpoint, apiKey, c) {
  const TAKE = 200; // API hard cap: skip <= 6000, take <= 200.
  const byId = new Map();
  let total = null;
  let rows = 0;

  for (let skip = 0; total === null || skip < total; skip += TAKE) {
    const d = await gql(
      endpoint,
      apiKey,
      `{ products(${chan(c)},skip:${skip},take:${TAKE},filter:{sort:ALPHABETICAL}){
           count products{ productId articleNumber canonicalUrl name } } }`,
    );
    const node = d.products;
    total = node.count;
    rows += node.products.length;
    for (const p of node.products) byId.set(p.productId, p);
    process.stderr.write(`\r  products ${byId.size}/${total}`);
    if (node.products.length === 0) break;
    if (skip + TAKE > 6000) break; // API skip ceiling
  }
  process.stderr.write('\n');

  if (byId.size !== total || rows !== total) {
    fail(
      `Product paging is lossy: API count=${total}, rows fetched=${rows}, distinct=${byId.size}. ` +
        `Refusing to emit a partial map. Check that filter:{sort:ALPHABETICAL} is still honoured.`,
    );
  }
  return [...byId.values()];
}

// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const flag = (n) => {
    const i = args.indexOf(n);
    return i === -1 ? null : args[i + 1];
  };

  if (args.includes('--selfcheck')) return selfcheck();

  const out = flag('--out');
  if (!out) fail('Missing --out <file>.');

  const apiKey = process.env.GEINS_API_KEY;
  const channelId = process.env.GEINS_CHANNEL_ID;
  if (!apiKey) fail('GEINS_API_KEY is not set. Cannot derive a map without it; refusing to write an empty file.');
  if (!channelId) fail("GEINS_CHANNEL_ID is not set (e.g. '1|se'). Refusing to guess the channel.");
  const endpoint = process.env.GEINS_API_ENDPOINT || 'https://merchantapi.geins.io/graphql';

  // --- channel: gives the /{market}/{locale} prefix the new URLs must carry.
  const { channel } = await gql(
    endpoint,
    apiKey,
    `{ channel(channelId:"${channelId}"){ id name url defaultMarketId defaultLanguageId
         markets{ id alias } languages{ id code } } }`,
  );
  if (!channel) fail(`Channel "${channelId}" not found for this API key.`);

  const languageId = process.env.GEINS_LANGUAGE_ID || channel.defaultLanguageId;
  const marketId = process.env.GEINS_MARKET_ID || channel.defaultMarketId;
  const marketAlias = channel.markets.find((m) => m.id === marketId)?.alias;
  const localeCode = channel.languages.find((l) => l.id === languageId)?.code;
  if (!marketAlias) fail(`Market "${marketId}" is not on channel "${channelId}".`);
  if (!localeCode) fail(`Language "${languageId}" is not on channel "${channelId}".`);
  const prefix = `/${marketAlias}/${localeCode}`;
  const c = { channelId, languageId, marketId };

  console.error(`[generate-redirects] channel=${channel.name} prefix=${prefix}`);

  // --- catalog
  const products = await fetchAllProducts(endpoint, apiKey, c);
  const { categories } = await gql(endpoint, apiKey, `{ categories(${chan(c)}){ categoryId alias canonicalUrl name } }`);
  const { brands } = await gql(endpoint, apiKey, `{ brands(${chan(c)}){ brandId alias canonicalUrl name } }`);
  const { cmsPages } = await gql(endpoint, apiKey, `{ cmsPages(${chan(c)}){ id alias title } }`);
  console.error(
    `[generate-redirects] products=${products.length} categories=${categories.length} ` +
      `brands=${brands.length} cmsPages=${cmsPages.length}`,
  );

  const rawOverrides = flag('--overrides')
    ? JSON.parse(readFileSync(flag('--overrides'), 'utf8'))
    : {};
  // `_`-prefixed keys are notes for humans (`_README`, `_review`), not rows.
  const rows = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));
  const overrides = {
    category: rows(rawOverrides.category),
    brand: rows(rawOverrides.brand),
    cms: rows(rawOverrides.cms),
    exact: rows(rawOverrides.exact),
  };

  const catByAlias = new Map(categories.map((x) => [x.alias.toLowerCase(), x]));
  const brandByAlias = new Map(brands.map((x) => [x.alias.toLowerCase(), x]));

  const map = { exact: {}, articleNumber: {}, ancestor: {} };
  const skipped = [];

  // --- products: keyed by articleNumber, matched as a `-info` leaf at any depth.
  for (const p of products) {
    const an = (p.articleNumber || '').trim().toLowerCase();
    const to = toAppPath(p.canonicalUrl, 'product');
    if (!an || !to) {
      skipped.push({ kind: 'product', id: p.productId, reason: !an ? 'no articleNumber' : 'bad canonicalUrl' });
      continue;
    }
    map.articleNumber[an] = to;
  }

  // --- brands: /varumarken/<slug>. Auto-match identical aliases; the rest
  //     come from overrides.brand (old slug -> Geins alias).
  for (const b of brands) {
    const to = toAppPath(b.canonicalUrl, 'brand');
    if (to) map.exact[`/varumarken/${b.alias.toLowerCase()}`] = to;
  }
  for (const [oldSlug, geinsAlias] of Object.entries(overrides.brand || {})) {
    const b = brandByAlias.get(String(geinsAlias).toLowerCase());
    if (!b) {
      skipped.push({ kind: 'brand-override', from: oldSlug, reason: `no Geins brand "${geinsAlias}"` });
      continue;
    }
    const to = toAppPath(b.canonicalUrl, 'brand');
    if (to) map.exact[normalizeLegacyPath(`/varumarken/${oldSlug}`)] = to;
  }

  // --- categories: the old taxonomy does not survive slug normalisation
  //     (see PROPOSAL.md §Mapping rules), so every row is curated.
  //     overrides.category: old path -> Geins category alias.
  //     A row ALSO becomes an ancestor-fallback entry for its descendants.
  for (const [oldPath, geinsAlias] of Object.entries(overrides.category || {})) {
    const cat = catByAlias.get(String(geinsAlias).toLowerCase());
    if (!cat) {
      skipped.push({ kind: 'category-override', from: oldPath, reason: `no Geins category "${geinsAlias}"` });
      continue;
    }
    const to = toAppPath(cat.canonicalUrl, 'category');
    if (!to) continue;
    const key = normalizeLegacyPath(oldPath);
    map.exact[key] = to;
    map.ancestor[key] = to;
  }

  // --- CMS: a Geins page alias that the old site also served at /<alias>
  //     is a pure prefix add. Anything renamed goes in overrides.cms.
  for (const page of cmsPages) {
    map.exact[`/${page.alias.toLowerCase()}`] = `${prefix}/${page.alias}`;
  }
  for (const [oldPath, alias] of Object.entries(overrides.cms || {})) {
    map.exact[normalizeLegacyPath(oldPath)] = `${prefix}/${alias}`;
  }

  // --- free-form curated rows (old path -> full new path, verbatim).
  for (const [from, to] of Object.entries(overrides.exact || {})) {
    map.exact[normalizeLegacyPath(from)] = to;
  }

  // --- validation: nothing self-referential, nothing off-origin.
  const bad = [];
  for (const section of ['exact', 'ancestor']) {
    for (const [from, to] of Object.entries(map[section])) {
      if (!to.startsWith(`${prefix}/`)) bad.push(`${section}: ${from} -> ${to} (wrong locale prefix)`);
      if (to === from) bad.push(`${section}: ${from} -> itself (redirect loop)`);
      if (to.includes('//') || to.includes('://')) bad.push(`${section}: ${from} -> ${to} (unsafe)`);
    }
  }
  for (const [an, to] of Object.entries(map.articleNumber)) {
    if (!to.startsWith(`${prefix}/`)) bad.push(`articleNumber: ${an} -> ${to} (wrong locale prefix)`);
  }
  if (bad.length) fail(`Validation failed:\n  ${bad.slice(0, 20).join('\n  ')}`);

  const doc = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: { endpoint, channelId, languageId, marketId, channelName: channel.name, legacyOrigin: channel.url },
    prefix,
    counts: {
      exact: Object.keys(map.exact).length,
      articleNumber: Object.keys(map.articleNumber).length,
      ancestor: Object.keys(map.ancestor).length,
    },
    ...map,
  };
  writeFileSync(out, `${JSON.stringify(doc, null, 1)}\n`);
  console.error(`[generate-redirects] wrote ${out}: ${JSON.stringify(doc.counts)}`);
  if (skipped.length) console.error(`[generate-redirects] skipped ${skipped.length} rows (see --inventory report)`);

  // --- coverage report against a crawled inventory of the OLD site.
  const invFile = flag('--inventory');
  if (!invFile) return;
  const discovered = JSON.parse(readFileSync(invFile, 'utf8')).all_discovered || [];
  const seen = new Set();
  const cover = { exact: 0, articleNumber: 0, ancestor: 0, unmapped: [] };
  for (const raw of discovered) {
    const p = normalizeLegacyPath(raw);
    if (p === '/' || seen.has(p)) continue;
    seen.add(p);
    const hit = resolveLegacyPath(map, p);
    if (hit) cover[hit.via]++;
    else cover.unmapped.push(p);
  }
  const total = seen.size;
  const covered = total - cover.unmapped.length;
  const report = `${out.replace(/\.json$/, '')}.coverage.json`;
  writeFileSync(
    report,
    `${JSON.stringify({ total, covered, pct: +((covered / total) * 100).toFixed(1), byRule: { exact: cover.exact, articleNumber: cover.articleNumber, ancestor: cover.ancestor }, skipped, unmapped: cover.unmapped.sort() }, null, 1)}\n`,
  );
  console.error(
    `[generate-redirects] coverage ${covered}/${total} (${((covered / total) * 100).toFixed(1)}%) ` +
      `exact=${cover.exact} articleNumber=${cover.articleNumber} ancestor=${cover.ancestor} -> ${report}`,
  );
}

// ---------------------------------------------------------------------------
// Self-check: the transforms are the only non-trivial logic here.
//   node generate-redirects.mjs --selfcheck
// ---------------------------------------------------------------------------
function selfcheck() {
  const eq = (got, want, label) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`);
      process.exitCode = 1;
    }
  };

  // toAppPath: Geins /l/ is ambiguous — type decides the app prefix.
  eq(toAppPath('/se/sv/p/kontroll/batt/str1-sender', 'product'), '/se/sv/p/kontroll/batt/str1-sender', 'product identity');
  eq(toAppPath('/se/sv/l/digital-switching', 'category'), '/se/sv/c/digital-switching', 'category /l/ -> /c/');
  eq(toAppPath('/se/sv/l/actisense', 'brand'), '/se/sv/b/actisense', 'brand /l/ -> /b/');
  eq(toAppPath('/se/sv/l/a/b/c', 'category'), '/se/sv/c/a/b/c', 'nested category');
  eq(toAppPath('https://evil.test/x', 'product'), null, 'absolute url rejected');
  eq(toAppPath('//evil.test/x', 'product'), null, 'protocol-relative rejected');
  eq(toAppPath('/se/sv', 'category'), null, 'too short rejected');
  eq(toAppPath('/se/sv/l', 'category'), null, 'prefix-only rejected');
  eq(toAppPath('/se/sv/l/x', 'nonsense'), null, 'unknown type rejected');

  // normalizeLegacyPath: VirtueMart paging/sort noise and %-escapes.
  eq(normalizeLegacyPath('/produkter/x/results,1-0?clearCart=0'), '/produkter/x', 'results, + query');
  eq(normalizeLegacyPath('/produkter/x/dirDesc'), '/produkter/x', 'dirDesc');
  eq(normalizeLegacyPath('/produkter/x/results,1-0/dirDesc'), '/produkter/x', 'stacked noise');
  eq(normalizeLegacyPath('/varumarken/actisense?layout=details'), '/varumarken/actisense', 'layout query');
  eq(normalizeLegacyPath('/produkter/elektricitet/batteri%C3%B6vervakning'), '/produkter/elektricitet/batteriövervakning', 'percent-decode');
  eq(normalizeLegacyPath('/produkter/BAM030710100-info'), '/produkter/bam030710100-info', 'case-fold');
  eq(normalizeLegacyPath('/produkter/x/'), '/produkter/x', 'trailing slash');
  eq(normalizeLegacyPath('/produkter/%ZZ-info'), '/produkter/%zz-info', 'malformed escape survives');

  // resolveLegacyPath: precedence and the ancestor walk.
  const map = {
    exact: { '/produkter/digital-switching': '/se/sv/c/digital-switching', '/om-odelco': '/se/sv/om-odelco' },
    articleNumber: { a3702: '/se/sv/p/nmea/adapters/maretron-a3702' },
    ancestor: { '/produkter/digital-switching': '/se/sv/c/digital-switching' },
  };
  eq(resolveLegacyPath(map, '/om-odelco'), { to: '/se/sv/om-odelco', via: 'exact' }, 'cms exact');
  eq(resolveLegacyPath(map, '/produkter/a3702-info'), { to: '/se/sv/p/nmea/adapters/maretron-a3702', via: 'articleNumber' }, 'flat product');
  // Same product, nested under a category path — the suffix rule covers both.
  eq(resolveLegacyPath(map, '/produkter/kontroll/givare/A3702-info'), { to: '/se/sv/p/nmea/adapters/maretron-a3702', via: 'articleNumber' }, 'nested product, mixed case');
  eq(resolveLegacyPath(map, '/produkter/digital-switching/results,2-0'), { to: '/se/sv/c/digital-switching', via: 'exact' }, 'category with paging noise');
  // Discontinued product / retired subcategory -> nearest surviving list page.
  eq(resolveLegacyPath(map, '/produkter/digital-switching/gone/dead-info'), { to: '/se/sv/c/digital-switching', via: 'ancestor' }, 'ancestor fallback');
  eq(resolveLegacyPath(map, '/totally/unknown'), null, 'miss falls through');
  eq(resolveLegacyPath(map, '/produkter/unmapped-info'), null, 'unknown article number falls through');
  // An exact row must NOT act as an ancestor: a discontinued product keeps its
  // honest 404 instead of being swept into the all-products list.
  const withRoot = { ...map, exact: { ...map.exact, '/produkter': '/se/sv/products' } };
  eq(resolveLegacyPath(withRoot, '/produkter'), { to: '/se/sv/products', via: 'exact' }, 'root listing maps');
  eq(resolveLegacyPath(withRoot, '/produkter/dead-info'), null, 'exact row is not an ancestor');

  console.error(process.exitCode ? 'selfcheck: FAILURES above' : 'selfcheck: all assertions passed');
}

main().catch((e) => fail(e?.stack || String(e)));
