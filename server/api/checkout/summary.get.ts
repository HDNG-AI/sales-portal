import { CheckoutSummarySchema } from '../../schemas/api-input';
import { getSummary } from '../../services/checkout';
import { optionalAuth } from '../../utils/auth';
import { requireOdelcoSummaryOwnership, requireVerifiedCheckoutBuyer, requiresVerifiedCheckoutBuyer } from '../../utils/checkout-access';

export default defineEventHandler(async (event) => {
  // Post-payment guests are supported on public-checkout tenants only.
  // Private B2B orders require a Geins-verified buyer session.
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const privateBuyer = requiresVerifiedCheckoutBuyer(event);
  const tokens = privateBuyer
    ? await requireVerifiedCheckoutBuyer(event)
    : await optionalAuth(event);

  const { orderId, paymentMethod } = await getValidatedQuery(
    event,
    CheckoutSummarySchema.parse,
  );

  return withErrorHandling(
    async () => {
      const summary = await getSummary({ orderId, paymentMethod }, event);

      if (!summary) {
        throw createAppError(ErrorCode.NOT_FOUND, 'Order summary not found');
      }

      if (privateBuyer) {
        if (!tokens) throw createAppError(ErrorCode.UNAUTHORIZED, 'Buyer session required');
        await requireOdelcoSummaryOwnership(event, tokens, summary);
      }
      return summary;
    },
    { operation: 'checkout.summary' },
  );
});
