import type { H3Event } from 'h3';
import type { CheckoutSummaryType } from '@geins/types';
import type { AuthTokens } from './auth';
import { decodeJwtPayload, optionalAuth } from './auth';
import { ErrorCode, createAppError } from './errors';
import * as userService from '../services/user';
import { listOrders } from '../services/orders';

/**
 * The checkout endpoints are shared across many Geins tenants. Odelco is
 * mandatory-private until its explicit tenant privacy contract is migrated
 * (#40). Other tenants opt in using their existing effective feature policy.
 */
export function requiresVerifiedCheckoutBuyer(event: H3Event): boolean {
  const tenant = event.context.tenant;
  // No resolved config (e.g. a ?preview=1 request whose merchant API call
  // failed) tells us nothing about the tenant's policy, so treat it as
  // private. The SDK can still resolve the tenant from KV in that case.
  if (!tenant?.config) return true;
  const id = tenant?.tenantId ?? tenant?.config?.tenantId;
  const features = tenant?.config?.features;
  return (
    id === 'odelco' ||
    features?.priceVisibility?.access === 'authenticated' ||
    features?.orderPlacement?.access === 'authenticated'
  );
}

/**
 * Deny absent, expired, preview-only or CRM-unverified sessions before
 * returning private checkout/order data. An unverified cookie is not an
 * authorization decision. Unlike product-price reads, this does not cache
 * positive authentication decisions for order details.
 *
 * This is session validation only. The OMS order/cart ownership guarantee
 * requires a distinct security review and integration test (#42).
 */
export async function requireVerifiedCheckoutBuyer(
  event: H3Event,
): Promise<AuthTokens> {
  const tokens = await optionalAuth(event);
  if (!tokens?.authToken || !tokens.refreshToken) {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'Verified buyer session required',
    );
  }

  const exp = decodeJwtPayload(tokens.authToken)?.exp;
  if (
    typeof exp !== 'number' ||
    !Number.isFinite(exp) ||
    exp * 1000 <= Date.now() + 5_000
  ) {
    throw createAppError(ErrorCode.UNAUTHORIZED, 'Buyer session expired');
  }

  try {
    // A real Geins CRM query, not a local JWT decode or token refresh.
    const buyer = await userService.getUser(tokens.authToken, event);
    const identity = buyer as
      | { id?: unknown; authenticated?: boolean }
      | undefined;
    if (
      identity?.authenticated !== false &&
      (typeof identity?.id === 'string' || typeof identity?.id === 'number')
    ) {
      return tokens;
    }
  } catch {
    // CRM/network failure is a deny, not a guest fallback.
  }
  throw createAppError(
    ErrorCode.UNAUTHORIZED,
    'Verified buyer session required',
  );
}

/**
 * Geins getCompanyOrders is the company-scoped order listing already used by
 * Odelco's order list. Treat *membership in that listing* as the access rule,
 * not the placing employee's active flag: historical orders remain accessible
 * when a colleague leaves and orders without customerId still work.
 *
 * Match only the server-returned ID of the order retrieved from Geins:
 * - checkout summary -> internal orderId (getCompanyOrders.id)
 * - order detail -> publicId (getCompanyOrders.publicId)
 *
 * Fail closed on absent IDs, unavailable scoped listing and any other error.
 * No order identifiers or personally identifiable fields are logged here.
 *
 * Applies to every tenant. Use it where the caller has no other ownership
 * guarantee, as for order detail: `getOrderPublic` reads any order by its
 * public ID. `requireOdelcoOrderOwnership` is the same check limited to
 * Odelco and to requests with no resolved tenant config.
 */
export async function requireCompanyOrderOwnership(
  event: H3Event,
  tokens: AuthTokens,
  orderId: unknown,
  idType: 'internal' | 'public' = 'internal',
): Promise<void> {
  if (typeof orderId !== 'number' && typeof orderId !== 'string') {
    throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
  }
  const id = String(orderId).trim();
  if (!id || (idType === 'internal' && !/^\d+$/.test(id))) {
    throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
  }

  try {
    // getCompanyOrders runs with the verified token, not the request cookie,
    // which is stale after a silent refresh. Unlike getOrderPublic, it
    // returns only the authenticated company's orders.
    const { orders } = await listOrders(event, tokens.authToken);
    const permitted = orders.some((order) => {
      const value = idType === 'public' ? order.publicId : order.id;
      return value !== undefined && value !== null && String(value) === id;
    });
    if (permitted) return;
  } catch {
    // Geins list failure, invalid company context, etc. -> deny.
  }
  throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
}

/**
 * `requireCompanyOrderOwnership` for Odelco and for a request with no
 * resolved tenant config. A resolved non-Odelco tenant passes unchecked.
 */
export async function requireOdelcoOrderOwnership(
  event: H3Event,
  tokens: AuthTokens,
  orderId: unknown,
  idType: 'internal' | 'public' = 'internal',
): Promise<void> {
  const tenant = event.context.tenant;
  // Skip only for a resolved non-Odelco tenant. An unresolved one is checked.
  if (
    tenant?.config &&
    (tenant.tenantId ?? tenant.config.tenantId) !== 'odelco'
  ) {
    return;
  }
  return requireCompanyOrderOwnership(event, tokens, orderId, idType);
}

export async function requireOdelcoSummaryOwnership(
  event: H3Event,
  tokens: AuthTokens,
  summary: CheckoutSummaryType,
): Promise<void> {
  return requireOdelcoOrderOwnership(
    event,
    tokens,
    summary.order?.orderId,
    'internal',
  );
}
