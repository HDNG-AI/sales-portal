import type { H3Event } from 'h3';
import { createHash } from 'node:crypto';
import { LRUCache } from 'lru-cache';
import type { AuthTokens } from './auth';
import { decodeJwtPayload, optionalAuth } from './auth';
import { canAccessFeature } from '#shared/utils/feature-access';
import { isPriceFacet } from '#shared/utils/filters';
import * as userService from '../services/user';

/**
 * Enforce price visibility at the API boundary, BEFORE Nitro serializes JSON
 * into public responses and Nuxt SSR hydration payloads.
 *
 * A denied response is copied recursively so other request/SDK caches cannot
 * accidentally inherit our redacted objects. A Price facet must be removed
 * from a filters array entirely: its values are numeric even when its keys
 * do not contain the word "price".
 */
const PRICE_FIELD = /price|discount|currency|^vat$|^tax(?:es)?$|^amount$|^offers?$|^rebate|^(?:(?:shipping|payment)?fee|itemValue|lineValue|lineTotal|subTotal|totalAmount|netAmount|grossAmount)(?:Inc|Ex)?(?:Vat)?(?:Formatted)?$/i;

function isPricingFacet(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const facet = value as Record<string, unknown>;
  return isPriceFacet({
    type: typeof facet.type === 'string' ? facet.type : '',
    filterId: typeof facet.filterId === 'string' ? facet.filterId : '',
    group: typeof facet.group === 'string' ? facet.group : null,
  });
}

function removePriceFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter((item) => !isPricingFacet(item)).map(removePriceFields);
  }
  if (!value || typeof value !== 'object') return value;

  const original = value as Record<string, unknown>;
  const safe: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(original)) {
    if (PRICE_FIELD.test(key)) continue;
    safe[key] = removePriceFields(item);
  }
  return safe;
}

// A bounded, process-local positive cache, rather than ever-growing KV keys.
// No JWT, refresh token, user profile or price is stored. Every entry expires
// in <=60 s AND before the token expires, with a 5 s safety margin.
// In-flight dedup prevents parallel product/search/list requests from making
// simultaneous CRM calls for the same token. Revocation visibility <=60 s.
const TOKEN_VALIDITY_TTL_MS = 60_000;
const CLOCK_SAFETY_MS = 5_000;
const validatedTokens = new LRUCache<string, true>({
  max: 2048,
  ttl: TOKEN_VALIDITY_TTL_MS,
});
const inFlight = new Map<string, Promise<boolean>>();

/**
 * Verify a signed-in buyer against the Geins Merchant API itself.
 *
 * crm.auth.getUser(refresh, userToken) is intentionally NOT used: with a
 * userToken the SDK may merely decode the JWT locally (no signature check)
 * and may refresh/rotate tokens that this response cannot safely persist.
 * crm.user.get(authToken) makes a real authenticated network request and does
 * not refresh/rotate tokens. The JWT exp claim is an additional DENY/TTL
 * restriction only; it is never treated as proof of authentication.
 */
async function isVerifiedBuyer(
  event: H3Event,
  auth: AuthTokens | null,
): Promise<boolean> {
  // Preview/login-as sessions have no refresh cookie: no private pricing.
  if (!auth?.authToken || !auth.refreshToken) return false;

  const exp = decodeJwtPayload(auth.authToken)?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return false;
  const now = Date.now();
  const untilExpiryMs = exp * 1000 - now - CLOCK_SAFETY_MS;
  if (untilExpiryMs <= 0) return false;

  const ttl = Math.min(TOKEN_VALIDITY_TTL_MS, untilExpiryMs);
  const tenantId =
    event.context.tenant?.tenantId ??
    event.context.tenant?.config?.tenantId ??
    event.context.tenant?.hostname ??
    '';
  if (!tenantId) return false;

  const key = createHash('sha256')
    .update(tenantId)
    .update(':')
    .update(auth.authToken)
    .digest('hex');

  if (validatedTokens.has(key)) return true;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const verify = (async () => {
    try {
      // The GraphQL getUser query requires the access token and returns a real
      // profile (id, email). Unlike auth.getUser this is not a local JWT decode.
      const profile = await userService.getUser(auth.authToken, event);
      const identity = profile as
        | { id?: string | number; authenticated?: boolean }
        | undefined;
      if (!identity || identity.authenticated === false ||
          (typeof identity.id !== 'string' && typeof identity.id !== 'number')) {
        return false;
      }

      // Cap the cache lifetime again in case the SDK lookup took a while.
      const remaining = Math.min(ttl, exp * 1000 - Date.now() - CLOCK_SAFETY_MS);
      if (remaining > 0) validatedTokens.set(key, true, { ttl: remaining });
      return remaining > 0;
    } catch {
      // No private pricing on CRM/network/tenant config failure.
      return false;
    }
  })();
  inFlight.set(key, verify);
  try {
    return await verify;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Enforce the tenant's effective public-price policy at the server boundary.
 * Unknown tenants retain existing public-price behavior for compatibility.
 * Odelco fails closed if its priceVisibility feature is missing.
 */
export async function protectProductPrices<T>(
  event: H3Event,
  auth: AuthTokens | null,
  result: T,
): Promise<T> {
  const tenant = event.context?.tenant;
  const visibility = tenant?.config?.features?.priceVisibility;
  const tenantId = tenant?.tenantId ?? tenant?.config?.tenantId;
  if (visibility === undefined && tenantId !== 'odelco') return result;
  if (visibility && canAccessFeature(visibility, { authenticated: false })) {
    return result;
  }

  if (visibility?.enabled && visibility.access === 'authenticated' &&
      await isVerifiedBuyer(event, auth)) {
    return result;
  }

  return removePriceFields(result) as T;
}


/**
 * Cart API response guard. An opaque cart ID must not bypass a tenant's
 * private pricing policy after logout, session expiry, or for a guest.
 * Sanitize response copies, never shared Geins SDK objects.
 */
export async function protectCartPrices<T>(event: H3Event, result: T): Promise<T> {
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const tenant = event.context?.tenant;
  const visibility = tenant?.config?.features?.priceVisibility;
  const tenantId = tenant?.tenantId ?? tenant?.config?.tenantId;
  if (visibility === undefined && tenantId !== 'odelco') return result;
  if (visibility && canAccessFeature(visibility, { authenticated: false })) return result;
  const auth = await optionalAuth(event);
  return protectProductPrices(event, auth, result);
}
