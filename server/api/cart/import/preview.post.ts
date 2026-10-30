import type { CartImportPreview } from '#shared/types/cart-import';
import { CartImportPreviewSchema } from '../../../schemas/api-input';
import { resolveOrderEntries } from '../../../services/cart-import';
import { claimCart } from '../../../utils/cart-ownership';
import { guardCartImport } from '../../../utils/cart-import/guard';
import { parseOrderFile } from '../../../utils/cart-import/parse';
import { createTenantLogger } from '../../../utils/logger';
import { protectProductPrices } from '../../../utils/price-response';
import { cartImportPreviewRateLimiter } from '../../../utils/rate-limiter';

/**
 * Read an uploaded order file and say what it would put in the cart. Nothing
 * is added here. The file lives in memory for this request only: it is not
 * stored, and only counts are logged, never its rows.
 *
 * The cart named in the request is read only when it is provably this
 * buyer's. Otherwise the preview counts from an empty cart and says that the
 * lines will go into a new one.
 */
export default defineEventHandler(async (event) => {
  const { auth, buyerId } = await guardCartImport(
    event,
    cartImportPreviewRateLimiter,
  );
  const body = await readValidatedBody(event, CartImportPreviewSchema.parse);
  setResponseHeader(event, 'Cache-Control', 'private, no-store');
  const ownCart =
    body.cartId !== undefined && claimCart(event, body.cartId, buyerId);

  const log = createTenantLogger(event.context.tenant?.hostname ?? 'unknown');
  const parsed = parseOrderFile(
    Buffer.from(body.content, 'base64'),
    body.fileName,
  );
  if (!parsed.ok) {
    log.info('Cart file import refused', { error: parsed.error });
    const refused: CartImportPreview = {
      status: 'invalid',
      error: parsed.error,
    };
    return refused;
  }

  return withErrorHandling(
    async () => {
      const resolved = await resolveOrderEntries(
        parsed.entries,
        {
          userToken: auth.authToken,
          cartId: ownCart ? body.cartId : undefined,
        },
        event,
      );
      const problems = [...parsed.problems, ...resolved.problems].sort(
        (a, b) => (a.rows[0] ?? 0) - (b.rows[0] ?? 0),
      );
      log.info('Cart file import previewed', {
        format: parsed.format,
        articles: parsed.entries.length,
        matched: resolved.lines.length,
        problems: problems.length,
      });
      const preview: CartImportPreview = {
        status: 'ok',
        columns: parsed.columns,
        lines: resolved.lines,
        problems,
        ...(body.cartId !== undefined && !ownCart ? { newCart: true } : {}),
      };
      return protectProductPrices(event, auth, preview);
    },
    { operation: 'cart.import.preview' },
  );
});
