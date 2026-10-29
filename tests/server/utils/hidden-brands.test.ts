import { describe, it, expect } from 'vitest';
import {
  MAX_HIDDEN_BRAND_IDS,
  normalizeBrandIds,
  withHiddenBrandsExcluded,
  isIdentityLookup,
  withoutIdentityLookup,
  brandIdOf,
  isHiddenBrandProduct,
  withoutHiddenBrandProducts,
  findBrandIdByAlias,
} from '../../../server/utils/hidden-brands';
import { loadQuery } from '../../../server/services/graphql/loader';

const HIDDEN = [7];

describe('normalizeBrandIds', () => {
  it('keeps positive integers once, in first-seen order', () => {
    expect(normalizeBrandIds([3, 7, 3, 12])).toEqual([3, 7, 12]);
  });

  it('drops anything that is not a positive integer', () => {
    expect(normalizeBrandIds([7, 0, -1, 1.5, '8', null, Number.NaN])).toEqual([
      7,
    ]);
  });

  it('reads a non-array as no list at all', () => {
    expect(normalizeBrandIds(undefined)).toEqual([]);
    expect(normalizeBrandIds(null)).toEqual([]);
    expect(normalizeBrandIds('7')).toEqual([]);
    expect(normalizeBrandIds({ 0: 7 })).toEqual([]);
  });

  it('caps the admin list at 500 ids', () => {
    expect(MAX_HIDDEN_BRAND_IDS).toBe(500);
  });
});

describe('withHiddenBrandsExcluded: merging into a client filter', () => {
  it('returns the filter untouched when nothing is hidden', () => {
    const filter = { facets: ['c_1'], sort: 'LATEST' };
    expect(withHiddenBrandsExcluded(filter, [])).toBe(filter);
    expect(withHiddenBrandsExcluded(undefined, [])).toBeUndefined();
  });

  it('creates a filter carrying only the exclusion when none was sent', () => {
    expect(withHiddenBrandsExcluded(undefined, HIDDEN)).toEqual({
      excludeBrandIds: [7],
    });
  });

  it('keeps every other field the client sent', () => {
    const filter = {
      include: ['c_12'],
      sort: 'ALPHABETICAL',
      searchText: 'pump',
    };
    expect(withHiddenBrandsExcluded(filter, HIDDEN)).toEqual({
      ...filter,
      excludeBrandIds: [7],
    });
  });

  it('cannot be undone by a client excludeBrandIds: it is extended, not replaced', () => {
    expect(withHiddenBrandsExcluded({ excludeBrandIds: [3] }, HIDDEN)).toEqual({
      excludeBrandIds: [3, 7],
    });
    expect(withHiddenBrandsExcluded({ excludeBrandIds: [] }, HIDDEN)).toEqual({
      excludeBrandIds: [7],
    });
  });

  it('replaces a malformed client excludeBrandIds instead of trusting it', () => {
    for (const excludeBrandIds of [null, 'none', { 7: false }, ['7'], 0]) {
      expect(withHiddenBrandsExcluded({ excludeBrandIds }, HIDDEN)).toEqual({
        excludeBrandIds: [7],
      });
    }
  });

  it('still excludes when the client asks to include the hidden brand', () => {
    expect(
      withHiddenBrandsExcluded({ brandIds: [7], include: ['b_7'] }, HIDDEN),
    ).toEqual({ brandIds: [7], include: ['b_7'], excludeBrandIds: [7] });
  });

  it('does not mutate the filter it was given', () => {
    const filter = { excludeBrandIds: [3] };
    withHiddenBrandsExcluded(filter, HIDDEN);
    expect(filter).toEqual({ excludeBrandIds: [3] });
  });
});

describe('identity lookups (Geins ignores other filter fields)', () => {
  it('recognises productIds and articleNumbers lookups', () => {
    expect(isIdentityLookup({ productIds: [1] })).toBe(true);
    expect(isIdentityLookup({ articleNumbers: ['A1'] })).toBe(true);
    expect(isIdentityLookup({ productIds: [] })).toBe(false);
    expect(isIdentityLookup({ facets: ['x'] })).toBe(false);
    expect(isIdentityLookup(undefined)).toBe(false);
  });

  it('drops the lookup fields for the facet endpoint and keeps the rest', () => {
    expect(
      withoutIdentityLookup({
        productIds: [1],
        articleNumbers: ['A1'],
        sort: 'LATEST',
      }),
    ).toEqual({ sort: 'LATEST' });
    const plain = { sort: 'LATEST' };
    expect(withoutIdentityLookup(plain)).toBe(plain);
    expect(withoutIdentityLookup(undefined)).toBeUndefined();
  });
});

describe('product-by-product checks for lookups', () => {
  const hiddenProduct = { productId: 1, brand: { brandId: 7, name: 'Hidden' } };
  const other = { productId: 2, brand: { brandId: 8, name: 'Other' } };
  const unbranded = { productId: 3, brand: null };

  it('reads the brand id off a product', () => {
    expect(brandIdOf(hiddenProduct)).toBe(7);
    expect(brandIdOf(unbranded)).toBeUndefined();
    expect(brandIdOf({ brand: { brandId: '7' } })).toBeUndefined();
    expect(brandIdOf(null)).toBeUndefined();
  });

  it('flags only products of a hidden brand', () => {
    expect(isHiddenBrandProduct(hiddenProduct, HIDDEN)).toBe(true);
    expect(isHiddenBrandProduct(other, HIDDEN)).toBe(false);
    expect(isHiddenBrandProduct(unbranded, HIDDEN)).toBe(false);
    expect(isHiddenBrandProduct(hiddenProduct, [])).toBe(false);
  });

  it('filters a bare array', () => {
    expect(withoutHiddenBrandProducts([hiddenProduct, other], HIDDEN)).toEqual([
      other,
    ]);
  });

  it('filters a { products, count } result and lowers its count', () => {
    expect(
      withoutHiddenBrandProducts(
        { products: [hiddenProduct, other, unbranded], count: 3 },
        HIDDEN,
      ),
    ).toEqual({ products: [other, unbranded], count: 2 });
  });

  it('returns the very same object when nothing is hidden or removed', () => {
    const result = { products: [other], count: 1 };
    expect(withoutHiddenBrandProducts(result, HIDDEN)).toBe(result);
    const all = { products: [hiddenProduct], count: 1 };
    expect(withoutHiddenBrandProducts(all, [])).toBe(all);
    expect(withoutHiddenBrandProducts(null, HIDDEN)).toBeNull();
  });

  it('does not mutate the Geins result', () => {
    const result = { products: [hiddenProduct, other], count: 2 };
    withoutHiddenBrandProducts(result, HIDDEN);
    expect(result).toEqual({ products: [hiddenProduct, other], count: 2 });
  });
});

describe('findBrandIdByAlias', () => {
  const brands = [
    { alias: 'other', brandId: 8 },
    { alias: 'hidden-brand', brandId: 7 },
  ];

  it('finds the brand by any of the given aliases', () => {
    expect(findBrandIdByAlias(brands, ['hidden-brand'])).toBe(7);
    expect(findBrandIdByAlias(brands, [undefined, 'hidden-brand'])).toBe(7);
  });

  it('returns undefined when no alias matches or the list is unusable', () => {
    expect(findBrandIdByAlias(brands, ['missing'])).toBeUndefined();
    expect(findBrandIdByAlias(null, ['hidden-brand'])).toBeUndefined();
    expect(findBrandIdByAlias([{ alias: 'x' }], ['x'])).toBeUndefined();
  });
});

describe('queries checked product by product select brand.brandId', () => {
  // A lookup is filtered on brand.brandId; a query that stopped selecting it
  // would let every hidden product through without any test failing.
  it.each([
    'products/product.graphql',
    'products/products-by-ids.graphql',
    'products/related-products.graphql',
    'search/search.graphql',
    'product-lists/products.graphql',
  ])('%s', (path) => {
    expect(loadQuery(path)).toMatch(/brand\s*\{[^}]*\bbrandId\b/);
  });
});
