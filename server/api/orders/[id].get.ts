import * as ordersService from '../../services/orders';
import { requireAuth } from '../../utils/auth';
import { requireOdelcoOrderOwnership, requireVerifiedCheckoutBuyer, requiresVerifiedCheckoutBuyer } from '../../utils/checkout-access';
import { OrderIdSchema } from '../../schemas/api-input';

export default defineEventHandler(async (event) => {
  const privateBuyer = requiresVerifiedCheckoutBuyer(event);
  const tokens = privateBuyer
    ? await requireVerifiedCheckoutBuyer(event)
    : await requireAuth(event);
  setResponseHeader(event, 'Cache-Control', privateBuyer
    ? 'private, no-store'
    : 'private, max-age=30, must-revalidate');
  const id = getRouterParam(event, 'id');
  const { id: validatedId } = OrderIdSchema.parse({ id });
  return withErrorHandling(
    async () => {
      const order = await ordersService.getOrder(
        { publicOrderId: validatedId },
        event,
      );
      if (!order) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      if (privateBuyer) {
        await requireOdelcoOrderOwnership(event, tokens, order.publicId, 'public');
      }
      return { order };
    },
    { operation: 'orders.get' },
  );
});
