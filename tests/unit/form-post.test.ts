import { describe, it, expect } from 'vitest';
import {
  isAllowedPostUrl,
  looksAutomated,
  MIN_SUBMIT_SECONDS,
} from '../../shared/utils/form-post';

const ALLOWED = ['https://forms.example.com'];

describe('isAllowedPostUrl', () => {
  it('accepts an allowlisted origin', () => {
    expect(
      isAllowedPostUrl('https://forms.example.com/new-customer', ALLOWED),
    ).toBe(true);
  });

  it('refuses an origin that is not listed', () => {
    // postUrl comes from CMS content, so this is the check standing between a
    // compromised merchant account and a form that posts wherever it likes.
    expect(isAllowedPostUrl('https://evil.example/collect', ALLOWED)).toBe(
      false,
    );
  });

  it('refuses a lookalike host', () => {
    expect(
      isAllowedPostUrl('https://forms.example.com.evil.test/x', ALLOWED),
    ).toBe(false);
  });

  it('refuses plain http even when the host matches', () => {
    expect(isAllowedPostUrl('http://forms.example.com/x', ALLOWED)).toBe(false);
  });

  it('refuses everything when the allowlist is empty', () => {
    // A deployment that has not opted in falls back to mailto rather than
    // posting somewhere unvetted.
    expect(isAllowedPostUrl('https://forms.example.com/x', [])).toBe(false);
  });

  it('refuses an unparseable or absent url', () => {
    expect(isAllowedPostUrl('not a url', ALLOWED)).toBe(false);
    expect(isAllowedPostUrl(undefined, ALLOWED)).toBe(false);
  });
});

describe('looksAutomated', () => {
  const now = 1_000_000;
  const wellPast = now - (MIN_SUBMIT_SECONDS + 1) * 1000;

  it('passes a filled form completed at human speed', () => {
    expect(looksAutomated(['', ''], wellPast, now)).toBe(false);
  });

  it('catches a filled honeypot however fast or slow', () => {
    expect(looksAutomated(['', 'anything'], wellPast, now)).toBe(true);
  });

  it('catches a submit faster than a person could read the form', () => {
    expect(looksAutomated(['', ''], now - 500, now)).toBe(true);
  });

  it('catches a missing start time', () => {
    // No clock means nothing timed it, which is not how a rendered form behaves.
    expect(looksAutomated(['', ''], 0, now)).toBe(true);
  });
});
