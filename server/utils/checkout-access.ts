import type { H3Event } from 'h3';
import type { CheckoutSummaryType } from '@geins/types';
import type { AuthTokens } from './auth';
import { decodeJwtPayload, optionalAuth } from './auth';
import { ErrorCode, createAppError } from './errors';
import * as userService from '../services/user';
import { getCompany } from '../services/company';

/**
 * The checkout endpoints are shared across many Geins tenants. Odelco is
 * mandatory-private until its explicit tenant privacy contract is migrated
 * (#40). Other tenants opt in using their existing effective feature policy.
 */
export function requiresVerifiedCheckoutBuyer(event: H3Event): boolean {
  const tenant = event.context.tenant;
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
export async function requireVerifiedCheckoutBuyer(event: H3Event): Promise<AuthTokens> {
  const tokens = await optionalAuth(event);
  if (!tokens?.authToken || !tokens.refreshToken) {
    throw createAppError(ErrorCode.UNAUTHORIZED, 'Verified buyer session required');
  }

  const exp = decodeJwtPayload(tokens.authToken)?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) ||
      exp * 1000 <= Date.now() + 5_000) {
    throw createAppError(ErrorCode.UNAUTHORIZED, 'Buyer session expired');
  }

  try {
    // A real Geins CRM query, not a local JWT decode or token refresh.
    const buyer = await userService.getUser(tokens.authToken, event);
    const identity = buyer as { id?: unknown; authenticated?: boolean } | undefined;
    if (identity?.authenticated !== false &&
        (typeof identity?.id === 'string' || typeof identity?.id === 'number')) {
      return tokens;
    }
  } catch {
    // CRM/network failure is a deny, not a guest fallback.
  }
  throw createAppError(ErrorCode.UNAUTHORIZED, 'Verified buyer session required');
}

/**
 * Odelco B2B order IDs are NOT permission grants. The checkout summary's
 * customerId identifies the order-placing buyer; the Geins getCompany API
 * returns that same numeric ID as CompanyBuyer.internalId for the current
 * authenticated company's buyer roster (see services/orders.ts).
 *
 * Fail closed on absent identity/roster, inactive buyer, or CRM failure.
 * Do not log order IDs, customer IDs, addresses or monetary fields.
 */
export async function requireOdelcoOrderOwnership(
  event: H3Event,
  tokens: AuthTokens,
  customerId: unknown,
): Promise<void> {
  const tenant = event.context.tenant;
  if ((tenant?.tenantId ?? tenant?.config?.tenantId) !== 'odelco') return;

  // Checkout summaries carry numbers; order-detail SDK results carry strings.
  const raw = typeof customerId === 'number' || typeof customerId === 'string'
    ? String(customerId)
    : '';
  const id = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
  }

  try {
    const company = await getCompany(event, tokens.authToken);
    // Only buyers from the authenticated company's Geins roster may read
    // the order. Never trust a supplied order/public ID as authorization.
    const permitted = company?.buyers?.some(
      (buyer) => buyer.active && buyer.internalId === String(id),
    );
    if (permitted) return;
  } catch {
    // Company service unavailable -> deny without releasing order metadata.
  }

  // 404 matches the not-found response for nonexistent order IDs so that
  // callers cannot distinguish someone else's order by status code.
  throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
}

export async function requireOdelcoSummaryOwnership(
  event: H3Event,
  tokens: AuthTokens,
  summary: CheckoutSummaryType,
): Promise<void> {
  return requireOdelcoOrderOwnership(event, tokens, summary.order?.customerId);
}
