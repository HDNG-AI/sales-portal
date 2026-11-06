import { requireAdminAuth } from '../../../../utils/admin-auth';
import { setTenantRegistrationEnabled } from '../../../../utils/tenant-crud';
import { UpdateTenantRegistrationSchema } from '../../../../schemas/admin-input';

/**
 * Authenticated, environment-scoped self-registration switch for one tenant.
 * Writes only the portal override in this deployment's KV: no Geins
 * StoreSettings, no global defaults, no other feature and no other tenant.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event, 'write');

  const hostname = getRouterParam(event, 'hostname')?.trim().toLowerCase();
  if (!hostname) {
    throw createAppError(ErrorCode.VALIDATION_ERROR, 'A hostname is required');
  }
  const { enabled } = await readValidatedBody(
    event,
    UpdateTenantRegistrationSchema.parse,
  );
  const result = await setTenantRegistrationEnabled(hostname, enabled, event);
  if (!result) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }
  return result;
});
