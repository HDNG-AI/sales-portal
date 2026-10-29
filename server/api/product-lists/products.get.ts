import { protectProductPrices } from '../../utils/price-response';
import { guestHiddenBrandIds } from '../../utils/guest-hidden-brands';
import {
  isIdentityLookup,
  withHiddenBrandsExcluded,
  withoutHiddenBrandProducts,
} from '../../utils/hidden-brands';
import { ProductListSchema } from '../../schemas/api-input';
import { getProducts } from '../../services/product-lists';

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
      // Brands hidden from guests are excluded in the Geins query, merged
      // into whatever filter the caller sent (CMS widgets forward theirs
      // verbatim), so counts and pages come from Geins without them.
      const hidden = await guestHiddenBrandIds(event, auth);
      const filter = withHiddenBrandsExcluded(validated.filter, hidden);
      const products = await getProducts(
        {
          ...validated,
          ...(filter ? { filter } : {}),
          userToken: auth?.authToken,
        },
        event,
      );
      // Geins ignores every other filter field next to productIds or
      // articleNumbers, the exclusion too, so such a lookup is checked by brand.
      const visible = isIdentityLookup(filter)
        ? withoutHiddenBrandProducts(products, hidden)
        : products;
      return protectProductPrices(event, auth, visible);
    },
    { operation: 'product-lists.products.get' },
  );
});
