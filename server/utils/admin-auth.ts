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
 * the stronger of the two. A third, NUXT_ADMIN_CATALOG_SECRET, is never
 * accepted here; see requireCatalogAdminAuth.
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
  // The catalog key is matched too, for timing, and then ignored: it opens
  // only the routes that call requireCatalogAdminAuth below.
  const { matchesWrite, matchesRead } = await matchAdminKey(event);
  return { scope: adminScope(matchesWrite, matchesRead, required) };
}

/** What the caller's key matched, after the rate limit. */
interface AdminKeyMatch {
  matchesWrite: boolean;
  matchesRead: boolean;
  matchesCatalog: boolean;
  catalogHostnames: string[];
}

/**
 * Rate limit, then compare the `x-admin-key` header against every configured
 * secret. All comparisons are evaluated before any is acted on: returning as
 * soon as the write secret matches would make a response to a read key
 * measurably slower than one to a write key, which is exactly the signal the
 * constant-time compare exists to suppress.
 */
async function matchAdminKey(event: H3Event): Promise<AdminKeyMatch> {
  const clientIp = getClientIp(event);
  const rateLimit = await adminAuthRateLimiter.check(clientIp);
  if (!rateLimit.allowed) {
    throw createAppError(ErrorCode.RATE_LIMITED, 'Too many requests');
  }

  const config = readAdminAuthConfig(event);
  const providedKey = getHeader(event, 'x-admin-key') ?? '';
  const matches = (secret: string | undefined): boolean =>
    !!secret && !!providedKey && timingSafeStringEqual(providedKey, secret);

  const matchesWrite = matches(config.adminSecret);
  const matchesRead = matches(config.adminReadSecret);
  const matchesCatalog = matches(config.adminCatalogSecret);
  return {
    matchesWrite,
    matchesRead,
    matchesCatalog,
    catalogHostnames: config.adminCatalogHostnames ?? [],
  };
}

/** The scope of a write or read key, or the 401 for anything else. */
function adminScope(
  matchesWrite: boolean,
  matchesRead: boolean,
  required: AdminScope,
): AdminScope {
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
  return scope;
}

export interface CatalogAdminCaller extends AdminCaller {
  /** True when the narrow catalog key, not a full admin key, opened the route. */
  catalog: boolean;
}

/**
 * Gate for the guest-hidden-brands endpoints only, which a tenant-facing
 * admin app calls. That app must not hold NUXT_ADMIN_SECRET, which rewrites
 * every tenant's config, so these routes also accept NUXT_ADMIN_CATALOG_SECRET:
 * a key that reads and writes this one setting and opens nothing else
 * (requireAdminAuth never accepts it). With NUXT_ADMIN_CATALOG_HOSTNAMES set
 * it is further limited to those hostnames, and any other answers 403.
 *
 * The write key opens both methods and the read key opens reads, exactly as
 * on every other admin route. An unset catalog secret matches nothing, so the
 * key simply does not exist. Same header, constant-time compare and rate
 * limit as requireAdminAuth.
 *
 * `hostname` is the one named in the path, lowercased; it is compared as
 * given, so an alias of an allowed tenant is not allowed unless listed.
 */
export async function requireCatalogAdminAuth(
  event: H3Event,
  required: AdminScope,
  hostname: string,
): Promise<CatalogAdminCaller> {
  const { matchesWrite, matchesRead, matchesCatalog, catalogHostnames } =
    await matchAdminKey(event);

  if (matchesWrite || (matchesRead && required === 'read')) {
    return {
      scope: adminScope(matchesWrite, matchesRead, required),
      catalog: false,
    };
  }
  if (matchesCatalog) {
    if (
      catalogHostnames.length > 0 &&
      !catalogHostnames.includes(hostname.trim().toLowerCase())
    ) {
      throw createAppError(
        ErrorCode.FORBIDDEN,
        'This key is not allowed for this hostname',
      );
    }
    return { scope: required, catalog: true };
  }
  return {
    scope: adminScope(matchesWrite, matchesRead, required),
    catalog: false,
  };
}
