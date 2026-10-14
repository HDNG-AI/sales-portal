// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { clearTrackingCookies } from '../../app/utils/tracking-cookies';
import { COOKIE_NAMES } from '#shared/constants/storage';

function setCookie(name: string, value = '1') {
  document.cookie = `${name}=${value}; path=/`;
}

function names(): string[] {
  return document.cookie
    .split(';')
    .map((c) => c.split('=')[0]?.trim())
    .filter((n): n is string => !!n);
}

describe('clearTrackingCookies', () => {
  beforeEach(() => {
    for (const n of names()) {
      document.cookie = `${n}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    }
  });

  it('clears a third-party analytics cookie', () => {
    setCookie('_ga', 'GA1.1.123');

    const cleared = clearTrackingCookies();

    expect(cleared).toContain('_ga');
    expect(names()).not.toContain('_ga');
  });

  it('never clears a cookie this application owns', () => {
    // The whole risk of an allowlist: get it wrong and withdrawing analytics
    // consent signs the buyer out or empties their cart.
    for (const own of Object.values(COOKIE_NAMES)) setCookie(own);

    clearTrackingCookies();

    for (const own of Object.values(COOKIE_NAMES)) {
      expect(names(), `${own} must survive`).toContain(own);
    }
  });

  it('clears a tag-manager cookie it has never heard of', () => {
    // A denylist of known tracker names cannot cover this: the point of GTM
    // is that an editor adds tags without a deploy.
    setCookie('_something_an_editor_added_last_tuesday');

    clearTrackingCookies();

    expect(names()).not.toContain('_something_an_editor_added_last_tuesday');
  });

  it('keeps the owned cookies while clearing the rest, mixed together', () => {
    setCookie(COOKIE_NAMES.AUTH_TOKEN, 'jwt');
    setCookie(COOKIE_NAMES.CART_ID, 'cart-1');
    setCookie('_ga');
    setCookie('_gid');
    setCookie('_fbp');

    const cleared = clearTrackingCookies();

    expect(cleared.sort()).toEqual(['_fbp', '_ga', '_gid']);
    expect(names().sort()).toEqual(
      [COOKIE_NAMES.AUTH_TOKEN, COOKIE_NAMES.CART_ID].sort(),
    );
  });

  it('returns an empty list when there is nothing to clear', () => {
    setCookie(COOKIE_NAMES.LOCALE, 'sv-SE');
    expect(clearTrackingCookies()).toEqual([]);
  });
});
