import { z } from 'zod';
import { isAllowedPostUrl, looksAutomated } from '#shared/utils/form-post';
import { logger } from '../../utils/logger';

/**
 * Forwards a CMS form submission to the address its widget names.
 *
 * The browser posts here rather than to the target directly, for three
 * reasons. The allowlist has to live where CMS content cannot reach it —
 * `postUrl` comes from page content, so a client-side check protects nobody
 * once a merchant account is compromised. The CSP's connect-src is built into
 * the bundle, so a direct fetch to a per-tenant target could not be allowed
 * without rebuilding. And the receiver sees one known origin instead of every
 * storefront domain, so it need not keep its CORS wide open.
 */
const SubmissionSchema = z.object({
  postUrl: z.string().min(1),
  fields: z.record(z.string(), z.union([z.string(), z.array(z.string())])),
});

export default defineEventHandler(async (event) => {
  const { postUrl, fields } = await readValidatedBody(
    event,
    SubmissionSchema.parse,
  );

  const config = useRuntimeConfig(event);
  const allowed = String(config.formPostOrigins ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!isAllowedPostUrl(postUrl, allowed)) {
    // Deliberately not echoing the rejected URL: this is reached by content
    // the caller controls, and the response should not confirm what the
    // allowlist holds.
    throw createAppError(
      ErrorCode.BAD_REQUEST,
      'This form is not configured for submission',
    );
  }

  const honeypots = ['website', 'ba-honeypot'].map((name) =>
    typeof fields[name] === 'string' ? (fields[name] as string) : '',
  );
  const startedAt = Number(fields['form_started_at'] ?? 0);

  // Accepted and dropped, rather than refused: an automated submitter that
  // gets an error learns which of its attempts look wrong, and tunes.
  if (looksAutomated(honeypots, startedAt)) {
    logger.warn('[cms-form] Submission dropped: looks automated', { postUrl });
    return { ok: true };
  }

  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const entry of value) body.append(name, entry);
    } else {
      body.append(name, value);
    }
  }

  try {
    await $fetch(postUrl, { method: 'POST', body });
    return { ok: true };
  } catch (error) {
    logger.error(
      '[cms-form] Forwarding failed',
      error instanceof Error ? error : undefined,
      { postUrl },
    );
    throw createAppError(
      ErrorCode.INTERNAL_ERROR,
      'Could not deliver the form',
    );
  }
});
