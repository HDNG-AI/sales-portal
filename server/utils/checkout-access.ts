import type { H3Event } from 'h3';
import { decodeJwtPayload, optionalAuth } from './auth';
import { ErrorCode, createAppError } from './errors';
import * as userService from '../services/user';

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
export async function requireVerifiedCheckoutBuyer(event: H3Event): Promise<void> {
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
      return;
    }
  } catch {
    // CRM/network failure is a deny, not a guest fallback.
  }
  throw createAppError(ErrorCode.UNAUTHORIZED, 'Verified buyer session required');
}
