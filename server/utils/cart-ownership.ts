import type { H3Event } from 'h3';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readCartOwnerSecret } from './cart-ownership-config';
import { getCartOwnerCookie, setCartOwnerCookie } from './cookies';

/**
 * Proof that a cart belongs to the caller.
 *
 * A Geins cart has no owner: anyone who knows its id can read and change it,
 * and the id travels in a cookie the client can read. So the server gives the
 * browser it hands a cart to an httpOnly cookie holding an HMAC over the
 * tenant, the cart id and the owner. Knowing a cart id is not enough to make
 * that cookie, and a proof from one tenant never matches on another.
 *
 * - `POST /api/cart` gives the creating browser a proof with no buyer in it.
 * - The first import by a signed-in buyer binds that proof to the buyer, so
 *   another buyer signing in on the same browser cannot use the cart.
 * - A cart the import creates is bound to its buyer from the start.
 *
 * Only the cart file import checks the proof; the other cart routes still
 * accept any cart id. One cookie holds the proof of the latest cart only.
 */

const VERSION = 'v1';
/** The owner of a cart that no buyer has claimed yet. */
const ANY_BUYER = '';

function tenantKey(event: H3Event): string {
  return (
    event.context.tenant?.tenantId ??
    event.context.tenant?.config?.tenantId ??
    event.context.tenant?.hostname ??
    ''
  );
}

function proofFor(
  key: string,
  tenantId: string,
  cartId: string,
  owner: string,
): string {
  return createHmac('sha256', key)
    .update(JSON.stringify([VERSION, tenantId, cartId, owner]))
    .digest('base64url');
}

function sameProof(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Whether proofs can be made and checked here at all. */
export function cartOwnershipConfigured(event: H3Event): boolean {
  return Boolean(readCartOwnerSecret(event) && tenantKey(event));
}

/**
 * Give the browser the proof of a cart it was just handed, bound to the buyer
 * when there is one. Does nothing while the key is not configured.
 */
export function issueCartProof(
  event: H3Event,
  cartId: string,
  buyerId?: string,
): void {
  const key = readCartOwnerSecret(event);
  const tenantId = tenantKey(event);
  if (!key || !tenantId) return;
  setCartOwnerCookie(
    event,
    proofFor(key, tenantId, cartId, buyerId || ANY_BUYER),
  );
}

/**
 * Whether the cart is this buyer's. It is when the cookie proves the cart was
 * bound to them, or that this browser was handed the cart and no buyer has
 * claimed it yet; the cart is then bound to them from here on.
 */
export function claimCart(
  event: H3Event,
  cartId: string,
  buyerId: string,
): boolean {
  const key = readCartOwnerSecret(event);
  const tenantId = tenantKey(event);
  const proof = getCartOwnerCookie(event);
  if (!key || !tenantId || !buyerId || !proof) return false;

  const bound = proofFor(key, tenantId, cartId, buyerId);
  if (sameProof(proof, bound)) return true;
  if (sameProof(proof, proofFor(key, tenantId, cartId, ANY_BUYER))) {
    setCartOwnerCookie(event, bound);
    return true;
  }
  return false;
}
