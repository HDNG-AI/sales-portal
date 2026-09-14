import { requireAdminAuth } from '../../../utils/admin-auth';
import { resolveTenant } from '../../../utils/tenant';

/**
 * Resolves one tenant's stored config by hostname, for services that need
 * to act on a tenant without holding a credential that can rewrite it.
 *
 * The caller this exists for is the RAG integration service: it consumes a
 * document-ready event, and to write the document's URI into the right
 * Geins product parameter it needs that tenant's real `geinsSettings` and
 * its `productMediaParameters` mapping. Serving that over HTTP keeps this
 * app's tenant-config schema and KV layout private — the alternative, that
 * service reading sales-portal's Redis directly or re-declaring its Zod
 * schemas, couples two deployables to a storage detail neither owns.
 *
 * Gated on the read scope (see requireAdminAuth). Putting it behind the
 * existing all-tenant write secret would mean a service that only ever
 * reads has to hold a credential that can rewrite every tenant's config —
 * the sort of thing that looks harmless until the credential leaks.
 *
 * The response is the full stored config, `geinsSettings` included. That is
 * deliberate: the whole point is resolving credentials, so stripping them
 * would defeat it. The consequence is that whoever holds the read key can
 * read every tenant's Geins API key, which is why this endpoint belongs on
 * a private network and not on the public internet. Narrowing it further
 * means per-tenant authorization, which this app does not have yet.
 */
export default defineEventHandler(async (event) => {
  await requireAdminAuth(event, 'read');

  const hostname = getRouterParam(event, 'hostname');
  if (!hostname) {
    throw createAppError(
      ErrorCode.VALIDATION_ERROR,
      'A hostname is required in the path',
    );
  }

  // resolveTenant() is the same lookup the storefront uses on every
  // request: KV first, merchant API on a miss. Reaching into KV directly
  // here would answer differently from the rest of the app for a tenant
  // that exists in Geins but has not been cached yet.
  const tenant = await resolveTenant(hostname);
  if (!tenant) {
    throw createAppError(
      ErrorCode.NOT_FOUND,
      `No tenant resolves for hostname "${hostname}"`,
    );
  }

  return tenant;
});
