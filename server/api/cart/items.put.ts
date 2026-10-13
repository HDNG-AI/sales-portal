import { protectCartPrices } from '../../utils/price-response';
import { CartUpdateItemSchema } from '../../schemas/api-input';
import { updateItem } from '../../services/cart';

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, CartUpdateItemSchema.parse);

  return withErrorHandling(
    async () => {
      return protectCartPrices(event, await updateItem(
        body.cartId,
        { id: body.itemId, quantity: body.quantity },
        event,
      ));
    },
    { operation: 'cart.updateItem' },
  );
});
