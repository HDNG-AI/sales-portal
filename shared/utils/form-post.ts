/**
 * The spam fields the mail receiver checks. Names are fixed by the receiver
 * (`INTERNAL_FIELDS` in the support-mail service), so they are declared once
 * here rather than spelled out at the call site.
 *
 * `website` and `ba-honeypot` are the honeypots: a field a person never sees
 * and never fills, so anything in them came from something filling inputs
 * indiscriminately. `form_started_at` / `form_duration` are the timing pair —
 * a form completed faster than a person could read it did not have a person
 * behind it.
 */
export const HONEYPOT_FIELDS = ['website', 'ba-honeypot'] as const;
export const FORM_STARTED_AT_FIELD = 'form_started_at';
export const FORM_DURATION_FIELD = 'form_duration';

/**
 * Matches the receiver's own threshold. Checking it here too costs nothing
 * and drops the obvious cases before they reach the network — but the check
 * that counts is the server's: anything posting directly to the endpoint
 * never runs this code.
 */
export const MIN_SUBMIT_SECONDS = 3;

/**
 * Whether a CMS-supplied post target is one this deployment will submit to.
 *
 * `postUrl` arrives in page content, so it is attacker-controlled the moment
 * a merchant account is. Without an allowlist a storefront form could be
 * repointed at any collector, on a page that still looks entirely legitimate.
 * An empty allowlist permits nothing, so a deployment that has not opted in
 * falls back to mailto rather than posting somewhere unvetted.
 */
export function isAllowedPostUrl(
  postUrl: string | undefined,
  allowedOrigins: readonly string[],
): boolean {
  if (!postUrl) return false;

  let parsed: URL;
  try {
    parsed = new URL(postUrl);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;

  return allowedOrigins.some((allowed) => {
    try {
      return new URL(allowed).origin === parsed.origin;
    } catch {
      return false;
    }
  });
}

/** Whether the submission looks automated, by the same rules the server uses. */
export function looksAutomated(
  honeypotValues: readonly string[],
  startedAt: number,
  now: number = Date.now(),
): boolean {
  if (honeypotValues.some((value) => value.trim() !== '')) return true;
  if (!startedAt) return true;
  return (now - startedAt) / 1000 < MIN_SUBMIT_SECONDS;
}
