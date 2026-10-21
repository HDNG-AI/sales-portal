import * as ordersService from '../../services/orders';
import { requireAuth } from '../../utils/auth';
import {
  requireOdelcoOrderOwnership,
  requireVerifiedCheckoutBuyer,
  requiresVerifiedCheckoutBuyer,
} from '../../utils/checkout-access';
import { OrderIdSchema } from '../../schemas/api-input';

export default defineEventHandler(async (event) => {
  const privateBuyer = requiresVerifiedCheckoutBuyer(event);
  const tokens = privateBuyer
    ? await requireVerifiedCheckoutBuyer(event)
    : await requireAuth(event);
  // Order details are per-company and access can be revoked at any time, so
  // no cache may keep a copy.
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const id = getRouterParam(event, 'id');
  const { id: validatedId } = OrderIdSchema.parse({ id });
  return withErrorHandling(
    async () => {
      // getOrderPublic does no ownership check of its own, so the requested
      // ID must be in the company's order list before any detail is read.
      if (privateBuyer) {
        await requireOdelcoOrderOwnership(event, tokens, validatedId, 'public');
      }
      const order = await ordersService.getOrder(
        { publicOrderId: validatedId },
        event,
      );
      if (!order) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      if (privateBuyer && String(order.publicId ?? '') !== validatedId) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      return { order };
    },
    { operation: 'orders.get' },
  );
});
