import type { H3Event } from 'h3';
import type { AuthTokens } from './auth';
import { canAccessFeature } from '#shared/utils/feature-access';
import * as authService from '../services/auth';

/**
 * Product price fields must not be sent to a browser when the tenant denies
 * priceVisibility. Hiding PriceSlot is insufficient: the API response is also
 * serialized into Nuxt SSR hydration data.
 *
 * Price data can appear in the product, its variants, related items, search
 * results and price-history objects. Keep this allow/deny decision at the
 * server boundary and recursively strip fields from a fresh response copy.
 */
const PRICE_FIELD = /price|discount|currency|^vat$|^tax(?:es)?$|^amount$|^offers?$|^rebate/i;

function removePriceFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removePriceFields);
  if (!value || typeof value !== 'object') return value;

  const original = value as Record<string, unknown>;
  const safe: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(original)) {
    if (PRICE_FIELD.test(key)) continue;
    safe[key] = removePriceFields(item);
  }
  return safe;
}

/**
 * Mirrors the public/client feature policy but validates a session via CRM.
 * Merely having an auth cookie is NOT proof of authorization: optionalAuth()
 * can return an expired, unsigned or otherwise invalid token pair.
 *
 * If there is no priceVisibility feature, other tenants retain the existing
 * default (public prices). All failures while validating a restricted
 * Odelco-style tenant fail closed, without affecting the product content.
 */
export async function protectProductPrices<T>(
  event: H3Event,
  auth: AuthTokens | null,
  result: T,
): Promise<T> {
  const visibility = event.context?.tenant?.config?.features?.priceVisibility;

  // Keep legacy public-price behavior for tenants without a configured gate.
  if (visibility === undefined) return result;
  if (canAccessFeature(visibility, { authenticated: false })) return result;

  if (visibility.enabled && visibility.access === 'authenticated' &&
      auth?.authToken && auth.refreshToken) {
    try {
      const identity = await authService.getUser(auth.refreshToken, auth.authToken, event);
      if (identity?.succeeded && identity.user) return result;
    } catch {
      // Invalid session or CRM transport error: never expose private prices.
    }
  }

  return removePriceFields(result) as T;
}
