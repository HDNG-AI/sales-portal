import { protectProductPrices } from '../../utils/price-response';
import { guestHiddenBrandIds } from '../../utils/guest-hidden-brands';
import {
  isIdentityLookup,
  withHiddenBrandsExcluded,
  withoutHiddenBrandProducts,
} from '../../utils/hidden-brands';
import { SearchProductsSchema } from '../../schemas/api-input';
import { searchProducts } from '../../services/search';

export default defineEventHandler(async (event) => {
  const validated = await getValidatedQuery(event, SearchProductsSchema.parse);
  const auth = await optionalAuth(event);

  // A signed-in response carries what guests must not see (B2B prices,
  // guest-hidden brands); keep it out of shared caches.
  if (auth?.authToken) {
    setResponseHeader(event, 'Cache-Control', 'private, no-cache');
  }

  return withErrorHandling(
    async () => {
      // Brands hidden from guests are excluded in the Geins query itself.
      const hidden = await guestHiddenBrandIds(event, auth);
      const filter = withHiddenBrandsExcluded(
        { ...validated.filter, searchText: validated.query },
        hidden,
      ) ?? { searchText: validated.query };

      const found = await searchProducts(
        {
          filter,
          skip: validated.skip,
          take: validated.take,
          userToken: auth?.authToken,
        },
        event,
      );
      // Geins ignores every other filter field next to productIds or
      // articleNumbers, the exclusion too, so such a lookup is checked by brand.
      const products = isIdentityLookup(filter)
        ? withoutHiddenBrandProducts(found, hidden)
        : found;
      // Geins full-text search is configurable and may not index ArticleNumber
      // for this tenant. Use the documented exact-article filter as an
      // additional lookup ONLY when a SKU-like first-page query has no hits.
      // Preserve the original optional buyer token, market, language and all
      // caller-specified filters; apply the existing B2B price gate at the end.
      const term = validated.query.trim();
      const isArticleCandidate =
        /^[a-z0-9][a-z0-9._-]{2,63}$/i.test(term) && /[0-9]/.test(term);
      const emptyFirstPage =
        (validated.skip ?? 0) === 0 &&
        products !== null &&
        typeof products === 'object' &&
        !Array.isArray(products) &&
        'products' in products &&
        Array.isArray(products.products) &&
        products.products.length === 0;

      if (emptyFirstPage && isArticleCandidate) {
        const numbers = [...new Set([term, term.toUpperCase()])];
        const exact = await searchProducts(
          {
            filter: {
              ...validated.filter,
              articleNumbers: numbers,
              includeCollapsed: true,
            },
            skip: 0,
            take: Math.max(numbers.length, validated.take ?? 10),
            userToken: auth?.authToken,
          },
          event,
        );
        // An article-number lookup is one Geins applies no exclusion to.
        return protectProductPrices(
          event,
          auth,
          withoutHiddenBrandProducts(exact, hidden),
        );
      }

      return protectProductPrices(event, auth, products);
    },
    { operation: 'search.products.get' },
  );
});
