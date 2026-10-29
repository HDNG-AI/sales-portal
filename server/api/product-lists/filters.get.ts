import { protectProductPrices } from '../../utils/price-response';
import { guestHiddenBrandIds } from '../../utils/guest-hidden-brands';
import {
  withHiddenBrandsExcluded,
  withoutIdentityLookup,
} from '../../utils/hidden-brands';
import { ProductListSchema } from '../../schemas/api-input';
import { getFilters } from '../../services/product-lists';

export default defineEventHandler(async (event) => {
  const validated = await getValidatedQuery(event, ProductListSchema.parse);
  const auth = await optionalAuth(event);

  setResponseHeader(
    event,
    'Cache-Control',
    auth?.authToken
      ? 'private, no-cache'
      : 'public, s-maxage=60, stale-while-revalidate=600',
  );

  return withErrorHandling(
    async () => {
      // Facets and counts come from Geins with the guest-hidden brands
      // excluded. Facets cannot be checked product by product, so a guest's
      // productIds/articleNumbers, which would switch the exclusion off, are
      // dropped first; no storefront page sends them here.
      const hidden = await guestHiddenBrandIds(event, auth);
      const filter =
        hidden.length > 0
          ? withHiddenBrandsExcluded(
              withoutIdentityLookup(validated.filter),
              hidden,
            )
          : validated.filter;
      const filters = await getFilters(
        {
          ...validated,
          ...(filter ? { filter } : {}),
          userToken: auth?.authToken,
        },
        event,
      );
      return protectProductPrices(event, auth, filters);
    },
    { operation: 'product-lists.filters.get' },
  );
});
