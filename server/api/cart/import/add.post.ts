import { CartImportAddSchema } from '../../../schemas/api-input';
import { addImportedItems } from '../../../services/cart-import';
import { guardCartImport } from '../../../utils/cart-import/guard';
import { createTenantLogger } from '../../../utils/logger';
import { protectCartPrices } from '../../../utils/price-response';
import { cartImportAddRateLimiter } from '../../../utils/rate-limiter';

/**
 * Add previewed import lines to the buyer's cart, through the cart service
 * every other add uses. Answers with the cart as it now stands and, per line,
 * whether it went in.
 */
export default defineEventHandler(async (event) => {
  await guardCartImport(event, cartImportAddRateLimiter);
  const body = await readValidatedBody(event, CartImportAddSchema.parse);

  return withErrorHandling(
    async () => {
      const result = await addImportedItems(body.cartId, body.items, event);
      createTenantLogger(event.context.tenant?.hostname ?? 'unknown').info(
        'Cart file import added',
        {
          requested: body.items.length,
          added: result.added.length,
          failed: result.failed.length,
        },
      );
      return protectCartPrices(event, result);
    },
    { operation: 'cart.import.add' },
  );
});
