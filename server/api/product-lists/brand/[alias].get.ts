import { ListPageSchema } from '../../../schemas/api-input';
import { getBrandPage } from '../../../services/product-lists';
import { getBrands } from '../../../services/brands';
import { guestHiddenBrandIds } from '../../../utils/guest-hidden-brands';
import { findBrandIdByAlias } from '../../../utils/hidden-brands';

export default defineEventHandler(async (event) => {
  const alias = getRouterParam(event, 'alias');
  const { alias: validatedAlias } = ListPageSchema.parse({ alias });
  const auth = await optionalAuth(event);

  // A signed-in response may describe a brand guests must not see; keep it
  // out of shared caches.
  if (auth?.authToken) {
    setResponseHeader(event, 'Cache-Control', 'private, no-cache');
  }

  return withErrorHandling(
    async () => {
      // A brand hidden from guests answers like a brand that does not exist.
      // Its products are already excluded from every listing; this keeps its
      // name, logo and copy off the page too. The brand id comes from the
      // brands list, fetched only when the tenant hides something from this
      // caller.
      const hidden = await guestHiddenBrandIds(event, auth);
      const [page, brands] = await Promise.all([
        getBrandPage(
          { alias: validatedAlias, userToken: auth?.authToken },
          event,
        ),
        hidden.length > 0 ? getBrands(event) : Promise.resolve(null),
      ]);

      const brandId =
        page && hidden.length > 0
          ? findBrandIdByAlias(brands, [
              (page as { alias?: string }).alias,
              validatedAlias,
            ])
          : undefined;

      if (!page || (brandId !== undefined && hidden.includes(brandId))) {
        // Don't let the CDN cache the 404. A freshly-published brand would
        // otherwise stay 404 for the s-maxage window on every edge.
        setResponseHeader(event, 'Cache-Control', 'no-store');
        throw createAppError(ErrorCode.NOT_FOUND, 'Brand page not found');
      }

      return page;
    },
    { operation: 'product-lists.brand.get' },
  );
});
