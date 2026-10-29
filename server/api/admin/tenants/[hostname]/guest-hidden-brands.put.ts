import { requireCatalogAdminAuth } from '../../../../utils/admin-auth';
import { setTenantGuestHiddenBrands } from '../../../../utils/tenant-crud';
import { UpdateTenantGuestHiddenBrandsSchema } from '../../../../schemas/admin-input';

/**
 * Replace the Geins brand ids a tenant hides from visitors who are not signed
 * in. Portal-owned: nothing in Geins changes, and signed-in buyers keep
 * seeing and buying every brand. An empty list hides nothing.
 *
 * Opened by the write key or the catalog key, never the read key.
 */
export default defineEventHandler(async (event) => {
  const hostname = getRouterParam(event, 'hostname')?.trim().toLowerCase();
  await requireCatalogAdminAuth(event, 'write', hostname ?? '');

  if (!hostname) {
    throw createAppError(ErrorCode.VALIDATION_ERROR, 'A hostname is required');
  }
  const { brandIds } = await readValidatedBody(
    event,
    UpdateTenantGuestHiddenBrandsSchema.parse,
  );
  const result = await setTenantGuestHiddenBrands(hostname, brandIds, event);
  if (!result) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }
  return result;
});
