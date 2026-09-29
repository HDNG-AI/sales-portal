import { describe, it, expect } from 'vitest';
import {
  looksAutomated,
  MIN_SUBMIT_SECONDS,
} from '../../shared/utils/form-post';

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
