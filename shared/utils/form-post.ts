/**
 * Explicit CMS intents only; callers never supply an outbound URL or address.
 * Kept as a small stable contract for the CMS FormWidget and Nitro handler.
 */
export type FormEndpoint = 'contact' | 'support' | 'newCustomer';

export const HONEYPOT_FIELDS = ['website', 'ba-honeypot'] as const;
export const FORM_STARTED_AT_FIELD = 'form_started_at';
export const FORM_DURATION_FIELD = 'form_duration';
export const MIN_SUBMIT_SECONDS = 3;

/** Helper for receiver tests. Never use this as the only bot defense. */
export function looksAutomated(
  honeypotValues: readonly string[],
  startedAt: number,
  now: number = Date.now(),
): boolean {
  if (honeypotValues.some((value) => value.trim() !== '')) return true;
  if (!startedAt || startedAt > now) return true;
  return (now - startedAt) / 1000 < MIN_SUBMIT_SECONDS;
}
