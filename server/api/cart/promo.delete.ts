import { protectCartPrices } from '../../utils/price-response';
import { CartIdSchema } from '../../schemas/api-input';
import { removePromoCode } from '../../services/cart';

export default defineEventHandler(async (event) => {
  const { cartId } = await getValidatedQuery(event, CartIdSchema.parse);

  return withErrorHandling(
    async () => {
      return protectCartPrices(event, await removePromoCode(cartId, event));
    },
    { operation: 'cart.removePromoCode' },
  );
});
