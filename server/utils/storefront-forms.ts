import { MIN_SUBMIT_SECONDS, type FormEndpoint } from '#shared/utils/form-post';

/** Safe intake for public CMS forms. No client-controlled recipient or subject. */
export interface StorefrontFormInput {
  kind: FormEndpoint;
  fields: Record<string, string | string[]>;
}

const VALID_EMAIL = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const RESERVED = new Set(['website', 'ba-honeypot', 'form_started_at', 'form_duration']);
const REPLY_FIELD = /^(e[-_ ]?mail|e[-_ ]?post|epostadress|emailaddress|kontakt[-_ ]?email|customeremail)$/i;
const COMPANY_FIELD = /^(company|companyname|company_name|foretag|företag|foretagsnamn|företagsnamn|organisation|organization)$/i;

export function parseStorefrontFormInput(raw: unknown): StorefrontFormInput | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (!['contact', 'support', 'newCustomer'].includes(String(data.kind))) return null;
  if (!data.fields || typeof data.fields !== 'object' || Array.isArray(data.fields)) return null;
  const entries = Object.entries(data.fields);
  if (entries.length > 35) return null;
  let bytes = 0;
  const fields: Record<string, string | string[]> = Object.create(null);
  for (const [key, value] of entries) {
    if (!/^[\wÅÄÖåäöéÉ -]{1,70}$/.test(key)) return null;
    const pieces = typeof value === 'string' ? [value] : Array.isArray(value) ? value : null;
    if (!pieces || pieces.length > 15 || pieces.some((v) => typeof v !== 'string' || v.length > 2400)) return null;
    bytes += pieces.reduce<number>((sum, v) => sum + (v as string).length, 0);
    if (bytes > 12_000) return null;
    fields[key] = typeof value === 'string' ? value : (pieces as string[]);
  }
  return { kind: data.kind as FormEndpoint, fields };
}

export function isLikelyAutomated(fields: StorefrontFormInput['fields'], now = Date.now()): boolean {
  const hp = (name: string) => fields[name];
  if (['website', 'ba-honeypot'].some((key) => {
    const value = hp(key);
    return (Array.isArray(value) ? value.join('') : value ?? '').trim().length > 0;
  })) return true;
  const start = Number(hp('form_started_at'));
  const duration = Number(hp('form_duration'));
  if (!Number.isFinite(start) || !Number.isFinite(duration) || start <= 0 || duration < MIN_SUBMIT_SECONDS * 1000) return true;
  // Limit timestamp skew without relying on client time as a security boundary.
  return start > now + 30_000 || start < now - 86_400_000;
}

const cleanHeader = (text: string, max = 100) =>
  text.replace(/[<>]/g, ' ').split('').map((ch) => { const code = ch.charCodeAt(0); return code < 32 || code === 127 ? ' ' : ch; }).join('').replace(/\s+/g, ' ').trim().slice(0, max);

export function prepareStorefrontFormMail(input: StorefrontFormInput): {
  to: string; subject: string; replyTo: string; text: string;
} {
  if (input.kind === 'newCustomer') throw new Error('TWENTY_INTEGRATION_REQUIRED');
  const entries = Object.entries(input.fields).filter(([name]) => !RESERVED.has(name));
  const possibleEmails = entries.filter(([name]) => REPLY_FIELD.test(name));
  const replyTo = possibleEmails
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map((value) => value.trim())
    .find((value) => value.length <= 254 && VALID_EMAIL.test(value));
  if (!replyTo) throw new Error('CONTACT_EMAIL_REQUIRED');
  const company = entries
    .filter(([name]) => COMPANY_FIELD.test(name))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map((value) => cleanHeader(value, 90))
    .find(Boolean) || 'Privatperson';

  const subject = input.kind === 'contact'
    ? `Odelco · Kontakt: ${company}`
    : `Odelco · Support: ${company}`;

  const message = entries.map(([name, value]) =>
    `${cleanHeader(name, 70)}: ${(Array.isArray(value) ? value.join(', ') : value).trim().slice(0, 2400)}`,
  ).join('\n');

  return {
    to: input.kind === 'contact' ? 'hello@hdng.ai' : 'support@odelco.se',
    subject,
    replyTo,
    text: `Nytt formulär från Odelcos webbplats.\n\n${message}\n`,
  };
}
