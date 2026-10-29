import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

// ---------------------------------------------------------------------------
// Geins at the SDK boundary. The services and the guest rules run for real;
// only the Merchant API answers are canned, and every query is recorded so a
// test can assert what was asked of Geins, not just what came back.
// ---------------------------------------------------------------------------
const HIDDEN_PRODUCT = {
  productId: 1,
  alias: 'hidden-pump',
  name: 'Pump',
  brand: { brandId: 7, name: 'Hidden brand' },
};
const OPEN_PRODUCT = {
  productId: 2,
  alias: 'open-pump',
  name: 'Pump',
  brand: { brandId: 8, name: 'Open brand' },
};

interface QueryArgs {
  queryAsString: string;
  variables: Record<string, unknown>;
  userToken?: string;
}

const mockGraphqlQuery = vi.fn(
  async ({ queryAsString, variables }: QueryArgs) => {
    const filter = (variables.filter ?? {}) as Record<string, unknown>;
    switch (queryAsString) {
      case 'query:products/product.graphql':
        return {
          product:
            [HIDDEN_PRODUCT, OPEN_PRODUCT].find(
              (p) => p.alias === variables.alias,
            ) ?? null,
        };
      case 'query:product-lists/products.graphql':
        // An id lookup is answered as Geins does: every other field ignored.
        return {
          products: Array.isArray(filter.productIds)
            ? { products: [HIDDEN_PRODUCT, OPEN_PRODUCT], count: 2 }
            : { products: [OPEN_PRODUCT], count: 1 },
        };
      case 'query:product-lists/list-filters.graphql':
        return { products: { count: 1, filters: { facets: [] } } };
      case 'query:search/search.graphql':
        if (Array.isArray(filter.articleNumbers)) {
          return { products: { products: [HIDDEN_PRODUCT], count: 1 } };
        }
        return {
          products:
            filter.searchText === 'PUMP-007'
              ? { products: [], count: 0 }
              : { products: [OPEN_PRODUCT], count: 1 },
        };
      case 'query:products/products-by-ids.graphql':
        return {
          products: { products: [HIDDEN_PRODUCT, OPEN_PRODUCT], count: 2 },
        };
      case 'query:products/related-products.graphql':
        return { relatedProducts: [HIDDEN_PRODUCT, OPEN_PRODUCT] };
      case 'query:brands/brands.graphql':
        return {
          brands: [
            {
              alias: 'hidden-brand',
              brandId: 7,
              canonicalUrl: '/b/hidden-brand',
            },
            { alias: 'open-brand', brandId: 8, canonicalUrl: '/b/open-brand' },
          ],
        };
      case 'query:product-lists/brand-page.graphql':
        return {
          listPageInfo: { id: 900, alias: variables.alias, name: 'Brand' },
        };
      default:
        return null;
    }
  },
);

const mockSDK = {
  core: {
    geinsSettings: { channel: '1', locale: 'sv-SE', market: 'se' },
    graphql: { query: mockGraphqlQuery },
  },
};
const CHANNEL = { channelId: '1', languageId: 'sv-SE', marketId: 'se' };

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn(async () => mockSDK),
  getChannelVariables: vi.fn(() => CHANNEL),
  getRequestChannelVariables: vi.fn(() => CHANNEL),
}));
vi.mock('../../../server/services/graphql/loader', () => ({
  loadQuery: vi.fn((path: string) => `query:${path}`),
}));
vi.mock('../../../server/services/graphql/unwrap', () => ({
  unwrapGraphQL: vi.fn((result: unknown) => {
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return result;
    }
    const keys = Object.keys(result);
    return keys.length === 1
      ? (result as Record<string, unknown>)[keys[0]!]
      : result;
  }),
}));
vi.mock('../../../server/services/configurator', () => ({
  isConfigurableProduct: () => false,
}));
vi.mock('../../../server/utils/cms-sanitize', () => ({
  sanitizeWidgetHtml: (html: string) => html,
}));
vi.mock('../../../server/utils/logger', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// The session check behind "signed in": Geins accepts only signed-in tokens.
const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(async (token: string) => {
    if (token.includes('signed-in')) return { id: 42, authenticated: true };
    throw new Error('rejected by Geins');
  }),
}));
vi.mock('../../../server/services/user', () => ({ getUser }));

// ---------------------------------------------------------------------------
// Nitro / h3 auto-imports. Query and router params travel on the fake event.
// ---------------------------------------------------------------------------
interface FakeEvent {
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  context: unknown;
}
const mockSetResponseHeader = vi.fn();
vi.stubGlobal('withErrorHandling', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('wrapServiceCall', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('defineEventHandler', (fn: unknown) => fn);
vi.stubGlobal('defineCachedFunction', (fn: unknown) => fn);
vi.stubGlobal('setResponseHeader', mockSetResponseHeader);
vi.stubGlobal('getQuery', (event: FakeEvent) => event.query ?? {});
vi.stubGlobal(
  'getValidatedQuery',
  async (event: FakeEvent, validate: (raw: unknown) => unknown) =>
    validate(event.query ?? {}),
);
vi.stubGlobal(
  'getRouterParam',
  (event: FakeEvent, name: string) => event.params?.[name],
);
vi.stubGlobal('optionalAuth', vi.fn());
vi.stubGlobal(
  'createAppError',
  vi.fn((code: string, msg: string) => new Error(`${code}: ${msg}`)),
);
vi.stubGlobal('ErrorCode', {
  NOT_FOUND: 'NOT_FOUND',
  TENANT_CONFIG_INVALID: 'TENANT_CONFIG_INVALID',
});
vi.stubGlobal('getRequestLocale', vi.fn());
vi.stubGlobal('getRequestMarket', vi.fn());

type Handler = (event: H3Event) => Promise<unknown>;
const load = async (path: string): Promise<Handler> =>
  (await import(path)).default as Handler;

const productsList = await load(
  '../../../server/api/product-lists/products.get',
);
const filtersList = await load('../../../server/api/product-lists/filters.get');
const brandPage = await load(
  '../../../server/api/product-lists/brand/[alias].get',
);
const search = await load('../../../server/api/search/products.get');
const productPage = await load('../../../server/api/products/[alias].get');
const byIds = await load('../../../server/api/products/by-ids.get');
const byAliases = await load('../../../server/api/products/by-aliases.get');
const related = await load('../../../server/api/products/[alias]/related.get');
const sitemap = await load('../../../server/api/__sitemap__/urls');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let counter = 0;

/** A JWT-shaped session Geins accepts. */
function signedIn() {
  const payload = Buffer.from(
    JSON.stringify({
      sub: `buyer-${++counter}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return {
    authToken: `eyJhbGciOiJIUzI1NiJ9.${payload}.signed-in`,
    refreshToken: `refresh-${counter}`,
  };
}

function req(
  options: {
    hidden?: number[];
    query?: Record<string, unknown>;
    params?: Record<string, string>;
  } = {},
): H3Event {
  return {
    query: options.query,
    params: options.params,
    context: {
      tenant: {
        tenantId: 'shop',
        hostname: 'shop.example.com',
        config: {
          tenantId: 'shop',
          features: {},
          geinsSettings: {
            availableMarkets: ['se'],
            availableLocales: ['sv-SE'],
          },
          ...(options.hidden
            ? { catalog: { guestHiddenBrandIds: options.hidden } }
            : {}),
        },
      },
    },
  } as unknown as H3Event;
}

function asGuest() {
  vi.mocked(optionalAuth).mockResolvedValue(null);
}
function asBuyer() {
  vi.mocked(optionalAuth).mockResolvedValue(signedIn());
}

/** The filter of the last Geins query made with the given query file. */
function lastFilter(path: string): Record<string, unknown> | undefined {
  const call = mockGraphqlQuery.mock.calls
    .filter(([args]) => args.queryAsString === `query:${path}`)
    .at(-1);
  return call?.[0].variables.filter as Record<string, unknown> | undefined;
}

function queriedWith(path: string): boolean {
  return mockGraphqlQuery.mock.calls.some(
    ([args]) => args.queryAsString === `query:${path}`,
  );
}

beforeEach(() => {
  mockGraphqlQuery.mockClear();
  mockSetResponseHeader.mockClear();
});

// Shared mocks (optionalAuth, the Geins recorder) make these order-dependent.
describe.sequential('brands hidden from guests', () => {
  describe('product listings exclude them in the Geins query', () => {
    it('merges excludeBrandIds into the client filter, which cannot drop it', async () => {
      asGuest();
      await productsList(
        req({
          hidden: [7],
          query: {
            categoryAlias: 'pumps',
            filter: JSON.stringify({
              include: ['c_12'],
              excludeBrandIds: [],
              sort: 'LATEST',
            }),
          },
        }),
      );
      expect(lastFilter('product-lists/products.graphql')).toEqual({
        include: ['c_12'],
        excludeBrandIds: [7],
        sort: 'LATEST',
      });
    });

    it('excludes them for a guest who sent no filter at all', async () => {
      asGuest();
      await productsList(
        req({ hidden: [7], query: { brandAlias: 'hidden-brand' } }),
      );
      expect(lastFilter('product-lists/products.graphql')).toEqual({
        excludeBrandIds: [7],
      });
    });

    it("leaves a signed-in buyer's query exactly as sent", async () => {
      asBuyer();
      await productsList(
        req({
          hidden: [7],
          query: { filter: JSON.stringify({ sort: 'LATEST' }) },
        }),
      );
      expect(lastFilter('product-lists/products.graphql')).toEqual({
        sort: 'LATEST',
      });
    });

    it('changes nothing for a tenant without the setting', async () => {
      asGuest();
      await productsList(req({ query: { categoryAlias: 'pumps' } }));
      const call = mockGraphqlQuery.mock.calls.at(-1)![0];
      expect(call.variables).not.toHaveProperty('filter');
    });

    it('checks an id lookup by brand, since Geins ignores the exclusion there', async () => {
      asGuest();
      const result = await productsList(
        req({
          hidden: [7],
          query: { filter: JSON.stringify({ productIds: [1, 2] }) },
        }),
      );
      expect(result).toEqual({ products: [OPEN_PRODUCT], count: 1 });
    });

    it('excludes them from facets and drops an id lookup there', async () => {
      asGuest();
      await filtersList(
        req({
          hidden: [7],
          query: {
            brandAlias: 'open-brand',
            filter: JSON.stringify({ productIds: [1], sort: 'LATEST' }),
          },
        }),
      );
      expect(lastFilter('product-lists/list-filters.graphql')).toEqual({
        sort: 'LATEST',
        excludeBrandIds: [7],
      });
    });

    it('keeps facets untouched for a signed-in buyer', async () => {
      asBuyer();
      await filtersList(
        req({ hidden: [7], query: { brandAlias: 'open-brand' } }),
      );
      expect(lastFilter('product-lists/list-filters.graphql')).toBeUndefined();
    });
  });

  describe('search', () => {
    it('excludes them in the search query for a guest', async () => {
      asGuest();
      await search(req({ hidden: [7], query: { query: 'pump' } }));
      expect(lastFilter('search/search.graphql')).toEqual({
        searchText: 'pump',
        excludeBrandIds: [7],
      });
    });

    it('drops them from the article-number fallback, which Geins does not filter', async () => {
      asGuest();
      const result = await search(
        req({ hidden: [7], query: { query: 'PUMP-007' } }),
      );
      expect(lastFilter('search/search.graphql')).toMatchObject({
        articleNumbers: ['PUMP-007'],
      });
      expect(result).toEqual({ products: [], count: 0 });
    });

    it('finds them for a signed-in buyer, privately', async () => {
      asBuyer();
      const result = await search(
        req({ hidden: [7], query: { query: 'PUMP-007' } }),
      );
      expect(result).toEqual({ products: [HIDDEN_PRODUCT], count: 1 });
      expect(mockSetResponseHeader).toHaveBeenCalledWith(
        expect.anything(),
        'Cache-Control',
        'private, no-cache',
      );
    });
  });

  describe('product page', () => {
    it('answers 404 to a guest for a product of a hidden brand, uncached', async () => {
      asGuest();
      await expect(
        productPage(req({ hidden: [7], params: { alias: 'hidden-pump' } })),
      ).rejects.toThrow('NOT_FOUND');
      expect(mockSetResponseHeader).toHaveBeenLastCalledWith(
        expect.anything(),
        'Cache-Control',
        'no-store',
      );
    });

    it('serves it to a signed-in buyer', async () => {
      asBuyer();
      await expect(
        productPage(req({ hidden: [7], params: { alias: 'hidden-pump' } })),
      ).resolves.toMatchObject({ productId: 1, brand: { brandId: 7 } });
    });

    it('serves a guest every product of a brand that is not hidden', async () => {
      asGuest();
      await expect(
        productPage(req({ hidden: [7], params: { alias: 'open-pump' } })),
      ).resolves.toMatchObject({ productId: 2 });
    });

    it('serves a guest everything on a tenant without the setting', async () => {
      asGuest();
      await expect(
        productPage(req({ params: { alias: 'hidden-pump' } })),
      ).resolves.toMatchObject({ productId: 1 });
    });
  });

  describe('lookups by identity', () => {
    it('by ids: drops them for a guest, keeps them for a buyer', async () => {
      asGuest();
      await expect(
        byIds(req({ hidden: [7], query: { ids: '1,2' } })),
      ).resolves.toEqual({ products: [OPEN_PRODUCT], count: 1 });
      asBuyer();
      await expect(
        byIds(req({ hidden: [7], query: { ids: '1,2' } })),
      ).resolves.toEqual({
        products: [HIDDEN_PRODUCT, OPEN_PRODUCT],
        count: 2,
      });
    });

    it('by aliases: drops them for a guest', async () => {
      asGuest();
      await expect(
        byAliases(
          req({ hidden: [7], query: { aliases: 'hidden-pump,open-pump' } }),
        ),
      ).resolves.toEqual({ products: [OPEN_PRODUCT] });
    });

    it('related products: drops them for a guest', async () => {
      asGuest();
      await expect(
        related(req({ hidden: [7], params: { alias: 'open-pump' } })),
      ).resolves.toEqual([OPEN_PRODUCT]);
    });
  });

  describe('brand page', () => {
    it('answers 404 to a guest for a hidden brand', async () => {
      asGuest();
      await expect(
        brandPage(req({ hidden: [7], params: { alias: 'hidden-brand' } })),
      ).rejects.toThrow('NOT_FOUND');
    });

    it('serves a guest a brand that is not hidden', async () => {
      asGuest();
      await expect(
        brandPage(req({ hidden: [7], params: { alias: 'open-brand' } })),
      ).resolves.toMatchObject({ alias: 'open-brand' });
    });

    it('serves a hidden brand to a signed-in buyer without the extra lookup', async () => {
      asBuyer();
      await expect(
        brandPage(req({ hidden: [7], params: { alias: 'hidden-brand' } })),
      ).resolves.toMatchObject({ alias: 'hidden-brand' });
      expect(queriedWith('brands/brands.graphql')).toBe(false);
    });

    it('costs a tenant without the setting no brands lookup', async () => {
      asGuest();
      await brandPage(req({ params: { alias: 'hidden-brand' } }));
      expect(queriedWith('brands/brands.graphql')).toBe(false);
    });
  });

  describe('sitemap', () => {
    it('leaves a hidden brand out, whoever asks', async () => {
      asBuyer();
      const locs = (
        (await sitemap(req({ hidden: [7] }))) as { loc: string }[]
      ).map((e) => e.loc);
      expect(locs).toContain('/se/sv/b/open-brand');
      expect(locs).not.toContain('/se/sv/b/hidden-brand');
    });

    it('lists every brand for a tenant without the setting', async () => {
      const locs = ((await sitemap(req())) as { loc: string }[]).map(
        (e) => e.loc,
      );
      expect(locs).toContain('/se/sv/b/hidden-brand');
    });
  });
});
