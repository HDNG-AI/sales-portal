import { protectProductPrices } from '../../utils/price-response';
import { SearchProductsSchema } from '../../schemas/api-input';
import { searchProducts } from '../../services/search';

export default defineEventHandler(async (event) => {
  const validated = await getValidatedQuery(event, SearchProductsSchema.parse);
  const auth = await optionalAuth(event);

  return withErrorHandling(
    async () => {
      const filter: Record<string, unknown> = {
        ...validated.filter,
        searchText: validated.query,
      };

      const products = await searchProducts(
        {
          filter,
          skip: validated.skip,
          take: validated.take,
          userToken: auth?.authToken,
        },
        event,
      );
      return protectProductPrices(event, auth, products);
    },
    { operation: 'search.products.get' },
  );
});
