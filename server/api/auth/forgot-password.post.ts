import * as userService from '../../services/user';
import {
  forgotPasswordRateLimiter,
  getClientIp,
} from '../../utils/rate-limiter';
import { ForgotPasswordSchema } from '../../schemas/api-input';
import { logger } from '../../utils/logger';
import { summarizeResetError } from '../../utils/reset-error';

export default defineEventHandler(async (event) => {
  const clientIp = getClientIp(event);
  const rateLimit = await forgotPasswordRateLimiter.check(clientIp);
  // Only the tenant id identifies a request in these logs: never the address,
  // the IP, tokens or upstream error text.
  const tenantId = event.context?.tenant?.tenantId;

  if (!rateLimit.allowed) {
    logger.warn('Password reset request rate limited', { tenantId });
    throw createAppError(
      ErrorCode.RATE_LIMITED,
      'Too many password reset attempts',
    );
  }

  const body = await readValidatedBody(event, ForgotPasswordSchema.parse);

  // Always return success to prevent email enumeration. Geins also answers
  // true for unknown addresses, so a logged success only means Geins
  // accepted the request, not that a mail was sent or delivered.
  try {
    await userService.requestPasswordReset(body.email, event);
    logger.info('Password reset request accepted by Geins', { tenantId });
  } catch (error) {
    // Never reveal the failure to the client, but keep it visible to us
    logger.warn('Password reset request failed', {
      tenantId,
      ...summarizeResetError(error),
    });
  }

  return { success: true };
});
