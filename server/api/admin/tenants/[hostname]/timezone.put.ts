import { requireAdminAuth } from '../../../../utils/admin-auth';
import { setTenantOperatingTimezone } from '../../../../utils/tenant-crud';
import { UpdateTenantTimezoneSchema } from '../../../../schemas/admin-input';

/**
 * Set a portal-owned operating timezone without taking over a Geins tenant.
 * Unlike POST /api/admin/tenants, no aliases, credentials, themes or
 * configuration provenance can be modified via this route.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event, 'write');

  const hostname = getRouterParam(event, 'hostname')?.trim().toLowerCase();
  if (!hostname) {
    throw createAppError(ErrorCode.VALIDATION_ERROR, 'A hostname is required');
  }
  const { timezone } = await readValidatedBody(
    event,
    UpdateTenantTimezoneSchema.parse,
  );
  const result = await setTenantOperatingTimezone(hostname, timezone, event);
  if (!result) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }
  return result;
});
