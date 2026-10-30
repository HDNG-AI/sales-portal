import { protectCartPrices } from '../../utils/price-response';
import { createCart } from '../../services/cart';
import { issueCartProof } from '../../utils/cart-ownership';

export default defineEventHandler(async (event) => {
  if (event.context.tenant?.config?.mode === 'catalog') {
    throw createError({
      statusCode: 403,
      statusMessage: 'Not available in catalogue mode',
    });
  }

  return withErrorHandling(
    async () => {
      const cart = await createCart(event);
      // Lets a buyer who signs in on this browser import into the cart later.
      issueCartProof(event, cart.id);
      return protectCartPrices(event, cart);
    },
    { operation: 'cart.create' },
  );
});
