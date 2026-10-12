import { RateLimiter, getClientIp } from '../../utils/rate-limiter';
import {
  isLikelyAutomated,
  parseStorefrontFormInput,
  prepareStorefrontFormMail,
} from '../../utils/storefront-forms';

const limiter = new RateLimiter({ limit: 3, windowMs: 5 * 60_000, prefix: 'public-storefront-forms' });
const ENDPOINT = 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails';

export default defineEventHandler(async (event) => {
  setHeader(event, 'Cache-Control', 'no-store');

  // Only explicitly configured Odelco hosts. Other tenants never get to send
  // through this project's credentials, even with forged submitted fields.
  const tenant = event.context.tenant;
  const host = tenant?.hostname?.toLowerCase() ?? '';
  const permitted = (process.env.ODELCO_FORMS_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!tenant?.config || !permitted.includes(host)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  // Browsers set Origin on POST. Reject cross-site submissions outright;
  // this is not the only spam control (bots can forge Origin).
  const origin = getHeader(event, 'origin');
  const requestHost = getRequestHost(event, { xForwardedHost: false });
  let originHost = '';
  try { originHost = origin ? new URL(origin).host.toLowerCase() : ''; } catch { /* reject below */ }
  if (!originHost || originHost !== requestHost?.toLowerCase()) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const input = parseStorefrontFormInput(await readBody(event));
  if (!input) throw createError({ statusCode: 400, statusMessage: 'Invalid form' });

  // New customer applications are explicitly reserved for Twenty; never
  // return success without an actual CRM write and deduplication contract.
  if (input.kind === 'newCustomer') {
    throw createError({ statusCode: 503, statusMessage: 'CRM intake not configured' });
  }

  const limited = await limiter.check(`${host}:${getClientIp(event)}`);
  if (!limited.allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Try again later' });
  }
  // A honeypot or implausibly fast submit gets a generic success without
  // generating a message or confirming anything about the recipient.
  if (isLikelyAutomated(input.fields)) return { ok: true };

  let message;
  try { message = prepareStorefrontFormMail(input); }
  catch { throw createError({ statusCode: 400, statusMessage: 'Valid email required' }); }

  const secret = process.env.SCALEWAY_STOREFRONT_SECRET_KEY?.trim();
  const projectId = process.env.SCALEWAY_STOREFRONT_PROJECT_ID?.trim();
  if (!secret || !projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) {
    throw createError({ statusCode: 503, statusMessage: 'Mail service unavailable' });
  }

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'X-Auth-Token': secret, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        from: { email: 'noreply@hdng.ai', name: 'Odelco' },
        to: [{ email: message.to }],
        project_id: projectId,
        subject: message.subject,
        text: message.text,
        additional_headers: [{ key: 'Reply-To', value: message.replyTo }],
      }),
    });
  } catch {
    throw createError({ statusCode: 503, statusMessage: 'Mail service temporarily unavailable' });
  }
  if (!response.ok) {
    // Never return provider diagnostics, API keys or customer content to visitors.
    throw createError({ statusCode: 502, statusMessage: 'Mail provider rejected submission' });
  }
  return { ok: true };
});
