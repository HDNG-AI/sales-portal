import type { H3Event } from 'h3';
import { getHeader } from 'h3';
import { timingSafeEqual } from 'node:crypto';
import { RateLimiter, getClientIp } from './rate-limiter';

const adminAuthRateLimiter = new RateLimiter({
  limit: 5,
  windowMs: 60_000,
  prefix: 'admin-auth',
});

/**
 * Constant-time string comparison. timingSafeEqual requires equal-length
 * buffers, so a length mismatch returns false before reaching it — leaking
 * the two values' length isn't the property this protects; leaking how
 * many leading bytes matched is.
 *
 * Exported so this decision logic is directly unit-testable, independent
 * of the H3/Nitro plumbing (rate limiter, headers, runtime config) around
 * it in requireAdminAuth below — and so other secret-gated endpoints (see
 * server/api/health.get.ts) can reuse it instead of a plain `!==`.
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Guards an admin-only write endpoint: rate-limits by client IP, then
 * requires an `x-admin-key` header matching NUXT_ADMIN_SECRET via a
 * constant-time comparison. Throws (429/401) on failure.
 *
 * Extracted so every admin endpoint shares one auth gate instead of each
 * hand-rolling its own — the secret gates tenant-config writes, so it
 * deserves the same treatment this codebase already gives its other
 * sensitive write paths: a header (not a `?key=` query param, which lands
 * in access logs and gets replayed via Referer on the next navigation), a
 * constant-time compare (see server/utils/webhook.ts's verifySignature for
 * the equivalent on the webhook path), and a rate limit (see
 * server/utils/rate-limiter.ts's other exports, applied to every other
 * comparable write in this app).
 */
export async function requireAdminAuth(event: H3Event): Promise<void> {
  const clientIp = getClientIp(event);
  const rateLimit = await adminAuthRateLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many requests');
  }

  const config = useRuntimeConfig(event);
  const providedKey = getHeader(event, 'x-admin-key');
  if (
    !config.adminSecret ||
    !providedKey ||
    !timingSafeStringEqual(providedKey, config.adminSecret)
  ) {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'Invalid or missing admin key',
    );
  }
}
