import type { H3Event } from 'h3';
import { getHeader } from 'h3';
import { timingSafeEqual } from 'node:crypto';
import { RateLimiter, getClientIp } from './rate-limiter';
import { readAdminAuthConfig } from './admin-config';

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

/** What a caller is allowed to do. `write` implies `read`. */
export type AdminScope = 'read' | 'write';

export interface AdminCaller {
  scope: AdminScope;
}

/**
 * Guards an admin endpoint: rate-limits by client IP, then requires an
 * `x-admin-key` header matching one of the configured secrets via a
 * constant-time comparison. Throws (429/401) on failure, and otherwise
 * returns which scope the caller's key carries.
 *
 * Two secrets rather than one because the callers differ in what they
 * need. NUXT_ADMIN_SECRET grants writes across every tenant, which is the
 * right shape for a human onboarding a tenant and the wrong shape for a
 * service that only needs to look one up: handing a read-only consumer a
 * credential that can rewrite every tenant's config makes the blast radius
 * of losing that credential the whole estate. NUXT_ADMIN_READ_SECRET is
 * that narrower credential. The write secret still satisfies a read, being
 * the stronger of the two.
 *
 * This is a scope boundary, not a role model — there is still no per-tenant
 * authorization, so a read key reads *every* tenant. Narrowing that means
 * resolving identity against HDNG Core rather than inventing a third auth
 * system here.
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
export async function requireAdminAuth(
  event: H3Event,
  required: AdminScope = 'write',
): Promise<AdminCaller> {
  const clientIp = getClientIp(event);
  const rateLimit = await adminAuthRateLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many requests');
  }

  const config = readAdminAuthConfig(event);
  const providedKey = getHeader(event, 'x-admin-key') ?? '';

  // Both comparisons are evaluated before either is acted on. Returning as
  // soon as the write secret matches would make a response to a read key
  // measurably slower than one to a write key, which is exactly the signal
  // the constant-time compare exists to suppress.
  const matchesWrite =
    !!config.adminSecret &&
    !!providedKey &&
    timingSafeStringEqual(providedKey, config.adminSecret);
  const matchesRead =
    !!config.adminReadSecret &&
    !!providedKey &&
    timingSafeStringEqual(providedKey, config.adminReadSecret);

  const scope: AdminScope | null = matchesWrite
    ? 'write'
    : matchesRead
      ? 'read'
      : null;

  if (!scope) {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'Invalid or missing admin key',
    );
  }
  if (required === 'write' && scope !== 'write') {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'This key is read-only and cannot be used to write tenant config',
    );
  }
  return { scope };
}
