import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { H3Event } from 'h3';

const mocks = vi.hoisted(() => ({
  limited: vi.fn(async () => ({ allowed: true })),
  fetch: vi.fn(),
  readBody: vi.fn(),
}));

vi.mock('../../../server/utils/rate-limiter', () => ({
  RateLimiter: class {
    check = mocks.limited;
  },
  getClientIp: () => '203.0.113.10',
}));

vi.stubGlobal('defineEventHandler', (handler: (event: H3Event) => unknown) => handler);
vi.stubGlobal('setHeader', () => {});
vi.stubGlobal('getHeader', (event: H3Event, name: string) =>
  (event.node.req.headers as Record<string, string | undefined>)[name.toLowerCase()],
);
vi.stubGlobal('getRequestHost', (event: H3Event) =>
  (event.node.req.headers as Record<string, string | undefined>)['host'],
);
vi.stubGlobal('readBody', (...args: unknown[]) => mocks.readBody(...args));
vi.stubGlobal('createError', (value: { statusCode: number; statusMessage: string }) =>
  Object.assign(new Error(value.statusMessage), { statusCode: value.statusCode }),
);
vi.stubGlobal('fetch', (...args: unknown[]) => mocks.fetch(...args));

const form = () => ({
  kind: 'contact',
  fields: {
    company: 'Test AB',
    email: 'customer@example.org',
    message: 'Staging test – no real email',
    website: '',
    'ba-honeypot': '',
    form_started_at: String(Date.now() - 15_000),
    form_duration: '15000',
  },
});

function event(host = 'staging-odelco.hdng.ai', origin = 'https://' + host): H3Event {
  return {
    node: { req: { headers: { host, origin, 'x-forwarded-for': '203.0.113.10' } } },
    context: { tenant: { hostname: 'staging-odelco.hdng.ai', config: { name: 'Odelco' } } },
  } as unknown as H3Event;
}

describe('POST /api/forms/submit (mocked Scaleway; no network)', () => {
  let handler: (event: H3Event) => Promise<unknown>;
  const original = {
    allowed: process.env.ODELCO_FORMS_ALLOWED_HOSTS,
    key: process.env.SCALEWAY_STOREFRONT_SECRET_KEY,
    project: process.env.SCALEWAY_STOREFRONT_PROJECT_ID,
  };

  beforeAll(async () => {
    handler = (await import('../../../server/api/forms/submit.post')).default;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.readBody.mockResolvedValue(form());
    mocks.limited.mockResolvedValue({ allowed: true });
    mocks.fetch.mockResolvedValue({
      ok: true, json: async () => ({ emails: [{ id: 'accepted-message-id' }] }),
    });
    process.env.ODELCO_FORMS_ALLOWED_HOSTS = 'staging-odelco.hdng.ai';
    process.env.SCALEWAY_STOREFRONT_SECRET_KEY = 'test-key-not-real';
    process.env.SCALEWAY_STOREFRONT_PROJECT_ID = '6170692e-7363-616c-6577-61792e636f6d';
  });

  afterAll(() => {
    if (original.allowed === undefined) delete process.env.ODELCO_FORMS_ALLOWED_HOSTS;
    else process.env.ODELCO_FORMS_ALLOWED_HOSTS = original.allowed;
    if (original.key === undefined) delete process.env.SCALEWAY_STOREFRONT_SECRET_KEY;
    else process.env.SCALEWAY_STOREFRONT_SECRET_KEY = original.key;
    if (original.project === undefined) delete process.env.SCALEWAY_STOREFRONT_PROJECT_ID;
    else process.env.SCALEWAY_STOREFRONT_PROJECT_ID = original.project;
    vi.unstubAllGlobals();
  });

  it('sends allowed contact using server-owned recipient and user Reply-To', async () => {
    await expect(handler(event())).resolves.toEqual({ ok: true });
    expect(mocks.fetch).toHaveBeenCalledOnce();
    const [endpoint, params] = mocks.fetch.mock.calls[0]!;
    expect(String(endpoint)).toContain('scaleway.com/transactional-email/');
    const request = JSON.parse((params as { body: string }).body);
    expect(request.to).toEqual([{ email: 'hello@hdng.ai' }]);
    expect(request.subject).toBe('Odelco · Kontakt: Test AB');
    expect(request.additional_headers).toEqual([{ key: 'Reply-To', value: 'customer@example.org' }]);
  });

  it('rejects a different host before calling the provider', async () => {
    process.env.ODELCO_FORMS_ALLOWED_HOSTS = 'different.example.org';
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 404 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects cross-origin browser submissions', async () => {
    await expect(handler(event('staging-odelco.hdng.ai', 'https://attacker.example'))).rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('never confirms unsupported new customer applications', async () => {
    mocks.readBody.mockResolvedValue({ ...form(), kind: 'newCustomer' });
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects honeypots and rapid submissions without fake success', async () => {
    mocks.readBody.mockResolvedValue({ ...form(), fields: { ...form().fields, website: 'spam.example' } });
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 422 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects throttled requests', async () => {
    mocks.limited.mockResolvedValue({ allowed: false });
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('rejects submissions when the private store credential is missing', async () => {
    delete process.env.SCALEWAY_STOREFRONT_SECRET_KEY;
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('does not claim success on provider rejection', async () => {
    mocks.fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 502 });
  });

  it('does not claim success on a provider response without receipt', async () => {
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ emails: [] }) });
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 502 });
  });

  it('does not claim success on a provider timeout', async () => {
    mocks.fetch.mockRejectedValue(new Error('timeout'));
    await expect(handler(event())).rejects.toMatchObject({ statusCode: 503 });
  });
});
