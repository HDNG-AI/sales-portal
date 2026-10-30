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
  /** The Geins user the session belongs to; null when Geins refuses it. */
  buyerId: '7' as string | null,
  ownerSecret: 'test-owner-key',
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

vi.mock('../../../server/utils/cart-ownership-config', () => ({
  readCartOwnerSecret: () => state.ownerSecret,
}));

vi.mock('../../../server/services/user', () => ({
  getUser: vi.fn(async () =>
    state.buyerId === null
      ? { authenticated: false }
      : { id: state.buyerId, authenticated: true },
  ),
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

const mockRateCheck = vi.fn(async (_key: string) => ({
  allowed: true,
  remaining: 9,
  resetTime: 0,
}));
vi.mock('../../../server/utils/rate-limiter', () => ({
  cartImportPreviewRateLimiter: {
    check: (key: string) => mockRateCheck(key),
  },
  cartImportAddRateLimiter: { check: (key: string) => mockRateCheck(key) },
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
// A cookie jar per event: what the browser sent, and what the server set.
vi.stubGlobal(
  'getCookie',
  (event: { cookies: Record<string, string> }, name: string) =>
    event.cookies[name],
);
vi.stubGlobal(
  'setCookie',
  (event: { cookies: Record<string, string> }, name: string, value: string) => {
    event.cookies[name] = value;
  },
);

const preview = (await import('../../../server/api/cart/import/preview.post'))
  .default as unknown as (event: H3Event) => Promise<CartImportPreview>;
const add = (await import('../../../server/api/cart/import/add.post'))
  .default as unknown as (event: H3Event) => Promise<Record<string, unknown>>;
const createCartRoute = (await import('../../../server/api/cart/index.post'))
  .default as unknown as (event: H3Event) => Promise<{ id: string }>;

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
    cookies?: Record<string, string>;
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
    headers: options.headers ?? { 'content-length': '512' },
    cookies: { ...options.cookies },
    body: options.body,
    node: { req: { headers: {} } },
  } as unknown as H3Event;
}

const jarOf = (event: H3Event) =>
  (event as unknown as { cookies: Record<string, string> }).cookies;

/** A session for this buyer, with a token of its own so no cache is shared. */
function signIn(buyerId: string | null) {
  state.buyerId = buyerId;
  state.auth = {
    authToken: jwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      session: `${buyerId}-${Math.random()}`,
    }),
    refreshToken: 'refresh',
  };
}

/** The cart cookies a browser holds after `POST /api/cart` on a tenant. */
async function browserWithCart(tenantId = 'shop') {
  const event = makeEvent({ tenantId });
  const cart = await createCartRoute(event);
  return { cartId: cart.id, cookies: jarOf(event) };
}

function upload(csv: string, fileName = 'order.csv') {
  return { fileName, content: Buffer.from(csv, 'utf8').toString('base64') };
}

beforeEach(() => {
  vi.clearAllMocks();
  state.ownerSecret = 'test-owner-key';
  signIn('7');
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

  it('shows a verified buyer the price, and refuses a session Geins cannot confirm', async () => {
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

    // A preview/login-as session carries no refresh token, so it is not a
    // confirmed buyer: no import, and nothing of the file is read.
    state.auth = {
      authToken: jwt({ exp: Math.floor(Date.now() / 1000) + 3600, n: 2 }),
      refreshToken: '',
    };
    mockReadBody.mockClear();
    await expect(
      preview(makeEvent({ config, body: upload('SKRUV-M6;1') })),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockReadBody).not.toHaveBeenCalled();
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
          items: [
            {
              skuId: 101,
              quantity: 2,
              articleNumber: 'SKRUV-M6',
              inCartQuantity: 0,
            },
          ],
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
      added: [
        {
          skuId: 101,
          quantity: 2,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
      ],
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
    const body = {
      items: [
        { skuId: 101, quantity: 1, articleNumber: 'A', inCartQuantity: 0 },
      ],
    };
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
        inCartQuantity: 0,
      })),
    ],
    [
      'a zero quantity',
      [{ skuId: 1, quantity: 0, articleNumber: 'A', inCartQuantity: 0 }],
    ],
    [
      'no previewed cart quantity',
      [{ skuId: 1, quantity: 1, articleNumber: 'A' }],
    ],
    [
      'a quantity over the line limit',
      [{ skuId: 1, quantity: 1000, articleNumber: 'A', inCartQuantity: 0 }],
    ],
    ['no lines', []],
  ])('refuses %s', async (_label, items) => {
    await expect(add(makeEvent({ body: { items } }))).rejects.toThrow();
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });
});

describe('cart import — the session and the request', () => {
  it('refuses a session Geins does not confirm, before reading the file', async () => {
    signIn(null);
    await expect(
      preview(makeEvent({ body: upload('SKRUV-M6;1') })),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(mockReadBody).not.toHaveBeenCalled();
  });

  it('refuses a body that declares no length, before reading it', async () => {
    const event = makeEvent({ headers: {}, body: upload('SKRUV-M6;1') });
    await expect(preview(event)).rejects.toMatchObject({ statusCode: 411 });
    expect(mockReadBody).not.toHaveBeenCalled();
  });

  it('is unavailable without the cart ownership key', async () => {
    state.ownerSecret = '';
    await expect(
      preview(makeEvent({ body: upload('SKRUV-M6;1') })),
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(mockReadBody).not.toHaveBeenCalled();
  });

  it('limits each buyer as well as each address, so a new address does not help', async () => {
    mockRateCheck.mockImplementation(async (key: string) => ({
      allowed: !key.includes('buyer:7'),
      remaining: 0,
      resetTime: 0,
    }));
    try {
      await expect(
        preview(makeEvent({ body: upload('SKRUV-M6;1') })),
      ).rejects.toMatchObject({ statusCode: 429 });
      expect(mockRateCheck).toHaveBeenCalledWith('203.0.113.7');
      expect(mockRateCheck).toHaveBeenCalledWith('shop:buyer:7');
      expect(mockReadBody).not.toHaveBeenCalled();
    } finally {
      mockRateCheck.mockImplementation(async () => ({
        allowed: true,
        remaining: 9,
        resetTime: 0,
      }));
    }
  });
});

describe('cart import — whose cart', () => {
  const line = {
    skuId: 101,
    quantity: 2,
    articleNumber: 'SKRUV-M6',
    inCartQuantity: 0,
  };

  it('reads and fills the cart this browser created, and binds it to the buyer', async () => {
    const browser = await browserWithCart();
    const proof = browser.cookies.cart_owner;
    expect(proof).toBeTruthy();

    const event = makeEvent({
      cookies: browser.cookies,
      body: { ...upload('SKRUV-M6;1'), cartId: browser.cartId },
    });
    const result = await preview(event);
    expect(result).not.toHaveProperty('newCart');
    expect(mockCart.get).toHaveBeenCalledWith(browser.cartId, false, undefined);
    // Bound to buyer 7 from here on.
    expect(jarOf(event).cart_owner).toBeTruthy();
    expect(jarOf(event).cart_owner).not.toBe(proof);

    const added = await add(
      makeEvent({
        cookies: jarOf(event),
        body: { cartId: browser.cartId, items: [line] },
      }),
    );
    expect(added).toMatchObject({ added: [line], failed: [] });
  });

  it('never reads a cart named without proof, and puts the file in a new cart', async () => {
    const event = makeEvent({
      body: { ...upload('SKRUV-M6;1'), cartId: 'someone-elses-cart' },
    });
    const result = await preview(event);
    expect(result).toMatchObject({ status: 'ok', newCart: true });
    expect(mockCart.get).not.toHaveBeenCalled();

    await expect(
      add(makeEvent({ body: { cartId: 'someone-elses-cart', items: [line] } })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCart.get).not.toHaveBeenCalled();
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it('refuses a made-up proof', async () => {
    const browser = await browserWithCart();
    const cookies = { ...browser.cookies, cart_owner: 'AAAAAAAAAAAAAAAAAAAA' };
    await expect(
      add(
        makeEvent({ cookies, body: { cartId: browser.cartId, items: [line] } }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it("refuses another buyer's cart, even on the same browser", async () => {
    const browser = await browserWithCart();
    const claim = makeEvent({
      cookies: browser.cookies,
      body: { ...upload('SKRUV-M6;1'), cartId: browser.cartId },
    });
    await preview(claim);
    const boundTo7 = jarOf(claim);

    signIn('8');
    const peek = await preview(
      makeEvent({
        cookies: boundTo7,
        body: { ...upload('SKRUV-M6;1'), cartId: browser.cartId },
      }),
    );
    expect(peek).toMatchObject({ newCart: true });
    expect(mockCart.get).toHaveBeenCalledTimes(1);
    await expect(
      add(
        makeEvent({
          cookies: boundTo7,
          body: { cartId: browser.cartId, items: [line] },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it("refuses a cart proof from another tenant's store", async () => {
    const browser = await browserWithCart('shop');
    const elsewhere = makeEvent({
      tenantId: 'other',
      config: { tenantId: 'other', features: ENABLED },
      cookies: browser.cookies,
      body: { cartId: browser.cartId, items: [line] },
    });
    await expect(add(elsewhere)).rejects.toMatchObject({ statusCode: 403 });
    expect(mockCart.addItem).not.toHaveBeenCalled();
  });

  it('binds a cart the import creates to its buyer, who can import into it again', async () => {
    const first = makeEvent({ body: { items: [line] } });
    const created = (await add(first)) as { cart: { id: string } };
    expect(mockCart.create).toHaveBeenCalledTimes(1);
    expect(jarOf(first).cart_owner).toBeTruthy();

    await add(
      makeEvent({
        cookies: jarOf(first),
        body: { cartId: created.cart.id, items: [line] },
      }),
    );
    expect(mockCart.create).toHaveBeenCalledTimes(1);

    signIn('8');
    await expect(
      add(
        makeEvent({
          cookies: jarOf(first),
          body: { cartId: created.cart.id, items: [line] },
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
