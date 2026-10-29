import type { H3Event } from 'h3';
import { CART_IMPORT_MAX_FILE_BYTES } from '#shared/constants/cart-import';
import { requireAuth, type AuthTokens } from '../auth';
import { assertFeatureAccess } from '../feature-access';
import { getClientIp, type RateLimiter } from '../rate-limiter';

/** The base64 file (4/3 of its size) plus room for the JSON around it. */
const CART_IMPORT_MAX_REQUEST_BYTES =
  Math.ceil(CART_IMPORT_MAX_FILE_BYTES / 3) * 4 + 16 * 1024;

/**
 * Gate for both cart import routes. A signed-in buyer only, whatever access
 * rule the tenant gave the feature, on a tenant that turned `cartFileImport`
 * on and lets this buyer place orders. The body size is refused from its
 * declared length before anything reads it.
 */
export async function guardCartImport(
  event: H3Event,
  limiter: RateLimiter,
): Promise<AuthTokens> {
  const rate = await limiter.check(getClientIp(event));
  if (!rate.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many cart imports');
  }

  const declaredLength = Number(getRequestHeader(event, 'content-length'));
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

  return auth;
}
