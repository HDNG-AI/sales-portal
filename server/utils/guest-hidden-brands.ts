import type { H3Event } from 'h3';
import type { AuthTokens } from './auth';
import { isVerifiedBuyer } from './price-response';
import {
  tenantIdKey,
  tenantOverrideKey,
  type TenantPortalOverrides,
} from './tenant';
import { lookupHostname } from './lookup-hostname';
import { normalizeBrandIds } from './hidden-brands';

/**
 * The tenant's stored list when the request carries no resolved config.
 *
 * That happens for a `?preview=1` request whose merchant API call failed: the
 * context keeps only the hostname, yet the SDK still serves the tenant's
 * catalogue. Reading the portal-owned override straight from KV keeps the
 * brands hidden there too. KV only, never a merchant API call; any failure
 * reads as "no list", the same as a tenant the SDK cannot resolve either.
 */
async function storedGuestHiddenBrandIds(hostname: string): Promise<number[]> {
  try {
    const storage = useStorage('kv');
    const tenantId = await storage.getItem<string>(
      tenantIdKey(lookupHostname(hostname)),
    );
    if (!tenantId) return [];
    const overrides = await storage.getItem<TenantPortalOverrides>(
      tenantOverrideKey(tenantId),
    );
    return normalizeBrandIds(overrides?.catalog?.guestHiddenBrandIds);
  } catch {
    return [];
  }
}

/**
 * The brand ids this request must not see: the tenant's
 * `catalog.guestHiddenBrandIds` for a guest, and nothing for a signed-in buyer
 * or a tenant without the setting.
 *
 * Signed in means what it means for B2B prices (isVerifiedBuyer in
 * ./price-response.ts): a session with a refresh token whose access token
 * Geins itself accepted within the last minute. An auth cookie alone does not
 * count, since anyone can set one, and preview or login-as sessions, which
 * carry no refresh token, see the guest catalogue. Every failure to verify
 * falls back to the guest view, so a CRM outage hides the brands from buyers
 * for its duration rather than showing them to everyone.
 *
 * Only asks Geins about the session when the tenant has a list at all, so a
 * tenant without the setting pays nothing for it.
 */
export async function guestHiddenBrandIds(
  event: H3Event,
  auth: AuthTokens | null,
): Promise<number[]> {
  const tenant = event.context?.tenant;
  const hidden = tenant?.config
    ? normalizeBrandIds(tenant.config.catalog?.guestHiddenBrandIds)
    : tenant?.hostname
      ? await storedGuestHiddenBrandIds(tenant.hostname)
      : [];
  if (hidden.length === 0) return [];
  if (auth?.authToken && (await isVerifiedBuyer(event, auth))) return [];
  return hidden;
}
