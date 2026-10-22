import * as ordersService from '../../services/orders';
import { requireAuth } from '../../utils/auth';
import {
  requireCompanyOrderOwnership,
  requireVerifiedCheckoutBuyer,
  requiresVerifiedCheckoutBuyer,
} from '../../utils/checkout-access';
import { OrderIdSchema } from '../../schemas/api-input';

export default defineEventHandler(async (event) => {
  // Order details are per-company and access can be revoked at any time
  // (logout, removal from the company), so no cache may keep a copy,
  // including of an early 401.
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const privateBuyer = requiresVerifiedCheckoutBuyer(event);
  const tokens = privateBuyer
    ? await requireVerifiedCheckoutBuyer(event)
    : await requireAuth(event);
  const id = getRouterParam(event, 'id');
  const { id: validatedId } = OrderIdSchema.parse({ id });
  return withErrorHandling(
    async () => {
      // getOrderPublic(publicOrderId) does no ownership check of its own, so
      // for every tenant the requested ID must be in the company's
      // getCompanyOrders list, read with this request's token, before any
      // detail is read. Looked up on every request and never cached, so a
      // membership change takes effect immediately.
      await requireCompanyOrderOwnership(event, tokens, validatedId, 'public');
      const order = await ordersService.getOrder(
        { publicOrderId: validatedId },
        event,
      );
      if (!order) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      // Never return an order other than the one authorized above.
      if (String(order.publicId ?? '') !== validatedId) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      return { order };
    },
    { operation: 'orders.get' },
  );
});
