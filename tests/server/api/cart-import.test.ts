import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createError, type H3Event } from 'h3';
import {
  CART_IMPORT_MAX_FILE_BYTES,
  CART_IMPORT_MAX_ROWS,
} from '../../../shared/constants/cart-import';
import type { CartImportPreview } from '../../../shared/types/cart-import';

// ---------------------------------------------------------------------------
// Boundaries: the signed-in buyer, Geins (products query and OMS cart), the
// rate limiters and the logger. Everything between them runs for real.
// ---------------------------------------------------------------------------
const state = vi.hoisted(() => ({
  auth: null as null | { authToken: string; refreshToken: string },
}));

vi.mock('../../../server/utils/auth', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../server/utils/auth')>();
  return {
    ...actual,
    requireAuth: vi.fn(async () => {
      if (!state.auth) {
        throw Object.assign(new Error('Authentication required'), {
          statusCode: 401,
        });
      }
      return state.auth;
    }),
    optionalAuth: vi.fn(async () => state.auth),
  };
});

vi.mock('../../../server/services/user', () => ({
  getUser: vi.fn(async () => ({ id: 7, authenticated: true })),
}));

const catalog = [
  {
    productId: 1,
    name: 'Skruv M6',
    articleNumber: 'SKRUV-M6',
    unitPrice: {
      sellingPriceIncVatFormatted: '12,50 kr',
      sellingPriceExVatFormatted: '10,00 kr',
    },
    totalStock: { inStock: 50, oversellable: 0, static: 0, totalStock: 50 },
    skus: [
      {
        skuId: 101,
        articleNumber: 'SKRUV-M6',
        stock: { inStock: 50, oversellable: 0, static: 0, totalStock: 50 },
      },
    ],
  },
];
const mockQuery = vi.fn(
  async (args: { variables: { filter: { articleNumbers: string[] } } }) => ({
    products: {
      products: catalog.filter((product) =>
        args.variables.filter.articleNumbers.includes(product.articleNumber),
      ),
    },
  }),
);
const emptyCart = {
  id: 'cart-new',
  completed: false,
  items: [] as Array<Record<string, unknown>>,
};
const mockCart = {
  get: vi.fn(async () => structuredClone(emptyCart)),
  create: vi.fn(async () => structuredClone(emptyCart)),
  addItem: vi.fn(
    async (_id: string, input: { skuId?: number; quantity: number }) => {
      emptyCart.items.push({
        id: 'line-1',
        skuId: input.skuId,
        quantity: input.quantity,
        unitPrice: { sellingPriceIncVat: 12.5 },
      });
      return structuredClone(emptyCart);
    },
  ),
  updateItem: vi.fn(),
};
const mockGetTenantSDK = vi.fn(async (_event: H3Event) => ({
  core: { graphql: { query: mockQuery } },
  oms: { cart: mockCart },
}));

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: (event: H3Event) => mockGetTenantSDK(event),
  getRequestChannelVariables: vi.fn(() => ({
    channelId: '1|se',
    languageId: 'sv-SE',
    marketId: 'se',
  })),
  buildRequestContext: vi.fn(() => undefined),
}));
vi.mock('../../../server/services/graphql/loader', () => ({
  loadQuery: vi.fn((path: string) => `query:${path}`),
}));

const mockRateCheck = vi.fn(async () => ({
  allowed: true,
  remaining: 9,
  resetTime: 0,
}));
vi.mock('../../../server/utils/rate-limiter', () => ({
  cartImportPreviewRateLimiter: { check: () => mockRateCheck() },
  cartImportAddRateLimiter: { check: () => mockRateCheck() },
  getClientIp: vi.fn(() => '203.0.113.7'),
}));

const mockLogInfo = vi.fn();
vi.mock('../../../server/utils/logger', () => {
  const log = {
    info: mockLogInfo,
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { logger: log, createTenantLogger: () => log };
});

// Nitro auto-imports, with their real implementations where they matter.
const errors = await import('../../../server/utils/errors');
type AnyFn = (...args: unknown[]) => unknown;
const mockReadBody = vi.fn(
  async (event: { body?: unknown }, parse: (value: unknown) => unknown) =>
    parse(event.body),
);
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('readValidatedBody', mockReadBody);
vi.stubGlobal('setResponseHeader', vi.fn());
vi.stubGlobal(
  'getRequestHeader',
  (event: { headers?: Record<string, string> }, name: string) =>
    event.headers?.[name],
);
vi.stubGlobal('createError', createError);
vi.stubGlobal('createAppError', errors.createAppError);
vi.stubGlobal('ErrorCode', errors.ErrorCode);
vi.stubGlobal('withErrorHandling', errors.withErrorHandling);
vi.stubGlobal('wrapServiceCall', errors.wrapServiceCall);
vi.stubGlobal('getAuthCookies', () => ({
  authToken: null,
  refreshToken: null,
}));

const preview = (await import('../../../server/api/cart/import/preview.post'))
  .default as unknown as (event: H3Event) => Promise<CartImportPreview>;
const add = (await import('../../../server/api/cart/import/add.post'))
  .default as unknown as (event: H3Event) => Promise<Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ENABLED = {
  cartFileImport: { enabled: true, access: 'authenticated' },
  orderPlacement: { enabled: true, access: 'authenticated' },
};

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`;
}

function makeEvent(
  options: {
    tenantId?: string;
    config?: Record<string, unknown>;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
): H3Event {
  const tenantId = options.tenantId ?? 'shop';
  return {
    context: {
      tenant: {
        hostname: `${tenantId}.example.test`,
        tenantId,
        config: options.config ?? { tenantId, features: ENABLED },
      },
    },
    headers: options.headers ?? {},
    body: options.body,
    node: { req: { headers: {} } },
  } as unknown as H3Event;
}

function upload(csv: string, fileName = 'order.csv') {
  return { fileName, content: Buffer.from(csv, 'utf8').toString('base64') };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.auth = {
    authToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600 }),
    refreshToken: 'refresh',
  };
  emptyCart.items = [];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('POST /api/cart/import/preview — access', () => {
  it('requires a signed-in buyer and reads nothing before that', async () => {
    state.auth = null;
    await expect(
      preview(makeEvent({ body: upload('A;1') })),
    ).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(mockReadBody).not.toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', { orderPlacement: ENABLED.orderPlacement }],
    ['disabled', { ...ENABLED, cartFileImport: { enabled: false } }],
    [
      'on, but ordering is off',
      { ...ENABLED, orderPlacement: { enabled: false } },
    ],
  ])('answers 403 when the feature is %s', async (_label, features) => {
    const event = makeEvent({
      config: { tenantId: 'shop', features },
      body: upload('A;1'),
    });
    await expect(preview(event)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('answers 403 in catalogue mode', async () => {
    const event = makeEvent({
      config: { tenantId: 'shop', mode: 'catalog', features: ENABLED },
      body: upload('A;1'),
    });
    await expect(preview(event)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("decides by the requesting tenant's own flag and asks Geins as that tenant", async () => {
    const off = makeEvent({
      tenantId: 'other',
      config: {
        tenantId: 'other',
        features: { orderPlacement: ENABLED.orderPlacement },
      },
      body: upload('SKRUV-M6;1'),
    });
    await expect(preview(off)).rejects.toMatchObject({ statusCode: 403 });

    const on = makeEvent({ body: upload('SKRUV-M6;1') });
    await preview(on);
    expect(mockGetTenantSDK).toHaveBeenCalledTimes(1);
    expect(mockGetTenantSDK).toHaveBeenCalledWith(on);
  });

  it('answers 429 when the buyer is over the rate limit', async () => {
    mockRateCheck.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetTime: 0,
    });
    await expect(
      preview(makeEvent({ body: upload('A;1') })),
    ).rejects.toMatchObject({
      statusCode: 429,
    });
  });

  it('refuses a body over the limit from its declared length, before reading it', async () => {
    const event = makeEvent({
      headers: { 'content-length': String(CART_IMPORT_MAX_FILE_BYTES * 2) },
      body: upload('A;1'),
    });
    await expect(preview(event)).rejects.toMatchObject({ statusCode: 413 });
    expect(mockReadBody).not.toHaveBeenCalled();
  });

  it('refuses file content longer than the file limit', async () => {
    const tooLong = 'A'.repeat(
      Math.ceil(CART_IMPORT_MAX_FILE_BYTES / 3) * 4 + 4,
    );
    const event = makeEvent({
      body: { fileName: 'order.csv', content: tooLong },
    });
    await expect(preview(event)).rejects.toThrow();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('POST /api/cart/import/preview — results', () => {
  it('answers a file it cannot read with a reason, without asking Geins', async () => {
    const result = await preview(
      makeEvent({ body: upload('Artikelnummer;Antal\nA;1', 'order.pdf') }),
    );
    expect(result).toEqual({ status: 'invalid', error: 'unsupported_format' });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('classifies every row: matched, not found and unreadable', async () => {
    const result = await preview(
      makeEvent({
        body: upload(
          'Artikelnummer;Antal\nSKRUV-M6;4\nOKAND-1;1\nSKRUV-M6;x\n',
        ),
      }),
    );
    if (result.status !== 'ok') throw new Error('expected a preview');
    expect(result.lines).toEqual([
      expect.objectContaining({
        articleNumber: 'SKRUV-M6',
        skuId: 101,
        quantity: 4,
        rows: [2],
      }),
    ]);
    expect(
      result.problems.map((problem) => [problem.reason, problem.rows]),
    ).toEqual([
      ['not_found', [3]],
      ['invalid_quantity', [4]],
    ]);
  });

  it("shows a verified buyer the price, and withholds it when the tenant's price rule says so", async () => {
    const config = {
      tenantId: 'shop',
      features: {
        ...ENABLED,
        priceVisibility: { enabled: true, access: 'authenticated' },
      },
    };
    const verified = await preview(
      makeEvent({ config, body: upload('SKRUV-M6;1') }),
    );
    expect(JSON.stringify(verified)).toContain('12,50 kr');

    // A preview/login-as session carries no refresh token: no private prices.
    state.auth = {
      authToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600, n: 2 }),
      refreshToken: '',
    };
    const unverified = await preview(
      makeEvent({ config, body: upload('SKRUV-M6;1') }),
    );
    if (unverified.status !== 'ok') throw new Error('expected a preview');
    expect(unverified.lines[0]).toMatchObject({ skuId: 101, quantity: 1 });
    expect(unverified.lines[0]).not.toHaveProperty('unitPrice');
    expect(JSON.stringify(unverified)).not.toContain('12,50');
  });

  it('logs counts only, never the article numbers in the file', async () => {
    await preview(
      makeEvent({
        body: upload('Artikelnummer;Antal\nSKRUV-M6;4\nHEMLIG-99;1\n'),
      }),
    );
    expect(mockLogInfo).toHaveBeenCalledWith('Cart file import previewed', {
      format: 'csv',
      articles: 2,
      matched: 1,
      problems: 1,
    });
    const logged = JSON.stringify(mockLogInfo.mock.calls);
    expect(logged).not.toContain('SKRUV-M6');
    expect(logged).not.toContain('HEMLIG-99');
  });
});

describe('POST /api/cart/import/add', () => {
  it('adds through the cart service and answers with the cart and an outcome per line', async () => {
    const result = await add(
      makeEvent({
        body: {
          items: [{ skuId: 101, quantity: 2, articleNumber: 'SKRUV-M6' }],
        },
      }),
    );
    expect(mockCart.create).toHaveBeenCalled();
    expect(mockCart.addItem).toHaveBeenCalledWith(
      'cart-new',
      { skuId: 101, quantity: 2 },
      undefined,
    );
    expect(result).toMatchObject({
      added: [{ skuId: 101, quantity: 2, articleNumber: 'SKRUV-M6' }],
      failed: [],
      cart: { id: 'cart-new' },
    });
    expect(setResponseHeader).toHaveBeenCalledWith(
      expect.anything(),
      'Cache-Control',
      'private, no-store',
    );
  });

  it('requires a signed-in buyer and the feature', async () => {
    state.auth = null;
    const body = { items: [{ skuId: 101, quantity: 1, articleNumber: 'A' }] };
    await expect(add(makeEvent({ body }))).rejects.toMatchObject({
      statusCode: 401,
    });

    state.auth = { authToken: 'token', refreshToken: 'refresh' };
    const off = makeEvent({ config: { tenantId: 'shop', features: {} }, body });
    await expect(add(off)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it.each([
    [
      'too many lines',
      Array.from({ length: CART_IMPORT_MAX_ROWS + 1 }, (_, i) => ({
        skuId: i + 1,
        quantity: 1,
        articleNumber: 'A',
      })),
    ],
    ['a zero quantity', [{ skuId: 1, quantity: 0, articleNumber: 'A' }]],
    [
      'a quantity over the line limit',
      [{ skuId: 1, quantity: 1000, articleNumber: 'A' }],
    ],
    ['no lines', []],
  ])('refuses %s', async (_label, items) => {
    await expect(add(makeEvent({ body: { items } }))).rejects.toThrow();
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });
});
