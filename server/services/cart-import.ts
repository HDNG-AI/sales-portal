import type { H3Event } from 'h3';
import { ItemType } from '@geins/types';
import type { CartType, StockType } from '#shared/types/commerce';
import { getStockStatus, purchasableQuantity } from '#shared/types/commerce';
import type {
  CartImportAddFailure,
  CartImportAddItem,
  CartImportAddResult,
  CartImportLine,
  CartImportProblem,
} from '#shared/types/cart-import';
import { CART_IMPORT_MAX_QUANTITY } from '#shared/constants/cart-import';
import { canAccessFeature } from '#shared/utils/feature-access';
import {
  articleNumberKey,
  type OrderFileEntry,
} from '../utils/cart-import/parse';
import { getTenantSDK, getRequestChannelVariables } from './_sdk';
import { loadQuery } from './graphql/loader';
import { unwrapGraphQL } from './graphql/unwrap';
import { addItem, createCart, findCart, getCart, updateItem } from './cart';

/**
 * Cart file import against Geins: resolve article numbers to SKUs the buyer
 * can buy, then add them through the same cart service the rest of the
 * storefront uses, so Geins prices and validates every line itself.
 */

/**
 * Geins caps the `articleNumbers` filter at 600 values, and each article is
 * sent as written and upper-cased, so a lookup carries at most 300 articles.
 */
const LOOKUP_BATCH = 300;
/** Cart mutations in flight at once for one import. */
const CART_CONCURRENCY = 4;
/**
 * No cart mutation starts after this, so the answer arrives before a gateway
 * gives up on the request. Lines not reached are reported as timed out; the
 * buyer can send them again, since an add only tops up to its target.
 */
const ADD_DEADLINE_MS = 20_000;

interface LookupSku {
  skuId: number;
  articleNumber?: string | null;
  name?: string | null;
  stock?: StockType | null;
}

interface LookupProduct {
  productId: number;
  name?: string | null;
  articleNumber?: string | null;
  unitPrice?: CartImportLine['unitPrice'];
  totalStock?: StockType | null;
  skus?: Array<LookupSku | null> | null;
}

interface Match {
  product: LookupProduct;
  sku: LookupSku;
}

function skusOf(product: LookupProduct): LookupSku[] {
  return (product.skus ?? []).filter((sku): sku is LookupSku => !!sku);
}

/**
 * One batched `products` query per 300 articles. The buyer's token goes with
 * it, so Geins answers with that buyer's assortment and price list: a product
 * the buyer may not see does not come back and reads as not found.
 */
async function lookupProducts(
  articleNumbers: string[],
  userToken: string,
  event: H3Event,
): Promise<LookupProduct[]> {
  const sdk = await getTenantSDK(event);
  const channel = getRequestChannelVariables(sdk, event);
  const batches: string[][] = [];
  for (let start = 0; start < articleNumbers.length; start += LOOKUP_BATCH) {
    batches.push(articleNumbers.slice(start, start + LOOKUP_BATCH));
  }
  const results = await Promise.all(
    batches.map(async (batch) => {
      const values = [
        ...new Set(batch.flatMap((value) => [value, value.toUpperCase()])),
      ];
      const result = await wrapServiceCall(
        () =>
          sdk.core.graphql.query({
            queryAsString: loadQuery(
              'products/products-by-article-numbers.graphql',
            ),
            variables: {
              filter: { articleNumbers: values, includeCollapsed: true },
              take: values.length,
              ...channel,
            },
            userToken,
          }),
        'products',
      );
      const page = unwrapGraphQL(result) as {
        products?: Array<LookupProduct | null> | null;
      } | null;
      return (page?.products ?? []).filter(
        (product): product is LookupProduct => !!product,
      );
    }),
  );
  return results.flat();
}

/** Lines that hold one SKU on their own, not as part of a package. */
function plainLines(cart: CartType | null) {
  return (cart?.items ?? []).filter(
    (item) =>
      item.skuId != null &&
      item.type !== ItemType.PACKAGE &&
      !item.productPackage,
  );
}

function heldQuantity(cart: CartType | null, skuId: number): number {
  return plainLines(cart)
    .filter((item) => Number(item.skuId) === skuId)
    .reduce((sum, item) => sum + (item.quantity ?? 0), 0);
}

/** Mirrors `useStockVisibility` for a signed-in buyer. */
function canSeeStock(event: H3Event): boolean {
  const features = event.context.tenant?.config?.features;
  if (!features || !('stockStatus' in features)) return true;
  return canAccessFeature(features.stockStatus, { authenticated: true });
}

function displayName(product: LookupProduct, sku: LookupSku): string {
  const name = product.name ?? '';
  const skuName = sku.name?.trim();
  if (skusOf(product).length > 1 && skuName && skuName !== name) {
    return name ? `${name} (${skuName})` : skuName;
  }
  return name;
}

/**
 * Sort each file entry into a line the buyer can add or a problem with a
 * reason. A SKU's own article number wins over its product's; a product
 * article number names a SKU only when the product has exactly one, because
 * guessing a variant would put the wrong item in the cart.
 */
export async function resolveOrderEntries(
  entries: OrderFileEntry[],
  options: { userToken: string; cartId?: string },
  event: H3Event,
): Promise<{ lines: CartImportLine[]; problems: CartImportProblem[] }> {
  if (!entries.length) return { lines: [], problems: [] };

  const [products, cart] = await Promise.all([
    lookupProducts(
      entries.map((entry) => entry.articleNumber),
      options.userToken,
      event,
    ),
    options.cartId ? openCart(options.cartId, event) : Promise.resolve(null),
  ]);

  const bySku = new Map<string, Match>();
  const byProduct = new Map<string, LookupProduct>();
  for (const product of products) {
    if (product.articleNumber) {
      const key = articleNumberKey(product.articleNumber);
      if (!byProduct.has(key)) byProduct.set(key, product);
    }
    for (const sku of skusOf(product)) {
      if (!sku.articleNumber) continue;
      const key = articleNumberKey(sku.articleNumber);
      if (!bySku.has(key)) bySku.set(key, { product, sku });
    }
  }

  const problems: CartImportProblem[] = [];
  // Two article numbers can name one SKU; the cart gets one line for it.
  const groups = new Map<number, Match & { entries: OrderFileEntry[] }>();
  for (const entry of entries) {
    const key = articleNumberKey(entry.articleNumber);
    let match = bySku.get(key);
    if (!match) {
      const product = byProduct.get(key);
      const skus = product ? skusOf(product) : [];
      if (product && skus.length > 1) {
        problems.push({
          reason: 'variant_required',
          rows: entry.rows,
          articleNumber: entry.articleNumber,
          name: product.name ?? undefined,
        });
        continue;
      }
      if (product && skus[0]) match = { product, sku: skus[0] };
    }
    if (!match) {
      problems.push({
        reason: 'not_found',
        rows: entry.rows,
        articleNumber: entry.articleNumber,
      });
      continue;
    }
    const group = groups.get(match.sku.skuId);
    if (group) group.entries.push(entry);
    else groups.set(match.sku.skuId, { ...match, entries: [entry] });
  }

  const showStock = canSeeStock(event);
  const basis =
    event.context.tenant?.config?.layout?.stockLevelBasis === 'available'
      ? 'available'
      : 'total';
  const lines: CartImportLine[] = [];
  for (const { product, sku, entries: grouped } of groups.values()) {
    const articleNumber = grouped[0]!.articleNumber;
    const quantity = grouped.reduce((sum, entry) => sum + entry.quantity, 0);
    const rows = grouped.flatMap((entry) => entry.rows).sort((a, b) => a - b);
    const name = displayName(product, sku);
    const inCart = heldQuantity(cart, sku.skuId);
    // A product's total speaks for its SKU only when it has no other.
    const stock =
      sku.stock ??
      (skusOf(product).length === 1 ? product.totalStock : null) ??
      null;
    const problem = (reason: CartImportProblem['reason']) =>
      problems.push({ reason, rows, articleNumber, name });

    // Availability reads the total basis, as the product page does; the
    // tenant's label basis only decides what the buyer is shown.
    if (quantity + inCart > CART_IMPORT_MAX_QUANTITY) {
      problem('quantity_too_large');
    } else if (stock && getStockStatus(stock) === 'out-of-stock') {
      problem('out_of_stock');
    } else if (stock && quantity > purchasableQuantity(stock, inCart)) {
      problem('insufficient_stock');
    } else {
      lines.push({
        articleNumber,
        skuId: sku.skuId,
        name,
        quantity,
        rows,
        inCartQuantity: inCart,
        ...(showStock && stock
          ? { stockStatus: getStockStatus(stock, 5, basis) }
          : {}),
        unitPrice: product.unitPrice ?? null,
      });
    }
  }

  problems.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));
  lines.sort((a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0));
  return { lines, problems };
}

/**
 * The cart, or null when Geins has no open cart by that id. Any other failure
 * is thrown, so a Geins hiccup never swaps the buyer's cart for a new one.
 */
async function openCart(
  cartId: string,
  event: H3Event,
): Promise<CartType | null> {
  const cart = await findCart(cartId, event);
  return cart && !cart.completed ? cart : null;
}

async function forEachWithLimit<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
  until: number,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && Date.now() < until) {
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
}

interface Plan {
  skuId: number;
  quantity: number;
  /** What the cart should hold of this SKU once the import is in. */
  expected: number;
  /** `pending` until a call is made, so after the deadline it means untried. */
  state: 'pending' | 'sent' | 'retry' | 'rejected' | 'quantity_limit';
}

/**
 * A 5xx is worth one more try; a 4xx is Geins saying no. The SDK's CartError
 * does not pass `instanceof`, so `wrapServiceCall` reports a refusal as a 502
 * and it gets the one retry too, which Geins refuses again.
 */
function isTransient(error: unknown): boolean {
  const status =
    error && typeof error === 'object' && 'statusCode' in error
      ? Number((error as { statusCode?: unknown }).statusCode)
      : NaN;
  return !Number.isFinite(status) || status >= 500;
}

/**
 * Bring the cart to `expected` units of the SKU: raise its existing line, or
 * add one. Adding to an existing line through `updateItem` keeps one line per
 * SKU whatever `addToCart` does with a SKU the cart already holds.
 */
async function topUp(
  cartId: string,
  cart: CartType | null,
  skuId: number,
  expected: number,
  event: H3Event,
): Promise<CartType> {
  const missing = expected - heldQuantity(cart, skuId);
  if (missing <= 0 && cart) return cart;
  const line = plainLines(cart).find((item) => Number(item.skuId) === skuId);
  if (line?.id) {
    return updateItem(
      cartId,
      { id: line.id, quantity: line.quantity + missing },
      event,
    );
  }
  return addItem(cartId, { skuId, quantity: missing }, event);
}

/**
 * Add the previewed lines to the buyer's cart.
 *
 * Each SKU is brought to what the previewed cart held plus the file's
 * quantity, so sending the same lines again adds nothing twice. A new cart,
 * made when there was none or it was checked out, holds nothing, so its
 * target is the file's quantity alone. Mutations run a few at a time. The outcome is then read back from the cart
 * itself rather than from the calls: a call can fail after Geins applied it,
 * and two concurrent ones can race, so the cart is the only record that is
 * certainly right. A SKU short of what it should hold gets one sequential
 * retry when its first call went through or failed on our side of a 5xx.
 * Whatever is reported added is in the cart, and nothing else is.
 */
export async function addImportedItems(
  cartId: string | undefined,
  items: CartImportAddItem[],
  event: H3Event,
  deadlineMs: number = ADD_DEADLINE_MS,
): Promise<CartImportAddResult> {
  const until = Date.now() + deadlineMs;
  const open = cartId ? await openCart(cartId, event) : null;
  const start = open ?? (await createCart(event));
  const id = start.id;

  const targets = new Map<number, { quantity: number; held: number }>();
  for (const item of items) {
    const target = targets.get(item.skuId);
    targets.set(item.skuId, {
      quantity: (target?.quantity ?? 0) + item.quantity,
      held: open ? Math.max(target?.held ?? 0, item.inCartQuantity) : 0,
    });
  }
  // The limit counts every line of the SKU, as the preview does.
  const plans: Plan[] = [...targets].map(([skuId, { quantity, held }]) => ({
    skuId,
    quantity,
    expected: held + quantity,
    state:
      held + quantity > CART_IMPORT_MAX_QUANTITY ? 'quantity_limit' : 'pending',
  }));

  await forEachWithLimit(
    plans.filter((plan) => plan.state === 'pending'),
    CART_CONCURRENCY,
    async (plan) => {
      try {
        await topUp(id, start, plan.skuId, plan.expected, event);
        plan.state = 'sent';
      } catch (error) {
        plan.state = isTransient(error) ? 'retry' : 'rejected';
      }
    },
    until,
  );

  let final = await getCart(id, event);
  const short = plans.filter(
    (plan) =>
      (plan.state === 'sent' || plan.state === 'retry') &&
      heldQuantity(final, plan.skuId) < plan.expected,
  );
  if (short.length && Date.now() < until) {
    for (const plan of short) {
      if (Date.now() >= until) break;
      try {
        final = await topUp(id, final, plan.skuId, plan.expected, event);
      } catch {
        // Judged against the cart below.
      }
    }
    final = await getCart(id, event);
  }

  const outcome = new Map<number, CartImportAddFailure | 'added'>();
  for (const plan of plans) {
    if (heldQuantity(final, plan.skuId) >= plan.expected) {
      outcome.set(plan.skuId, 'added');
    } else if (plan.state === 'quantity_limit') {
      outcome.set(plan.skuId, 'quantity_limit');
    } else {
      outcome.set(
        plan.skuId,
        plan.state === 'pending' ? 'timed_out' : 'rejected',
      );
    }
  }

  const added: CartImportAddItem[] = [];
  const failed: CartImportAddResult['failed'] = [];
  for (const item of items) {
    const result = outcome.get(item.skuId);
    if (result === 'added') added.push(item);
    else failed.push({ ...item, reason: result ?? 'rejected' });
  }
  return { cart: final, added, failed };
}
