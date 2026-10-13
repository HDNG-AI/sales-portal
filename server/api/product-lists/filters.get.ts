import { protectProductPrices } from '../../utils/price-response';
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
      const filters = await getFilters(
        { ...validated, userToken: auth?.authToken },
        event,
      );
      return protectProductPrices(event, auth, filters);
    },
    { operation: 'product-lists.filters.get' },
  );
});
