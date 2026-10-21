import * as ordersService from '../../services/orders';
import { requireAuth } from '../../utils/auth';
import { OrderIdSchema } from '../../schemas/api-input';

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  // Order details are per-company and access can be revoked at any time
  // (logout, removal from the company), so no cache may keep a copy.
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const id = getRouterParam(event, 'id');
  const { id: validatedId } = OrderIdSchema.parse({ id });
  return withErrorHandling(
    async () => {
      // getOrderPublic(publicOrderId) does no ownership check of its own, so
      // the order must first appear in getCompanyOrders, which Geins scopes
      // to the company of the user token. Looked up on every request and
      // never cached, so a membership change takes effect immediately.
      const visible = await ordersService.listOrders(event);
      if (!visible.orders.some((item) => item.publicId === validatedId)) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      const order = await ordersService.getOrder(
        { publicOrderId: validatedId },
        event,
      );
      if (!order) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order not found');
      }
      return { order };
    },
    { operation: 'orders.get' },
  );
});
