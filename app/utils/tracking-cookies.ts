import { COOKIE_NAMES } from '#shared/constants/storage';

/**
 * Cookies that are KEPT. Everything else on this origin is cleared.
 *
 * Note the direction: this is not the list of things to delete. These are the
 * cookies the application sets for itself — session, cart, locale, market, VAT
 * preference — and clearing them would sign the buyer out and empty their cart
 * as a side effect of declining analytics. They are also strictly necessary in
 * the ePrivacy sense, so they never needed consent to begin with.
 *
 * Everything else is cleared, including cookies that are first-party by
 * origin: `_ga` is set on this domain, by Google's script rather than by us.
 * "Ours" here means set by this codebase, not set on this hostname.
 *
 * Keeping a list of what to preserve rather than a list of known trackers is
 * the whole point: a tag manager exists so an editor can add tags without a
 * deploy, so a list of tracker names is out of date the moment someone does.
 * Anything unrecognised is cleared by default, and anything we own has to be
 * named here — sourced from COOKIE_NAMES (ADR-006) so a cookie added there is
 * preserved without anyone remembering this file exists.
 */
const KEEP: ReadonlySet<string> = new Set(Object.values(COOKIE_NAMES));

/** True for a cookie this codebase did not set, i.e. one to clear. */
function shouldClear(name: string): boolean {
  return !KEEP.has(name);
}

/**
 * Domains a cookie could have been scoped to, most specific first.
 *
 * A cookie is only removed by an expiry that matches the domain AND path it
 * was set with, and `document.cookie` reports neither — so removal is a
 * matter of trying each plausible scope. GA sets `_ga` on the registrable
 * domain (`.example.com`) while a first-party cookie is usually host-only,
 * and an expiry aimed at the wrong one silently does nothing.
 *
 * Stops at two labels: `.com` is a public suffix, and no browser would have
 * accepted a cookie there anyway.
 */
function domainCandidates(hostname: string): (string | undefined)[] {
  // An IP or single-label host has no parent to walk.
  if (!hostname.includes('.') || /^[\d.]+$/.test(hostname)) return [undefined];

  const labels = hostname.split('.');
  const domains: (string | undefined)[] = [undefined, `.${hostname}`];
  for (let i = 1; i <= labels.length - 2; i++) {
    domains.push(`.${labels.slice(i).join('.')}`);
  }
  return domains;
}

/**
 * Clears every cookie on this origin that this codebase did not set, across
 * the domain scopes the setting script could have used.
 *
 * Deliberately limited, and the limits matter for what can be claimed about
 * it: cookies on another registrable domain (doubleclick.net, for one) are
 * unreachable from here whatever we do, and an HttpOnly cookie is invisible to
 * `document.cookie` — so the auth session is doubly safe, both named in KEEP
 * and unreachable from script.
 *
 * @returns the names it attempted to clear, for the caller to log or assert on
 */
export function clearTrackingCookies(): string[] {
  if (import.meta.server || typeof document === 'undefined') return [];

  const cleared: string[] = [];
  const domains = domainCandidates(globalThis.location?.hostname ?? '');

  for (const entry of document.cookie.split(';')) {
    const name = entry.split('=')[0]?.trim();
    if (!name || !shouldClear(name)) continue;

    for (const domain of domains) {
      document.cookie = [
        `${name}=`,
        'expires=Thu, 01 Jan 1970 00:00:00 GMT',
        'path=/',
        domain ? `domain=${domain}` : '',
      ]
        .filter(Boolean)
        .join('; ');
    }
    cleared.push(name);
  }

  return cleared;
}
