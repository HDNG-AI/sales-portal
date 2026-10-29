import { protectProductPrices } from '../../../utils/price-response';
import { guestHiddenBrandIds } from '../../../utils/guest-hidden-brands';
import { withoutHiddenBrandProducts } from '../../../utils/hidden-brands';
import { ProductAliasSchema } from '../../../schemas/api-input';
import { getRelatedProducts } from '../../../services/products';

export default defineEventHandler(async (event) => {
  const alias = getRouterParam(event, 'alias');
  const { alias: validatedAlias } = ProductAliasSchema.parse({ alias });
  const auth = await optionalAuth(event);

  // A signed-in response carries what guests must not see (B2B prices,
  // guest-hidden brands); keep it out of shared caches.
  if (auth?.authToken) {
    setResponseHeader(event, 'Cache-Control', 'private, no-cache');
  }

  return withErrorHandling(
    async () => {
      const [related, hidden] = await Promise.all([
        getRelatedProducts(
          { alias: validatedAlias, userToken: auth?.authToken },
          event,
        ),
        guestHiddenBrandIds(event, auth),
      ]);
      // relatedProducts takes no filter: brands hidden from guests are
      // checked product by product.
      return protectProductPrices(
        event,
        auth,
        withoutHiddenBrandProducts(related, hidden),
      );
    },
    { operation: 'products.related.get' },
  );
});
