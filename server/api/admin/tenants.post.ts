import { timingSafeEqual } from 'node:crypto';
import { createTenant } from '../../utils/tenant-crud';
import { DEFAULT_GEINS_SETTINGS } from '../../utils/tenant';
import { CreateTenantSchema } from '../../schemas/admin-input';

/**
 * One-off tenant onboarding endpoint — the actual "workflow for the next
 * tenant" this exists to validate (see the P0 sales-portal investigation).
 * Takes a hostname plus optional aliases/theme/branding/geinsSettings
 * overrides and writes a real, active TenantConfig via the existing
 * createTenant() util
 * (theme derivation, hostname->tenantId mapping, KV write) — nothing here
 * duplicates that logic, this is purely the auth + input-shaping layer.
 *
 * Gated on NUXT_ADMIN_SECRET via the X-Admin-Key header, separate from
 * healthCheckSecret since this gates a write (creating/overwriting a
 * tenant), not a read. A header, not a query param, so the secret never
 * lands in a request URL that gets logged (server/plugins/01.request-
 * logging.ts logs event.path on every request) or cached/proxied
 * indiscriminately the way a URL can be. Compared in constant time — this
 * is the highest-privilege write path in the app (full create/overwrite
 * of any tenant), so it gets at least the same bar as the HMAC secret
 * compare in server/utils/webhook.ts, not the plain `!==` used for the
 * much lower-stakes healthCheckSecret.
 *
 * isActive defaults to false in createTenant() — a tenant created that way
 * would silently 404 on every hostname (resolveTenant only returns active
 * tenants). Always set true here since this endpoint's whole purpose is
 * producing a usable tenant, not a draft.
 */

function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

/**
 * The full admin-key decision: no configured secret and no/mismatched
 * provided key both deny. Pulled out of the handler so the decision logic
 * (as opposed to the H3/Nitro plumbing around it) is unit-testable.
 */
export function isValidAdminKey(
  providedKey: string | undefined,
  configuredSecret: string | undefined,
): boolean {
  if (!configuredSecret || !providedKey) return false;
  return constantTimeEqual(providedKey, configuredSecret);
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const providedKey = getHeader(event, 'x-admin-key');
  if (!isValidAdminKey(providedKey, config.adminSecret)) {
    throw createAppError(
      ErrorCode.UNAUTHORIZED,
      'Invalid or missing admin key',
    );
  }

  const body = await readValidatedBody(event, CreateTenantSchema.parse);

  const tenant = await createTenant({
    hostname: body.hostname,
    tenantId: body.tenantId,
    config: {
      isActive: true,
      aliases: body.aliases,
      mode: body.mode,
      checkoutMode: body.checkoutMode,
      timezone: body.timezone,
      theme: body.theme,
      branding: body.branding
        ? { watermark: 'none', ...body.branding }
        : undefined,
      geinsSettings: body.geinsSettings
        ? {
            environment: 'production',
            availableLocales: [body.geinsSettings.locale],
            availableMarkets: [body.geinsSettings.market],
            ...body.geinsSettings,
          }
        : { ...DEFAULT_GEINS_SETTINGS },
    },
  });

  return {
    tenantId: tenant.tenantId,
    hostname: tenant.hostname,
    themeHash: tenant.themeHash,
  };
});
