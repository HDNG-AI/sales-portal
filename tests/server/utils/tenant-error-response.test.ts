import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSend = vi.fn();
const mockSetResponseStatus = vi.fn();
const mockSetResponseHeader = vi.fn();
const mockGetRequestHeader = vi.fn();

vi.stubGlobal('send', mockSend);

vi.mock('h3', async (importActual) => {
  const actual = await importActual<typeof import('h3')>();
  return {
    ...actual,
    setResponseStatus: mockSetResponseStatus,
    setResponseHeader: mockSetResponseHeader,
    getRequestHeader: mockGetRequestHeader,
  };
});

interface MockEvent {
  path: string;
  context: Record<string, unknown>;
}

function createEvent(context: Record<string, unknown> = {}): MockEvent {
  return { path: '/se/sv/products', context };
}

describe('sendTenantErrorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRequestHeader.mockReturnValue(undefined);
  });

  it('sets the status code and only sets x-correlation-id when a correlationId is present', async () => {
    const { sendTenantErrorPage } =
      await import('../../../server/utils/tenant-error-response');
    const event = createEvent({ correlationId: 'corr-123' });
    sendTenantErrorPage(event as never, 404, 'not available');
    expect(mockSetResponseStatus).toHaveBeenCalledWith(event, 404);
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      'x-correlation-id',
      'corr-123',
    );
  });

  it('omits x-correlation-id when no correlationId is on the event context', async () => {
    const { sendTenantErrorPage } =
      await import('../../../server/utils/tenant-error-response');
    const event = createEvent();
    sendTenantErrorPage(event as never, 404, 'not available');
    expect(mockSetResponseHeader).not.toHaveBeenCalledWith(
      event,
      'x-correlation-id',
      expect.anything(),
    );
  });

  it('responds with JSON by default (no Accept: text/html)', async () => {
    const { sendTenantErrorPage } =
      await import('../../../server/utils/tenant-error-response');
    const event = createEvent({
      correlationId: 'corr-123',
      tenant: { hostname: 'unknown.example.com' },
    });
    sendTenantErrorPage(event as never, 404, 'not available');
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      'content-type',
      'application/json',
    );
    const [, body] = mockSend.mock.calls[0] as [unknown, string];
    expect(JSON.parse(body)).toMatchObject({
      error: true,
      statusCode: 404,
      message: 'not available',
      correlationId: 'corr-123',
      hostname: 'unknown.example.com',
    });
  });

  it('renders the shared HTML error page when the client wants HTML, with the tenant-not-provisioned copy for a 404', async () => {
    mockGetRequestHeader.mockImplementation((_e: unknown, name: string) =>
      name === 'accept' ? 'text/html' : undefined,
    );
    const { sendTenantErrorPage } =
      await import('../../../server/utils/tenant-error-response');
    const event = createEvent();
    sendTenantErrorPage(event as never, 404, 'not available');
    expect(mockSetResponseHeader).toHaveBeenCalledWith(
      event,
      'content-type',
      'text/html; charset=utf-8',
    );
    const [, html] = mockSend.mock.calls[0] as [unknown, string];
    expect(html).toContain('Store not yet available');
    expect(html).toContain('404');
  });

  it('does not use the tenant-not-provisioned copy for a 400', async () => {
    mockGetRequestHeader.mockImplementation((_e: unknown, name: string) =>
      name === 'accept' ? 'text/html' : undefined,
    );
    const { sendTenantErrorPage } =
      await import('../../../server/utils/tenant-error-response');
    const event = createEvent();
    sendTenantErrorPage(event as never, 400, 'Missing host header');
    const [, html] = mockSend.mock.calls[0] as [unknown, string];
    expect(html).not.toContain('Store not yet available');
  });
});
