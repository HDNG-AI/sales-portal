import { createTenant } from '../../utils/tenant-crud';
import { DEFAULT_GEINS_SETTINGS, resolveTenant } from '../../utils/tenant';
import { CreateTenantSchema } from '../../schemas/admin-input';
import { requireAdminAuth } from '../../utils/admin-auth';

/**
 * Admin tenant onboarding endpoint. Takes a hostname plus optional
 * aliases/theme/branding/geinsSettings overrides and writes a real, active
 * TenantConfig via the existing createTenant() util (theme derivation,
 * hostname->tenantId mapping, KV write) — nothing here duplicates that
 * logic, this is purely the auth + input-shaping layer.
 *
 * This is a storefront-preview/theming tool for the period before a
 * tenant's real Geins credentials and catalog exist, not the substantive
 * onboarding step itself — that's setting up the merchant's Geins account
 * and product catalog, which happens on Geins' side.
 *
 * Gated on NUXT_ADMIN_SECRET via requireAdminAuth (server/utils/admin-auth.ts).
 *
 * isActive defaults to false in createTenant() — a tenant created that way
 * would silently 404 on every hostname (resolveTenant only returns active
 * tenants). Always set true here since this endpoint's whole purpose is
 * producing a usable tenant, not a draft.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event);

  const body = await readValidatedBody(event, CreateTenantSchema.parse);

  // A hostname that already resolves to a live tenant needs an explicit
  // signal that this call means to update it — otherwise a typo'd
  // hostname (or a tenantId that doesn't match what's actually there)
  // would silently overwrite an unrelated tenant's live config.
  const existingViaHostname = await resolveTenant(body.hostname);
  if (existingViaHostname) {
    if (body.tenantId && body.tenantId !== existingViaHostname.tenantId) {
      throw createAppError(
        ErrorCode.CONFLICT,
        `Hostname "${body.hostname}" already belongs to tenant "${existingViaHostname.tenantId}", not "${body.tenantId}"`,
      );
    }
    if (!body.allowUpdate) {
      throw createAppError(
        ErrorCode.CONFLICT,
        `A tenant already exists for hostname "${body.hostname}" (tenantId "${existingViaHostname.tenantId}"). Pass allowUpdate: true to update it intentionally.`,
      );
    }
  }

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
