import type { H3Event } from 'h3';
import { CART_IMPORT_MAX_FILE_BYTES } from '#shared/constants/cart-import';
import { requireAuth, type AuthTokens } from '../auth';
import { cartOwnershipConfigured } from '../cart-ownership';
import { assertFeatureAccess } from '../feature-access';
import { verifiedBuyerId } from '../price-response';
import { getClientIp, type RateLimiter } from '../rate-limiter';

/** The base64 file (4/3 of its size) plus room for the JSON around it. */
const CART_IMPORT_MAX_REQUEST_BYTES =
  Math.ceil(CART_IMPORT_MAX_FILE_BYTES / 3) * 4 + 16 * 1024;

export interface CartImportCaller {
  auth: AuthTokens;
  /** The Geins user id, confirmed by Geins for this session. */
  buyerId: string;
}

/**
 * Gate for both cart import routes, passed before the body is read. A buyer
 * whose session Geins confirms, whatever access rule the tenant gave the
 * feature, on a tenant that turned `cartFileImport` on, lets this buyer place
 * orders and has the cart ownership key configured. The body size is refused
 * from its declared length, and a body without one is refused outright.
 * Requests are limited per address first and then per buyer, so changing the
 * forwarded address does not lift the limit.
 */
export async function guardCartImport(
  event: H3Event,
  limiter: RateLimiter,
): Promise<CartImportCaller> {
  const rate = await limiter.check(getClientIp(event));
  if (!rate.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many cart imports');
  }

  const declaredLength = Number(getRequestHeader(event, 'content-length'));
  if (!Number.isFinite(declaredLength)) {
    throw createError({
      statusCode: 411,
      statusMessage: 'Length Required',
    });
  }
  if (declaredLength > CART_IMPORT_MAX_REQUEST_BYTES) {
    throw createAppError(
      ErrorCode.PAYLOAD_TOO_LARGE,
      'Cart import request too large',
    );
  }

  const auth = await requireAuth(event);

  if (event.context.tenant?.config?.mode === 'catalog') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Not available in catalogue mode',
    });
  }
  await assertFeatureAccess(event, 'cartFileImport', { authenticated: true });
  await assertFeatureAccess(event, 'orderPlacement', { authenticated: true });

  const buyerId = await verifiedBuyerId(event, auth);
  if (!buyerId) {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'Cart import needs a session Geins confirms',
    );
  }
  if (!cartOwnershipConfigured(event)) {
    throw createAppError(
      ErrorCode.SERVICE_UNAVAILABLE,
      'Cart import has no cart ownership key',
    );
  }

  const tenantId =
    event.context.tenant?.tenantId ?? event.context.tenant?.hostname ?? '';
  const perBuyer = await limiter.check(`${tenantId}:buyer:${buyerId}`);
  if (!perBuyer.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many cart imports');
  }

  return { auth, buyerId };
}
