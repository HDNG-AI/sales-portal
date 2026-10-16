import { requireAdminAuth } from '../../../../utils/admin-auth';
import { setTenantProductTextPlacement } from '../../../../utils/tenant-crud';
import { UpdateTenantProductTextPlacementSchema } from '../../../../schemas/admin-input';

/**
 * Authenticated, scoped configuration for product copy presentation.
 * Does not modify merchant-owned Geins settings or any product text.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event, 'write');

  const hostname = getRouterParam(event, 'hostname')?.trim().toLowerCase();
  if (!hostname) {
    throw createAppError(ErrorCode.VALIDATION_ERROR, 'A hostname is required');
  }
  const { productTextPlacement } = await readValidatedBody(
    event,
    UpdateTenantProductTextPlacementSchema.parse,
  );
  const result = await setTenantProductTextPlacement(
    hostname,
    productTextPlacement,
    event,
  );
  if (!result) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }
  return result;
});
