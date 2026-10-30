import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createError, type H3Event } from 'h3';
import { CartError, GeinsErrorCode } from '@geins/core';
import type { CartType } from '../../../shared/types/commerce';
import type { OrderFileEntry } from '../../../server/utils/cart-import/parse';
import { wrapServiceCall } from '../../../server/utils/errors';

// ---------------------------------------------------------------------------
// Geins at the SDK boundary: a products query that answers like the
// articleNumbers filter, and an in-memory cart behind the OMS cart service.
// ---------------------------------------------------------------------------
interface FakeSku {
  skuId: number;
  articleNumber: string;
  name?: string;
  stock?: {
    inStock: number;
    oversellable: number;
    totalStock: number;
    static: number;
  };
}
interface FakeProduct {
  productId: number;
  name: string;
  articleNumber: string;
  unitPrice?: {
    sellingPriceIncVatFormatted: string;
    sellingPriceExVatFormatted: string;
  };
  totalStock?: FakeSku['stock'];
  skus: FakeSku[];
}

let catalog: FakeProduct[] = [];
const mockQuery = vi.fn(
  async (args: { variables: { filter: { articleNumbers: string[] } } }) => {
    const wanted = new Set(args.variables.filter.articleNumbers);
    return {
      products: {
        products: catalog.filter(
          (product) =>
            wanted.has(product.articleNumber) ||
            product.skus.some((sku) => wanted.has(sku.articleNumber)),
        ),
      },
    };
  },
);

let carts = new Map<string, CartType>();
let nextLine = 1;
function cartOf(id: string): CartType {
  const cart = carts.get(id);
  if (!cart) {
    // The SDK wraps its own not-found in a general failure, as it does a
    // network error; only the code inside tells them apart.
    throw new CartError(
      'Error getting cart',
      GeinsErrorCode.CART_OPERATION_FAILED,
      new CartError('Cart not found', GeinsErrorCode.CART_NOT_FOUND),
    );
  }
  return structuredClone(cart);
}
const mockCartGet = vi.fn(async (id: string) => cartOf(id));
const mockCartCreate = vi.fn(async () => {
  const id = `cart-${carts.size + 1}`;
  carts.set(id, { id, items: [], completed: false } as unknown as CartType);
  return cartOf(id);
});
const mockAddItem = vi.fn(
  async (id: string, input: { skuId?: number; quantity: number }) => {
    const cart = carts.get(id)!;
    cart.items.push({
      id: `line-${nextLine++}`,
      skuId: input.skuId,
      quantity: input.quantity,
    });
    return cartOf(id);
  },
);
const mockUpdateItem = vi.fn(
  async (id: string, input: { id?: string; quantity: number }) => {
    const line = carts.get(id)!.items.find((item) => item.id === input.id)!;
    line.quantity = input.quantity;
    return cartOf(id);
  },
);

const mockSDK = {
  core: { graphql: { query: mockQuery } },
  oms: {
    cart: {
      get: mockCartGet,
      create: mockCartCreate,
      addItem: mockAddItem,
      updateItem: mockUpdateItem,
    },
  },
};

vi.mock('../../../server/services/_sdk', () => ({
  getTenantSDK: vi.fn(async () => mockSDK),
  getRequestChannelVariables: vi.fn(() => ({
    channelId: '1|se',
    languageId: 'sv-SE',
    marketId: 'se',
  })),
  buildRequestContext: vi.fn(() => ({ userToken: 'buyer-token' })),
}));
vi.mock('../../../server/services/graphql/loader', () => ({
  loadQuery: vi.fn((path: string) => `query:${path}`),
}));

vi.stubGlobal('wrapServiceCall', wrapServiceCall);

const { resolveOrderEntries, addImportedItems } =
  await import('../../../server/services/cart-import');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const stock = (
  totalStock: number,
  extra: Partial<NonNullable<FakeSku['stock']>> = {},
) => ({
  inStock: totalStock,
  oversellable: 0,
  static: 0,
  totalStock,
  ...extra,
});

function eventFor(config: Record<string, unknown> = {}): H3Event {
  return {
    context: {
      tenant: { hostname: 'shop.example.test', tenantId: 'shop', config },
    },
  } as unknown as H3Event;
}

function entry(
  articleNumber: string,
  quantity: number,
  ...rows: number[]
): OrderFileEntry {
  return { articleNumber, quantity, rows: rows.length ? rows : [2] };
}

beforeEach(() => {
  vi.clearAllMocks();
  carts = new Map();
  nextLine = 1;
  catalog = [
    {
      productId: 1,
      name: 'Skruv M6',
      articleNumber: 'SKRUV-M6',
      unitPrice: {
        sellingPriceIncVatFormatted: '12,50 kr',
        sellingPriceExVatFormatted: '10,00 kr',
      },
      skus: [{ skuId: 101, articleNumber: 'SKRUV-M6', stock: stock(50) }],
    },
    {
      productId: 2,
      name: 'Mutter',
      articleNumber: 'MUTTER',
      skus: [
        {
          skuId: 201,
          articleNumber: 'MUTTER-S',
          name: 'Small',
          stock: stock(10),
        },
        {
          skuId: 202,
          articleNumber: 'MUTTER-L',
          name: 'Large',
          stock: stock(10),
        },
      ],
    },
    {
      productId: 3,
      name: 'Slut',
      articleNumber: 'SLUT-1',
      skus: [{ skuId: 301, articleNumber: 'SLUT-1', stock: stock(0) }],
    },
    {
      productId: 4,
      name: 'Få kvar',
      articleNumber: 'FA-3',
      skus: [{ skuId: 401, articleNumber: 'FA-3', stock: stock(3) }],
    },
    {
      productId: 5,
      name: 'Beställningsvara',
      articleNumber: 'BEST-1',
      skus: [
        {
          skuId: 501,
          articleNumber: 'BEST-1',
          stock: stock(1000, { inStock: 0, oversellable: 1000 }),
        },
      ],
    },
  ];
});

describe('resolveOrderEntries', () => {
  it('matches by SKU article number and by a single-SKU product article number', async () => {
    const { lines, problems } = await resolveOrderEntries(
      [entry('SKRUV-M6', 4, 2), entry('MUTTER-L', 2, 3)],
      { userToken: 'buyer-token' },
      eventFor(),
    );
    expect(problems).toEqual([]);
    expect(lines).toEqual([
      expect.objectContaining({
        articleNumber: 'SKRUV-M6',
        skuId: 101,
        name: 'Skruv M6',
        quantity: 4,
        rows: [2],
        inCartQuantity: 0,
      }),
      expect.objectContaining({
        articleNumber: 'MUTTER-L',
        skuId: 202,
        name: 'Mutter (Large)',
        quantity: 2,
        rows: [3],
      }),
    ]);
  });

  it("asks Geins once, as the buyer, in the request's channel, sending each article as written and upper-cased", async () => {
    await resolveOrderEntries(
      [entry('skruv-m6', 1), entry('SLUT-1', 1)],
      { userToken: 'buyer-token' },
      eventFor(),
    );
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const call = mockQuery.mock.calls[0]![0] as unknown as {
      variables: Record<string, unknown> & {
        filter: { articleNumbers: string[]; includeCollapsed: boolean };
      };
      userToken: string;
    };
    expect(call.userToken).toBe('buyer-token');
    expect(call.variables).toMatchObject({
      channelId: '1|se',
      languageId: 'sv-SE',
      marketId: 'se',
    });
    expect(call.variables.filter).toEqual({
      articleNumbers: ['skruv-m6', 'SKRUV-M6', 'SLUT-1'],
      includeCollapsed: true,
    });
  });

  it('matches article numbers whatever their case in the file', async () => {
    const { lines } = await resolveOrderEntries(
      [entry('skruv-m6', 1)],
      { userToken: 't' },
      eventFor(),
    );
    expect(lines[0]).toMatchObject({ skuId: 101, articleNumber: 'skruv-m6' });
  });

  it('reports an article Geins does not return for this buyer as not found', async () => {
    const { lines, problems } = await resolveOrderEntries(
      [entry('HEMLIG-1', 1, 7)],
      { userToken: 't' },
      eventFor(),
    );
    expect(lines).toEqual([]);
    expect(problems).toEqual([
      { reason: 'not_found', rows: [7], articleNumber: 'HEMLIG-1' },
    ]);
  });

  it('does not guess a variant from a product article number with several SKUs', async () => {
    const { lines, problems } = await resolveOrderEntries(
      [entry('MUTTER', 2, 4)],
      { userToken: 't' },
      eventFor(),
    );
    expect(lines).toEqual([]);
    expect(problems).toEqual([
      {
        reason: 'variant_required',
        rows: [4],
        articleNumber: 'MUTTER',
        name: 'Mutter',
      },
    ]);
  });

  it('applies the portal stock rules: out of stock, more than is left, oversellable is open', async () => {
    const { lines, problems } = await resolveOrderEntries(
      [entry('SLUT-1', 1, 2), entry('FA-3', 4, 3), entry('BEST-1', 50, 4)],
      { userToken: 't' },
      eventFor(),
    );
    expect(problems.map((problem) => [problem.reason, problem.rows])).toEqual([
      ['out_of_stock', [2]],
      ['insufficient_stock', [3]],
    ]);
    expect(lines.map((line) => line.skuId)).toEqual([501]);
  });

  it('counts what the cart already holds against stock and the line limit', async () => {
    carts.set('cart-1', {
      id: 'cart-1',
      completed: false,
      items: [
        { id: 'l1', skuId: 401, quantity: 2 },
        { id: 'l2', skuId: 101, quantity: 995 },
        { id: 'l3', skuId: 501, quantity: 5 },
      ],
    } as unknown as CartType);
    const { lines, problems } = await resolveOrderEntries(
      [entry('FA-3', 2, 2), entry('SKRUV-M6', 5, 3), entry('BEST-1', 1, 4)],
      { userToken: 't', cartId: 'cart-1' },
      eventFor(),
    );
    expect(problems.map((problem) => problem.reason)).toEqual([
      'insufficient_stock',
      'quantity_too_large',
    ]);
    expect(lines).toEqual([
      expect.objectContaining({ skuId: 501, inCartQuantity: 5 }),
    ]);
  });

  it('counts from an empty cart when Geins no longer has the named one', async () => {
    const { lines } = await resolveOrderEntries(
      [entry('SKRUV-M6', 2)],
      { userToken: 't', cartId: 'missing' },
      eventFor(),
    );
    expect(lines).toEqual([
      expect.objectContaining({ skuId: 101, inCartQuantity: 0 }),
    ]);
  });

  it('fails rather than count from an empty cart when Geins cannot read it', async () => {
    mockCartGet.mockRejectedValueOnce(
      new CartError(
        'Error getting cart',
        GeinsErrorCode.CART_OPERATION_FAILED,
        new Error('socket hang up'),
      ),
    );
    await expect(
      resolveOrderEntries(
        [entry('SKRUV-M6', 2)],
        { userToken: 't', cartId: 'cart-1' },
        eventFor(),
      ),
    ).rejects.toMatchObject({ statusCode: 502 });
  });

  it("reads a product's total stock for its SKU only when it has no other SKU", async () => {
    catalog.push(
      {
        productId: 7,
        name: 'Ensam',
        articleNumber: 'ENSAM',
        totalStock: stock(1),
        skus: [{ skuId: 701, articleNumber: 'ENSAM' }],
      },
      {
        productId: 8,
        name: 'Delad',
        articleNumber: 'DELAD',
        totalStock: stock(1),
        skus: [
          { skuId: 801, articleNumber: 'DELAD-A', stock: stock(0) },
          { skuId: 802, articleNumber: 'DELAD-B' },
        ],
      },
    );
    const { lines, problems } = await resolveOrderEntries(
      [entry('ENSAM', 5, 2), entry('DELAD-B', 5, 3)],
      { userToken: 't' },
      eventFor(),
    );
    // The single SKU is held to the product's one unit; the other product's
    // one unit may belong to any SKU, so nothing is claimed for DELAD-B.
    expect(problems.map((problem) => [problem.reason, problem.rows])).toEqual([
      ['insufficient_stock', [2]],
    ]);
    expect(lines.map((line) => line.skuId)).toEqual([802]);
  });

  it('gives two article numbers for one SKU one line, with every row', async () => {
    catalog.push({
      productId: 6,
      name: 'Bricka',
      articleNumber: 'BRICKA',
      skus: [{ skuId: 601, articleNumber: 'BRICKA-8', stock: stock(100) }],
    });
    const { lines } = await resolveOrderEntries(
      [entry('BRICKA', 2, 5), entry('BRICKA-8', 3, 2)],
      { userToken: 't' },
      eventFor(),
    );
    expect(lines).toEqual([
      expect.objectContaining({
        skuId: 601,
        articleNumber: 'BRICKA',
        quantity: 5,
        rows: [2, 5],
      }),
    ]);
  });

  it("passes the buyer's price from Geins through untouched", async () => {
    const { lines } = await resolveOrderEntries(
      [entry('SKRUV-M6', 3)],
      { userToken: 't' },
      eventFor(),
    );
    expect(lines[0]?.unitPrice).toEqual({
      sellingPriceIncVatFormatted: '12,50 kr',
      sellingPriceExVatFormatted: '10,00 kr',
    });
  });

  it("labels stock on the tenant's basis, and only when the buyer may see stock", async () => {
    const entries = [entry('BEST-1', 1)];
    const total = await resolveOrderEntries(
      entries,
      { userToken: 't' },
      eventFor(),
    );
    expect(total.lines[0]?.stockStatus).toBe('in-stock');

    const available = await resolveOrderEntries(
      entries,
      { userToken: 't' },
      eventFor({ layout: { stockLevelBasis: 'available' } }),
    );
    expect(available.lines[0]?.stockStatus).toBe('backorder');

    const hidden = await resolveOrderEntries(
      entries,
      { userToken: 't' },
      eventFor({ features: { stockStatus: { enabled: false } } }),
    );
    expect(hidden.lines[0]).not.toHaveProperty('stockStatus');
  });

  it('looks up 300 articles per request, staying inside the 600-value filter cap', async () => {
    const many = Array.from({ length: 301 }, (_, index) =>
      entry(`a-${index}`, 1),
    );
    await resolveOrderEntries(many, { userToken: 't' }, eventFor());
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const sizes = mockQuery.mock.calls.map(
      ([args]) =>
        (args as { variables: { filter: { articleNumbers: string[] } } })
          .variables.filter.articleNumbers.length,
    );
    expect(sizes).toEqual([600, 2]);
  });
});

describe('addImportedItems', () => {
  function seedCart(
    items: Array<{ id: string; skuId: number; quantity: number }>,
  ) {
    carts.set('cart-1', {
      id: 'cart-1',
      completed: false,
      items,
    } as unknown as CartType);
  }
  const held = (skuId: number) =>
    carts
      .get('cart-1')!
      .items.filter((item) => item.skuId === skuId)
      .reduce((sum, item) => sum + item.quantity, 0);

  it('adds new SKUs and raises the line of a SKU the cart already holds', async () => {
    seedCart([{ id: 'line-a', skuId: 101, quantity: 2 }]);
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 3,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 2,
        },
        { skuId: 501, quantity: 1, articleNumber: 'BEST-1', inCartQuantity: 0 },
      ],
      eventFor(),
    );
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'cart-1',
      { id: 'line-a', quantity: 5 },
      { userToken: 'buyer-token' },
    );
    expect(mockAddItem).toHaveBeenCalledWith(
      'cart-1',
      { skuId: 501, quantity: 1 },
      { userToken: 'buyer-token' },
    );
    expect(result.failed).toEqual([]);
    expect(result.added.map((item) => item.skuId)).toEqual([101, 501]);
    expect(result.cart.items).toHaveLength(2);
    expect(held(101)).toBe(5);
  });

  it('reports a refused line and returns the cart with exactly what went in', async () => {
    seedCart([]);
    const addOne = mockAddItem.getMockImplementation()!;
    mockAddItem.mockImplementation(async (id, input) => {
      if (input.skuId === 301) throw new CartError('Out of stock');
      return addOne(id, input);
    });
    const result = await addImportedItems(
      'cart-1',
      [
        { skuId: 301, quantity: 1, articleNumber: 'SLUT-1', inCartQuantity: 0 },
        {
          skuId: 101,
          quantity: 2,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
      ],
      eventFor(),
    );
    mockAddItem.mockImplementation(addOne);
    expect(result.failed).toEqual([
      {
        skuId: 301,
        quantity: 1,
        articleNumber: 'SLUT-1',
        inCartQuantity: 0,
        reason: 'rejected',
      },
    ]);
    expect(result.added).toEqual([
      { skuId: 101, quantity: 2, articleNumber: 'SKRUV-M6', inCartQuantity: 0 },
    ]);
    expect(result.cart.items.map((item) => item.skuId)).toEqual([101]);
    // Never more than the one retry a line can get.
    expect(
      mockAddItem.mock.calls.filter(([, input]) => input.skuId === 301).length,
    ).toBeLessThanOrEqual(2);
  });

  it('does not retry a 4xx refusal', async () => {
    seedCart([]);
    mockAddItem.mockRejectedValueOnce(
      createError({ statusCode: 400, statusMessage: 'Bad request' }),
    );
    const result = await addImportedItems(
      'cart-1',
      [{ skuId: 301, quantity: 1, articleNumber: 'SLUT-1', inCartQuantity: 0 }],
      eventFor(),
    );
    expect(result.failed[0]?.reason).toBe('rejected');
    expect(mockAddItem).toHaveBeenCalledTimes(1);
  });

  it('counts a call that failed after Geins applied it as added', async () => {
    seedCart([]);
    mockAddItem.mockImplementationOnce(async (id, input) => {
      carts.get(id)!.items.push({
        id: 'late',
        skuId: input.skuId,
        quantity: input.quantity,
      });
      throw new Error('socket hang up');
    });
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 2,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
      ],
      eventFor(),
    );
    expect(result.added).toHaveLength(1);
    expect(held(101)).toBe(2);
    expect(mockAddItem).toHaveBeenCalledTimes(1);
  });

  it('tops up a line a concurrent call lost, once, so nothing is added twice', async () => {
    seedCart([]);
    // Answers as if applied, but the cart never got it.
    mockAddItem.mockImplementationOnce(async (id) => cartOf(id));
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 4,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
      ],
      eventFor(),
    );
    expect(result.added).toHaveLength(1);
    expect(held(101)).toBe(4);
    expect(mockAddItem).toHaveBeenCalledTimes(2);
  });

  it('retries a 5xx once and reports the line refused if it still fails', async () => {
    seedCart([]);
    mockAddItem
      .mockRejectedValueOnce(new Error('502'))
      .mockRejectedValueOnce(new Error('502'));
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 1,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
      ],
      eventFor(),
    );
    expect(mockAddItem).toHaveBeenCalledTimes(2);
    expect(result.failed).toEqual([
      {
        skuId: 101,
        quantity: 1,
        articleNumber: 'SKRUV-M6',
        inCartQuantity: 0,
        reason: 'rejected',
      },
    ]);
    expect(held(101)).toBe(0);
  });

  it('will not raise a line past the cart limit', async () => {
    seedCart([{ id: 'line-a', skuId: 101, quantity: 990 }]);
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 20,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 990,
        },
      ],
      eventFor(),
    );
    expect(result.failed[0]?.reason).toBe('quantity_limit');
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(held(101)).toBe(990);
  });

  it('creates a cart when there is none, or the stored one is gone or completed', async () => {
    const none = await addImportedItems(
      undefined,
      [{ skuId: 101, quantity: 1, articleNumber: 'A', inCartQuantity: 0 }],
      eventFor(),
    );
    expect(none.cart.id).toBe('cart-1');

    const gone = await addImportedItems(
      'missing',
      [{ skuId: 101, quantity: 1, articleNumber: 'A', inCartQuantity: 0 }],
      eventFor(),
    );
    expect(gone.cart.id).toBe('cart-2');

    carts.set('done', {
      id: 'done',
      completed: true,
      items: [],
    } as unknown as CartType);
    const completed = await addImportedItems(
      'done',
      [{ skuId: 101, quantity: 1, articleNumber: 'A', inCartQuantity: 0 }],
      eventFor(),
    );
    expect(completed.cart.id).not.toBe('done');
    expect(mockCartCreate).toHaveBeenCalledTimes(3);
  });

  it('merges two items for one SKU into one line', async () => {
    seedCart([]);
    const result = await addImportedItems(
      'cart-1',
      [
        {
          skuId: 101,
          quantity: 1,
          articleNumber: 'SKRUV-M6',
          inCartQuantity: 0,
        },
        {
          skuId: 101,
          quantity: 2,
          articleNumber: 'skruv-m6',
          inCartQuantity: 0,
        },
      ],
      eventFor(),
    );
    expect(mockAddItem).toHaveBeenCalledTimes(1);
    expect(held(101)).toBe(3);
    expect(result.added).toHaveLength(2);
  });

  it('keeps at most four cart mutations in flight', async () => {
    seedCart([]);
    let inFlight = 0;
    let peak = 0;
    mockAddItem.mockImplementation(async (id, input) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      carts.get(id)!.items.push({
        id: `line-${nextLine++}`,
        skuId: input.skuId,
        quantity: input.quantity,
      });
      inFlight -= 1;
      return cartOf(id);
    });
    const items = Array.from({ length: 10 }, (_, index) => ({
      skuId: 1000 + index,
      quantity: 1,
      articleNumber: `A-${index}`,
      inCartQuantity: 0,
    }));
    const result = await addImportedItems('cart-1', items, eventFor());
    expect(result.added).toHaveLength(10);
    expect(peak).toBe(4);
  });

  it('adds nothing twice when the same lines are sent again', async () => {
    seedCart([{ id: 'line-a', skuId: 101, quantity: 2 }]);
    const items = [
      { skuId: 101, quantity: 3, articleNumber: 'SKRUV-M6', inCartQuantity: 2 },
      { skuId: 501, quantity: 1, articleNumber: 'BEST-1', inCartQuantity: 0 },
    ];
    await addImportedItems('cart-1', items, eventFor());
    mockAddItem.mockClear();
    mockUpdateItem.mockClear();

    const again = await addImportedItems('cart-1', items, eventFor());
    expect(mockAddItem).not.toHaveBeenCalled();
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(again.added).toHaveLength(2);
    expect(held(101)).toBe(5);
    expect(held(501)).toBe(1);
  });

  it('counts from nothing in a cart it had to create, whatever the preview held', async () => {
    const result = await addImportedItems(
      'missing',
      [{ skuId: 101, quantity: 2, articleNumber: 'A', inCartQuantity: 5 }],
      eventFor(),
    );
    expect(result.cart.id).not.toBe('missing');
    expect(result.added).toHaveLength(1);
    expect(result.cart.items.find((item) => item.skuId === 101)?.quantity).toBe(
      2,
    );
  });

  it('fails rather than swap the cart for a new one when Geins cannot read it', async () => {
    seedCart([{ id: 'line-a', skuId: 101, quantity: 2 }]);
    mockCartGet.mockRejectedValueOnce(
      new CartError(
        'Error getting cart',
        GeinsErrorCode.CART_OPERATION_FAILED,
        new Error('socket hang up'),
      ),
    );
    await expect(
      addImportedItems(
        'cart-1',
        [{ skuId: 101, quantity: 1, articleNumber: 'A', inCartQuantity: 2 }],
        eventFor(),
      ),
    ).rejects.toMatchObject({ statusCode: 502 });
    expect(mockCartCreate).not.toHaveBeenCalled();
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('counts every line of a SKU against the cart limit, as the preview does', async () => {
    seedCart([
      { id: 'line-a', skuId: 101, quantity: 500 },
      { id: 'line-b', skuId: 101, quantity: 495 },
    ]);
    const result = await addImportedItems(
      'cart-1',
      [{ skuId: 101, quantity: 10, articleNumber: 'A', inCartQuantity: 995 }],
      eventFor(),
    );
    expect(result.failed[0]?.reason).toBe('quantity_limit');
    expect(mockUpdateItem).not.toHaveBeenCalled();
    expect(held(101)).toBe(995);
  });

  it('starts no cart call after the deadline and reports the lines it did not reach', async () => {
    seedCart([]);
    // Each call takes ten clock units. Four start together; by the time
    // they are done the deadline has passed, so the last two never start.
    let clock = 0;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const addOne = mockAddItem.getMockImplementation()!;
    mockAddItem.mockImplementation(async (id, input) => {
      clock += 10;
      return addOne(id, input);
    });
    const items = Array.from({ length: 6 }, (_, index) => ({
      skuId: 2000 + index,
      quantity: 1,
      articleNumber: `B-${index}`,
      inCartQuantity: 0,
    }));
    try {
      const result = await addImportedItems('cart-1', items, eventFor(), 25);
      expect(mockAddItem).toHaveBeenCalledTimes(4);
      expect(result.added.map((item) => item.skuId)).toEqual([
        2000, 2001, 2002, 2003,
      ]);
      expect(result.failed.map((item) => [item.skuId, item.reason])).toEqual([
        [2004, 'timed_out'],
        [2005, 'timed_out'],
      ]);
    } finally {
      now.mockRestore();
      mockAddItem.mockImplementation(addOne);
    }
  });
});
