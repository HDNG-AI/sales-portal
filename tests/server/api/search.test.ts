import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock at the SDK boundary — let search service run for real
// ---------------------------------------------------------------------------
const mockGraphqlQuery = vi.fn();

const mockSDK = {
  core: {
    geinsSettings: { channel: '1', locale: 'sv-SE', market: 'se' },
    graphql: { query: mockGraphqlQuery, mutation: vi.fn() },
  },
};

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn().mockResolvedValue(mockSDK),
  getChannelVariables: vi.fn(),
  getRequestChannelVariables: vi
    .fn()
    .mockReturnValue({ channelId: '1', languageId: 'sv-SE', marketId: 'se' }),
}));

// Mock graphql loader (depends on #graphql-queries build-time alias)
vi.mock('../../../server/services/graphql/loader', () => ({
  loadQuery: vi.fn((path: string) => `query:${path}`),
}));

vi.mock('../../../server/services/graphql/unwrap', () => ({
  unwrapGraphQL: vi.fn((result: unknown) => {
    if (result === null || result === undefined) return result;
    if (typeof result !== 'object' || Array.isArray(result)) return result;
    const keys = Object.keys(result as Record<string, unknown>);
    if (keys.length === 1) {
      return (result as Record<string, unknown>)[keys[0]!];
    }
    return result;
  }),
}));

// ---------------------------------------------------------------------------
// Stub Nitro / h3 auto-imports
// ---------------------------------------------------------------------------
// eslint-friendly callable type
type AnyFn = (...args: unknown[]) => unknown;

vi.stubGlobal('withErrorHandling', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('getQuery', vi.fn());
vi.stubGlobal(
  'getValidatedQuery',
  vi.fn(async (_event: unknown, validator: (raw: unknown) => unknown) => {
    const query = (getQuery as ReturnType<typeof vi.fn>)(_event);
    return validator(query);
  }),
);
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal('optionalAuth', vi.fn().mockResolvedValue(null));
vi.stubGlobal('wrapServiceCall', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('getRequestLocale', vi.fn().mockReturnValue(undefined));
vi.stubGlobal('getRequestMarket', vi.fn().mockReturnValue(undefined));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const fakeEvent = {} as unknown as import('h3').H3Event;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('GET /api/search/products', () => {
  let handler: (event: import('h3').H3Event) => Promise<unknown>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    mockGraphqlQuery.mockResolvedValue({
      searchProducts: { products: [], count: 0 },
    });
    const mod = await import('../../../server/api/search/products.get');
    handler = mod.default as (event: import('h3').H3Event) => Promise<unknown>;
  });

  it('builds filter with searchText and queries SDK', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: 'shoes' });

    const result = await handler(fakeEvent);

    expect(mockGraphqlQuery).toHaveBeenCalledOnce();
    expect(result).toEqual({ products: [], count: 0 });
  });

  it('strips prices from public Odelco search results', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: 'battery' });
    mockGraphqlQuery.mockResolvedValue({
      searchProducts: {
        products: [
          {
            productId: 8,
            name: 'Battery',
            unitPrice: { sellingPriceExVat: 300 },
          },
        ],
        count: 1,
      },
    });
    const event = {
      context: {
        tenant: {
          config: {
            features: {
              priceVisibility: { enabled: true, access: 'authenticated' },
            },
          },
        },
      },
    } as unknown as import('h3').H3Event;
    const response = (await handler(event)) as {
      products: Array<Record<string, unknown>>;
      count: number;
    };
    expect(response.products).toHaveLength(1);
    expect(response.products[0]).toMatchObject({ name: 'Battery' });
    expect(response.products[0]).not.toHaveProperty('unitPrice');
  });

  it('includes skip and take in SDK query when provided', async () => {
    vi.mocked(getQuery).mockReturnValue({
      query: 'jackets',
      skip: '0',
      take: '10',
    });

    await handler(fakeEvent);

    expect(mockGraphqlQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          filter: expect.objectContaining({
            searchText: 'jackets',
          }),
          skip: 0,
          take: 10,
        }),
      }),
    );
  });

  it('merges additional filter params', async () => {
    vi.mocked(getQuery).mockReturnValue({
      query: 'boots',
      filter: { color: 'red' },
    });

    await handler(fakeEvent);

    expect(mockGraphqlQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: expect.objectContaining({
          filter: expect.objectContaining({
            searchText: 'boots',
            color: 'red',
          }),
        }),
      }),
    );
  });

  it('retries a SKU-like search miss by exact Geins article numbers', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: 'PIN122251000', take: '5' });
    mockGraphqlQuery
      .mockResolvedValueOnce({ searchProducts: { products: [], count: 0 } })
      .mockResolvedValueOnce({
        searchProducts: {
          products: [
            { productId: 77, articleNumber: 'PIN122251000', name: 'Victron' },
          ],
          count: 1,
        },
      });

    const result = await handler(fakeEvent);
    expect(mockGraphqlQuery).toHaveBeenCalledTimes(2);
    expect(mockGraphqlQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        variables: expect.objectContaining({
          filter: expect.objectContaining({
            articleNumbers: ['PIN122251000'],
            includeCollapsed: true,
          }),
          skip: 0,
        }),
      }),
    );
    expect(result).toMatchObject({
      count: 1,
      products: [{ articleNumber: 'PIN122251000' }],
    });
  });

  it('preserves buyer authorization and existing filters for the SKU fallback', async () => {
    vi.mocked(getQuery).mockReturnValue({
      query: 'pin122251000',
      filter: { brandIds: [17] },
    });
    vi.mocked(optionalAuth).mockResolvedValue({
      authToken: 'buyer-token',
    } as never);
    mockGraphqlQuery
      .mockResolvedValueOnce({ searchProducts: { products: [], count: 0 } })
      .mockResolvedValueOnce({
        searchProducts: {
          products: [{ articleNumber: 'PIN122251000' }],
          count: 1,
        },
      });

    await handler(fakeEvent);
    expect(mockGraphqlQuery).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userToken: 'buyer-token',
        variables: expect.objectContaining({
          channelId: '1',
          languageId: 'sv-SE',
          marketId: 'se',
          filter: expect.objectContaining({
            brandIds: [17],
            articleNumbers: ['pin122251000', 'PIN122251000'],
          }),
        }),
      }),
    );
  });

  it('does not retry name searches, non-first search pages, or searches with hits', async () => {
    for (const [query, skip, found] of [
      ['Victron BlueSmart', undefined, []],
      ['PIN122251000', '10', []],
      ['PIN122251000', undefined, [{ articleNumber: 'PIN122251000' }]],
    ] as const) {
      vi.mocked(getQuery).mockReturnValue({ query, ...(skip ? { skip } : {}) });
      mockGraphqlQuery.mockResolvedValueOnce({
        searchProducts: { products: found, count: found.length },
      });
      await handler(fakeEvent);
    }
    expect(mockGraphqlQuery).toHaveBeenCalledTimes(3);
  });

  it('redacts prices from exact SKU fallback when public Odelco access is restricted', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: 'PIN122251000' });
    mockGraphqlQuery
      .mockResolvedValueOnce({ searchProducts: { products: [], count: 0 } })
      .mockResolvedValueOnce({
        searchProducts: {
          products: [
            {
              articleNumber: 'PIN122251000',
              name: 'Victron',
              unitPrice: { sellingPriceExVat: 50 },
            },
          ],
          count: 1,
        },
      });
    const event = {
      context: {
        tenant: {
          config: {
            features: {
              priceVisibility: { enabled: true, access: 'authenticated' },
            },
          },
        },
      },
    } as unknown as import('h3').H3Event;
    const out = (await handler(event)) as {
      products: Array<Record<string, unknown>>;
    };
    expect(out.products[0]).not.toHaveProperty('unitPrice');
  });

  it('rejects empty query with Zod error', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: '' });

    await expect(handler(fakeEvent)).rejects.toThrow();
  });

  it('rejects query longer than 200 characters', async () => {
    vi.mocked(getQuery).mockReturnValue({ query: 'a'.repeat(201) });

    await expect(handler(fakeEvent)).rejects.toThrow();
  });
});
