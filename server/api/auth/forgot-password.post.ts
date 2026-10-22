import * as userService from '../../services/user';
import {
  forgotPasswordRateLimiter,
  getClientIp,
} from '../../utils/rate-limiter';
import { ForgotPasswordSchema } from '../../schemas/api-input';
import { logger } from '../../utils/logger';

// Upstream error text could in theory echo request variables; strip anything
// address-shaped so the log can never hold an e-mail address.
function redactAddresses(text: string | undefined): string | undefined {
  return text?.replace(/[^\s@"'<>]+@[^\s@"'<>]+/g, '[redacted]');
}

export default defineEventHandler(async (event) => {
  const clientIp = getClientIp(event);
  const rateLimit = await forgotPasswordRateLimiter.check(clientIp);
  // The address is never logged: tenant id is enough to find the request.
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
      errorMessage: redactAddresses(
        error instanceof Error ? error.message : String(error),
      ),
      originalMessage: redactAddresses(
        (error as { data?: { originalMessage?: string } })?.data
          ?.originalMessage,
      ),
    });
  }

  return { success: true };
});
