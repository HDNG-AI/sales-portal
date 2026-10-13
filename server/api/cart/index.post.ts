import { protectCartPrices } from '../../utils/price-response';
import { createCart } from '../../services/cart';

export default defineEventHandler(async (event) => {
  if (event.context.tenant?.config?.mode === 'catalog') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Not available in catalogue mode',
    });
  }

  return withErrorHandling(
    async () => {
      return protectCartPrices(event, await createCart(event));
    },
    { operation: 'cart.create' },
  );
});
