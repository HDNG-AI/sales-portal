import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { H3Event } from 'h3';

// Regression suite for restricted-price tenants: a cart ID alone must never
// return B2B prices, whichever cart route answers and whatever session state
// the caller is in. Only a buyer verified against Geins CRM may see them.

const sdkCart = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
  addItem: vi.fn(),
  updateItem: vi.fn(),
  deleteItem: vi.fn(),
  setPromotionCode: vi.fn(),
  removePromotionCode: vi.fn(),
}));
const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn().mockResolvedValue({ oms: { cart: sdkCart } }),
  getChannelVariables: vi.fn(),
  getRequestChannelVariables: vi
    .fn()
    .mockReturnValue({ channelId: '1', languageId: 'sv-SE', marketId: 'se' }),
  buildRequestContext: vi.fn().mockReturnValue(undefined),
}));
vi.mock('../../../server/services/user', () => ({ getUser }));
vi.mock('../../../server/utils/rate-limiter', () => ({
  promoCodeRateLimiter: {
    check: vi
      .fn()
      .mockResolvedValue({ allowed: true, remaining: 9, resetTime: 0 }),
  },
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

type AnyFn = (...args: unknown[]) => unknown;
type Cookies = { authToken: string | null; refreshToken: string | null };

let cookies: Cookies = { authToken: null, refreshToken: null };
const routeInput = {
  cartId: 'cart-1',
  itemId: 'item-1',
  skuId: 101,
  quantity: 2,
  promoCode: 'PILOT',
};

vi.stubGlobal('withErrorHandling', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('wrapServiceCall', async (fn: () => Promise<unknown>) => fn());
vi.stubGlobal('defineEventHandler', (fn: AnyFn) => fn);
vi.stubGlobal('createError', ({ statusCode }: { statusCode: number }) =>
  Object.assign(new Error(String(statusCode)), { statusCode }),
);
vi.stubGlobal('createAppError', (_code: string, msg: string) =>
  Object.assign(new Error(msg), { statusCode: 404 }),
);
vi.stubGlobal('ErrorCode', {
  NOT_FOUND: 'NOT_FOUND',
  RATE_LIMITED: 'RATE_LIMITED',
});
vi.stubGlobal(
  'getQuery',
  vi.fn(() => routeInput),
);
vi.stubGlobal('getValidatedQuery', async (_event: unknown, parse: AnyFn) =>
  parse(routeInput),
);
vi.stubGlobal('readValidatedBody', async (_event: unknown, parse: AnyFn) =>
  parse(routeInput),
);
vi.stubGlobal(
  'getAuthCookies',
  vi.fn(() => cookies),
);
vi.stubGlobal('clearAuthCookies', vi.fn());
vi.stubGlobal('setResponseHeader', vi.fn());

const ROUTES = [
  ['GET /api/cart', '../../../server/api/cart/index.get', sdkCart.get],
  ['POST /api/cart', '../../../server/api/cart/index.post', sdkCart.create],
  [
    'POST /api/cart/items',
    '../../../server/api/cart/items.post',
    sdkCart.addItem,
  ],
  [
    'PUT /api/cart/items',
    '../../../server/api/cart/items.put',
    sdkCart.updateItem,
  ],
  [
    'DELETE /api/cart/items',
    '../../../server/api/cart/items.delete',
    sdkCart.deleteItem,
  ],
  [
    'POST /api/cart/promo',
    '../../../server/api/cart/promo.post',
    sdkCart.setPromotionCode,
  ],
  [
    'DELETE /api/cart/promo',
    '../../../server/api/cart/promo.delete',
    sdkCart.removePromotionCode,
  ],
] as const;

// Every monetary value in the fixture is unique, so a leak through any field
// shows up as its sentinel in the serialized response.
const FIRST_MONEY = 87_100;
let nextMoney = FIRST_MONEY;
const money = () => nextMoney++;
const formatted = () => `${money()} kr`;
const price = () => ({
  sellingPriceIncVat: money(),
  sellingPriceExVat: money(),
  regularPriceIncVat: money(),
  regularPriceExVat: money(),
  discountIncVat: money(),
  discountExVat: money(),
  discountPercentage: 10,
  vat: money(),
  isDiscounted: true,
  sellingPriceIncVatFormatted: formatted(),
  sellingPriceExVatFormatted: formatted(),
  vatFormatted: formatted(),
  currency: { code: 'SEK' },
});

/** A CartType carrying every field the Geins SDK returns. */
const fullCart = {
  id: 'cart-1',
  freeShipping: false,
  completed: false,
  promoCode: 'PILOT',
  fixedDiscount: money(),
  appliedCampaigns: [
    { campaignId: 'c-1', name: 'Pilot campaign', hideTitle: false },
  ],
  items: [
    {
      id: 'item-1',
      type: 'PRODUCT',
      title: 'Hull cleaner',
      skuId: 101,
      quantity: 2,
      product: {
        productId: 'p-1',
        articleNumber: 'ODL-101',
        name: 'Hull cleaner',
        brand: { name: 'Odelco' },
        alias: 'hull-cleaner',
        skus: [
          {
            skuId: '101',
            name: '1 l',
            stock: { inStock: 3, oversellable: 0, totalStock: 42, static: 0 },
          },
        ],
        unitPrice: price(),
      },
      campaign: {
        appliedCampaigns: [{ campaignId: 'c-1', name: 'Pilot campaign' }],
        prices: [
          {
            quantity: 10,
            discount: money(),
            discountPercentage: 5,
            price: price(),
          },
        ],
      },
      unitPrice: price(),
      totalPrice: price(),
    },
  ],
  summary: {
    total: price(),
    subTotal: price(),
    vats: [{ rate: 25, amount: money() }],
    fees: {
      paymentFeeIncVat: money(),
      paymentFeeExVat: money(),
      shippingFeeIncVat: money(),
      shippingFeeExVat: money(),
    },
    balance: {
      pending: money(),
      pendingFormatted: formatted(),
      totalSellingPriceExBalanceExVat: money(),
      totalSellingPriceExBalanceIncVat: money(),
      totalSellingPriceExBalanceIncVatFormatted: formatted(),
    },
    fixedAmountDiscountIncVat: money(),
    fixedAmountDiscountExVat: money(),
    shipping: {
      id: 1,
      name: 'Freight',
      feeIncVat: money(),
      feeExVat: money(),
      feeIncVatFormatted: formatted(),
      isDefault: true,
      isSelected: true,
      amountLeftToFreeShipping: money(),
      amountLeftToFreeShippingFormatted: formatted(),
    },
    payment: {
      id: 2,
      name: 'Invoice',
      feeIncVat: money(),
      feeExVat: money(),
      isDefault: true,
      isSelected: true,
    },
  },
};
const USED_MONEY = Array.from(
  { length: nextMoney - FIRST_MONEY },
  (_, i) => FIRST_MONEY + i,
);

function restrictedEvent(
  features: Record<string, unknown> = {
    priceVisibility: { enabled: true, access: 'authenticated' },
  },
): H3Event {
  return {
    context: {
      tenant: {
        tenantId: 'odelco',
        hostname: 'odelco.se',
        config: { tenantId: 'odelco', features },
      },
    },
    node: { req: { headers: {} } },
  } as unknown as H3Event;
}

let tokenCounter = 0;
function jwt(secondsToExpiry: number): string {
  const payload = Buffer.from(
    JSON.stringify({
      sub: `cart-buyer-${++tokenCounter}`,
      exp: Math.floor(Date.now() / 1000) + secondsToExpiry,
    }),
  ).toString('base64url');
  return `eyJhbGciOiJIUzI1NiJ9.${payload}.test-signature`;
}

async function callRoute(path: string, event: H3Event) {
  const handler = (await import(path)).default as (
    e: H3Event,
  ) => Promise<unknown>;
  return handler(event);
}

function expectNoPrices(response: unknown) {
  const json = JSON.stringify(response);
  const leaked = USED_MONEY.filter((value) => json.includes(String(value)));
  expect(leaked).toEqual([]);
  expect(json).not.toMatch(
    /price|discountIncVat|fee(?:Inc|Ex)Vat|amountLeft|pending/i,
  );
}

function expectCartStructurePreserved(response: unknown) {
  expect(response).toMatchObject({
    id: 'cart-1',
    promoCode: 'PILOT',
    items: [
      {
        id: 'item-1',
        skuId: 101,
        quantity: 2,
        product: {
          productId: 'p-1',
          articleNumber: 'ODL-101',
          name: 'Hull cleaner',
          skus: [{ stock: { inStock: 3, totalStock: 42 } }],
        },
      },
    ],
    summary: {
      vats: [{ rate: 25 }],
      shipping: { id: 1, name: 'Freight', isSelected: true },
      payment: { id: 2, name: 'Invoice' },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockReset();
  cookies = { authToken: null, refreshToken: null };
  for (const [, , sdkCall] of ROUTES)
    sdkCall.mockResolvedValue(structuredClone(fullCart));
});

describe('cart API on a restricted-price tenant', () => {
  describe.each(ROUTES)('%s', (_name, path, sdkCall) => {
    it('returns no prices to an anonymous visitor', async () => {
      const response = await callRoute(path, restrictedEvent());

      expect(sdkCall).toHaveBeenCalledTimes(1);
      expectNoPrices(response);
      expectCartStructurePreserved(response);
      expect(getUser).not.toHaveBeenCalled();
      expect(setResponseHeader).toHaveBeenCalledWith(
        expect.anything(),
        'Cache-Control',
        'private, no-store',
      );
    });

    it('returns no prices after the buyer session has expired', async () => {
      cookies = { authToken: jwt(-60), refreshToken: 'refresh-expired' };

      const response = await callRoute(path, restrictedEvent());

      expectNoPrices(response);
      expectCartStructurePreserved(response);
      expect(getUser).not.toHaveBeenCalled();
    });

    it('returns no prices to a preview session without a refresh token', async () => {
      cookies = { authToken: jwt(3600), refreshToken: null };

      expectNoPrices(await callRoute(path, restrictedEvent()));
      expect(getUser).not.toHaveBeenCalled();
    });

    it('returns no prices when Geins CRM rejects the token', async () => {
      cookies = { authToken: jwt(3600), refreshToken: 'refresh-forged' };
      getUser.mockRejectedValue(new Error('Unauthorized'));

      expectNoPrices(await callRoute(path, restrictedEvent()));
      expect(getUser).toHaveBeenCalledTimes(1);
    });

    it('keeps every price for a buyer verified against Geins CRM', async () => {
      cookies = { authToken: jwt(3600), refreshToken: 'refresh-valid' };
      getUser.mockResolvedValue({ id: 501, email: 'buyer@example.com' });

      expect(await callRoute(path, restrictedEvent())).toEqual(fullCart);
    });
  });

  it('fails closed for Odelco when the price visibility feature is missing', async () => {
    const response = await callRoute(ROUTES[0][1], restrictedEvent({}));

    expectNoPrices(response);
  });

  it('does not let a failed refresh fall back to cached prices', async () => {
    cookies = { authToken: null, refreshToken: 'refresh-revoked' };

    // optionalAuth refreshes via the CRM SDK, which this suite does not
    // provide, so the refresh throws exactly as a revoked token would.
    const response = await callRoute(ROUTES[0][1], restrictedEvent());

    expectNoPrices(response);
    expect(clearAuthCookies).toHaveBeenCalled();
  });

  // A `?preview=1` request resolves the tenant only through the merchant API.
  // When that lookup fails the context carries just the hostname, while the
  // SDK still serves the tenant's cart from KV.
  it.each(ROUTES)(
    '%s returns no prices when ?preview=1 tenant resolution failed',
    async (_name, path, sdkCall) => {
      cookies = { authToken: jwt(3600), refreshToken: 'refresh-valid' };
      getUser.mockResolvedValue({ id: 501, email: 'buyer@example.com' });
      const unresolvedPreviewEvent = {
        path: '/api/cart?preview=1',
        context: {
          tenant: { hostname: 'odelco.se', resolution: 'transport-failure' },
        },
        node: { req: { headers: {} } },
      } as unknown as H3Event;

      const response = await callRoute(path, unresolvedPreviewEvent);

      expect(sdkCall).toHaveBeenCalledTimes(1);
      expectNoPrices(response);
      expectCartStructurePreserved(response);
      expect(setResponseHeader).toHaveBeenCalledWith(
        expect.anything(),
        'Cache-Control',
        'private, no-store',
      );
    },
  );

  it('leaves public-price tenants unchanged', async () => {
    const response = await callRoute(
      ROUTES[0][1],
      restrictedEvent({ priceVisibility: { enabled: true, access: 'all' } }),
    );

    expect(response).toEqual(fullCart);
  });
});
