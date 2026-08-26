import { createTenant } from '../../utils/tenant-crud';
import { DEFAULT_GEINS_SETTINGS } from '../../utils/tenant';
import { CreateTenantSchema } from '../../schemas/admin-input';

/**
 * One-off tenant onboarding endpoint — the actual "workflow for the next
 * tenant" this exists to validate (see the P0 sales-portal investigation).
 * Takes a hostname plus optional theme/branding/geinsSettings overrides and
 * writes a real, active TenantConfig via the existing createTenant() util
 * (theme derivation, hostname->tenantId mapping, KV write) — nothing here
 * duplicates that logic, this is purely the auth + input-shaping layer.
 *
 * Gated on NUXT_ADMIN_SECRET (?key=), separate from healthCheckSecret since
 * this gates a write (creating/overwriting a tenant), not a read.
 *
 * isActive defaults to false in createTenant() — a tenant created that way
 * would silently 404 on every hostname (resolveTenant only returns active
 * tenants). Always set true here since this endpoint's whole purpose is
 * producing a usable tenant, not a draft.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const query = getQuery(event);
  const providedKey = query.key as string | undefined;
  if (!config.adminSecret || providedKey !== config.adminSecret) {
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
      mode: body.mode,
      checkoutMode: body.checkoutMode,
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
