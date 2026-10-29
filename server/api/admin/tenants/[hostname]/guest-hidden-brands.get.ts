import { requireCatalogAdminAuth } from '../../../../utils/admin-auth';
import { getTenantGuestHiddenBrands } from '../../../../utils/tenant-crud';

/**
 * The Geins brand ids a tenant hides from visitors who are not signed in.
 * Opened by the write key, the read key, or the catalog key (which is limited
 * to these two routes and, optionally, to some hostnames).
 */
export default defineEventHandler(async (event) => {
  const hostname = getRouterParam(event, 'hostname')?.trim().toLowerCase();
  await requireCatalogAdminAuth(event, 'read', hostname ?? '');

  if (!hostname) {
    throw createAppError(ErrorCode.VALIDATION_ERROR, 'A hostname is required');
  }
  const result = await getTenantGuestHiddenBrands(hostname, event);
  if (!result) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }
  return result;
});
