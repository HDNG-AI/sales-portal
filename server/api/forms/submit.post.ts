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
  // A resolved tenant may have a canonical hostname (odelco.se) while
  // storefront staging runs on an alias (staging-odelco.hdng.ai).
  // Match the resolved tenant identity AND the actual request host.
  const requestHost = (getRequestHost(event, { xForwardedHost: false }) || '').toLowerCase();
  const permitted = (process.env.ODELCO_FORMS_ALLOWED_HOSTS || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (tenant?.tenantId !== 'odelco' || !tenant?.config || !permitted.includes(requestHost)) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' });
  }

  // Browsers set Origin on POST. Reject cross-site submissions outright;
  // this is not the only spam control (bots can forge Origin).
  const origin = getHeader(event, 'origin');
  let originHost = '';
  try { originHost = origin ? new URL(origin).host.toLowerCase() : ''; } catch { /* reject below */ }
  if (!originHost || originHost !== requestHost) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }

  const input = parseStorefrontFormInput(await readBody(event));
  if (!input) throw createError({ statusCode: 400, statusMessage: 'Invalid form' });

  // New customer applications are explicitly reserved for Twenty; never
  // return success without an actual CRM write and deduplication contract.
  if (input.kind === 'newCustomer') {
    throw createError({ statusCode: 503, statusMessage: 'CRM intake not configured' });
  }

  const limited = await limiter.check(`${requestHost}:${getClientIp(event)}`);
  if (!limited.allowed) {
    throw createError({ statusCode: 429, statusMessage: 'Try again later' });
  }
  // Never acknowledge an unsent customer enquiry as successful. In
  // particular, browser autofill can occasionally trip bot heuristics.
  if (isLikelyAutomated(input.fields)) {
    throw createError({ statusCode: 422, statusMessage: 'Submission could not be accepted' });
  }

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
  // Scaleway's CreateEmailResponse contains accepted email records. A bare
  // HTTP 200 is not enough to tell a customer that the provider accepted mail.
  let accepted: unknown;
  try { accepted = await response.json(); }
  catch {
    throw createError({ statusCode: 502, statusMessage: 'Mail provider returned no receipt' });
  }
  const envelope = accepted as { emails?: Array<{ id?: string }> } | null;
  if (!Array.isArray(envelope?.emails) || !envelope.emails.some((email) => typeof email?.id === 'string' && !!email.id)) {
    throw createError({ statusCode: 502, statusMessage: 'Mail provider returned no receipt' });
  }
  return { ok: true };
});
