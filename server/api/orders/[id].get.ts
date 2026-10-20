import * as ordersService from '../../services/orders';
import { requireAuth } from '../../utils/auth';
import { OrderIdSchema } from '../../schemas/api-input';

export default defineEventHandler(async (event) => {
  await requireAuth(event);
  setResponseHeader(
    event,
    'Cache-Control',
    'private, max-age=30, must-revalidate',
  );
  const id = getRouterParam(event, 'id');
  const { id: validatedId } = OrderIdSchema.parse({ id });
  return withErrorHandling(
    async () => {
      // Verify visibility in the authenticated company's order list before
      // reading details via Geins getOrderPublic(publicOrderId).
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
