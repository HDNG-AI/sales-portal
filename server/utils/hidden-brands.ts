/**
 * Pure helpers for hiding a tenant's brands from part of its audience.
 *
 * The list itself is the portal-owned `catalog.guestHiddenBrandIds` override
 * (see setTenantGuestHiddenBrands in ./tenant-crud.ts); who it applies to is
 * decided in ./guest-hidden-brands.ts. Nothing here reads a request, so the
 * rules below can be asserted without one.
 *
 * Two mechanisms, and which one applies is not a matter of taste:
 *
 *  - A product listing is filtered in the Geins query itself, through the
 *    `excludeBrandIds` field of FilterInputType. Counts, facets and pages then
 *    come from Geins already without the hidden brands.
 *  - A lookup by identity cannot be filtered that way. `product(alias)` and
 *    `relatedProducts(alias)` take no filter, and a FilterInputType carrying
 *    `productIds` or `articleNumbers` makes Geins ignore every other field,
 *    `excludeBrandIds` included. Those results are checked product by product
 *    against `brand.brandId`, which every such query must therefore select.
 */

/** The admin API accepts at most this many brand ids per tenant. */
export const MAX_HIDDEN_BRAND_IDS = 500;

/**
 * The positive integer brand ids in `raw`, deduplicated, in first-seen order.
 * Anything that is not an array yields an empty list. Used on every read of a
 * stored list, so a malformed KV value can narrow the list but never break a
 * request.
 */
export function normalizeBrandIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const ids = raw.filter(
    (id): id is number => Number.isInteger(id) && (id as number) > 0,
  );
  return [...new Set(ids)];
}

/**
 * Adds the hidden brands to a Geins FilterInputType. A caller-supplied
 * `excludeBrandIds` is kept and extended, never replaced, so a filter that
 * arrives from the client (CMS widgets forward theirs verbatim) cannot widen
 * what is shown. An empty list returns the filter untouched, `undefined`
 * included, so the query is exactly what it was without the setting.
 */
export function withHiddenBrandsExcluded(
  filter: Record<string, unknown> | undefined,
  hiddenBrandIds: readonly number[],
): Record<string, unknown> | undefined {
  if (hiddenBrandIds.length === 0) return filter;
  const requested = normalizeBrandIds(filter?.excludeBrandIds);
  return {
    ...filter,
    excludeBrandIds: [...new Set([...requested, ...hiddenBrandIds])],
  };
}

function isNonEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Whether Geins will ignore `excludeBrandIds` for this filter: a list of
 * product ids or article numbers turns off every other filter field.
 */
export function isIdentityLookup(
  filter: Record<string, unknown> | undefined,
): boolean {
  return (
    isNonEmptyArray(filter?.productIds) ||
    isNonEmptyArray(filter?.articleNumbers)
  );
}

/**
 * The filter without `productIds` and `articleNumbers`, so Geins applies the
 * rest of it, `excludeBrandIds` included. For the facet endpoint, whose
 * answer cannot be checked product by product and which no storefront page
 * asks for an id lookup.
 */
export function withoutIdentityLookup(
  filter: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!filter || !isIdentityLookup(filter)) return filter;
  const rest = { ...filter };
  delete rest.productIds;
  delete rest.articleNumbers;
  return rest;
}

/**
 * The brand id behind a brand page, looked up by alias in the Geins `brands`
 * list (alias, brandId). The page info itself carries an `id` that is not
 * documented as the brand id, so it is not relied on.
 */
export function findBrandIdByAlias(
  brands: unknown,
  aliases: readonly (string | null | undefined)[],
): number | undefined {
  if (!Array.isArray(brands)) return undefined;
  const wanted = new Set(
    aliases.filter((a): a is string => typeof a === 'string' && a.length > 0),
  );
  for (const brand of brands) {
    if (!brand || typeof brand !== 'object') continue;
    const { alias, brandId } = brand as { alias?: unknown; brandId?: unknown };
    if (
      typeof alias === 'string' &&
      wanted.has(alias) &&
      typeof brandId === 'number'
    ) {
      return brandId;
    }
  }
  return undefined;
}

/** `product.brand.brandId`, when the response carries one. */
export function brandIdOf(product: unknown): number | undefined {
  if (!product || typeof product !== 'object') return undefined;
  const brand = (product as { brand?: unknown }).brand;
  if (!brand || typeof brand !== 'object') return undefined;
  const id = (brand as { brandId?: unknown }).brandId;
  return typeof id === 'number' && Number.isInteger(id) ? id : undefined;
}

/** Whether a single product belongs to one of the hidden brands. */
export function isHiddenBrandProduct(
  product: unknown,
  hiddenBrandIds: readonly number[],
): boolean {
  if (hiddenBrandIds.length === 0) return false;
  const id = brandIdOf(product);
  return id !== undefined && hiddenBrandIds.includes(id);
}

/**
 * Removes hidden-brand products from a lookup result: either a bare array or
 * a `{ products, count }` object, whose `count` drops by the number removed.
 * For lookups by identity only (see the module comment); a listing gets
 * `excludeBrandIds` in its query instead. Returns the input itself when
 * nothing is hidden or nothing matched, and a copy otherwise. An id lookup
 * paged with skip/take gets its count corrected for the page at hand only;
 * the hidden products themselves never come through.
 */
export function withoutHiddenBrandProducts<T>(
  result: T,
  hiddenBrandIds: readonly number[],
): T {
  if (hiddenBrandIds.length === 0) return result;

  if (Array.isArray(result)) {
    const kept = result.filter(
      (product) => !isHiddenBrandProduct(product, hiddenBrandIds),
    );
    return (kept.length === result.length ? result : kept) as T;
  }

  if (!result || typeof result !== 'object') return result;
  const list = (result as { products?: unknown }).products;
  if (!Array.isArray(list)) return result;

  const kept = list.filter(
    (product) => !isHiddenBrandProduct(product, hiddenBrandIds),
  );
  const removed = list.length - kept.length;
  if (removed === 0) return result;

  const count = (result as { count?: unknown }).count;
  return {
    ...result,
    products: kept,
    ...(typeof count === 'number'
      ? { count: Math.max(0, count - removed) }
      : {}),
  };
}
