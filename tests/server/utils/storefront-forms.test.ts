import { describe, it, expect } from 'vitest';
import { isLikelyAutomated, parseStorefrontFormInput, prepareStorefrontFormMail } from '../../../server/utils/storefront-forms';

const fields = {
  company: 'Example Marine AB',
  email: 'buyer@example.org',
  message: 'We are interested in a product',
  website: '',
  'ba-honeypot': '',
  form_started_at: String(Date.now() - 15_000),
  form_duration: '15000',
};

describe('Odelco public forms', () => {
  it('sends contact mail to a fixed address with safe company subject and reply-to', () => {
    expect(prepareStorefrontFormMail({ kind: 'contact', fields })).toMatchObject({
      to: 'hello@hdng.ai',
      subject: 'Odelco · Kontakt: Example Marine AB',
      replyTo: 'buyer@example.org',
    });
  });
  it('never uses a client-provided address or subject as outbound destination', () => {
    const mail = prepareStorefrontFormMail({
      kind: 'contact',
      fields: { ...fields, to: 'attacker@example.net', subject: 'hello\r\nBcc: attacker@example.net' },
    });
    expect(mail.to).toBe('hello@hdng.ai');
    expect(mail.subject).not.toContain('Bcc');
  });
  it('sanitizes line breaks in the company subject', () => {
    const mail = prepareStorefrontFormMail({
      kind: 'contact',
      fields: { ...fields, company: 'Odelco\r\nBcc: attacker@example.net' },
    });
    expect(mail.subject).not.toContain('\n');
  });
  it('accepts Swedish field identifiers from Geins CMS', () => {
    const localized = prepareStorefrontFormMail({
      kind: 'contact',
      fields: { företag: 'Odelco Test AB', 'e-postadress': 'svenska@example.org', message: 'Hej' },
    });
    expect(localized.replyTo).toBe('svenska@example.org');
    expect(localized.subject).toBe('Odelco · Kontakt: Odelco Test AB');
  });

  it('keeps support destination separate', () => {
    expect(prepareStorefrontFormMail({ kind: 'support', fields }).to).toBe('support@odelco.se');
  });
  it('rejects invalid or missing reply address', () => {
    expect(() => prepareStorefrontFormMail({ kind: 'contact', fields: { company: 'A' } })).toThrow('CONTACT_EMAIL_REQUIRED');
  });
  it('does not claim a CRM application was recorded when Twenty is not configured', () => {
    expect(() => prepareStorefrontFormMail({ kind: 'newCustomer', fields })).toThrow('TWENTY_INTEGRATION_REQUIRED');
  });
  it('rejects unknown intentions and oversized fields', () => {
    expect(parseStorefrontFormInput({ kind: 'arbitrary', fields })).toBeNull();
    expect(parseStorefrontFormInput({ kind: 'contact', fields: { email: 'a'.repeat(2500) } })).toBeNull();
  });
  it('uses honeypot and minimum elapsed time as additional bot signals', () => {
    expect(isLikelyAutomated(fields)).toBe(false);
    expect(isLikelyAutomated({ ...fields, website: 'spambot' })).toBe(true);
    expect(isLikelyAutomated({ ...fields, form_duration: '100' })).toBe(true);
  });
});
