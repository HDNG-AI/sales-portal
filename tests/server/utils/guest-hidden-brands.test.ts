import { describe, it, expect, vi } from 'vitest';
import type { H3Event } from 'h3';

// The Geins session check behind isVerifiedBuyer. Answers by token, so tests
// running concurrently in this file never share a mock's state.
const { getUser } = vi.hoisted(() => ({
  getUser: vi.fn(async (token: string) => {
    if (token.includes('signed-in')) return { id: 42, authenticated: true };
    throw new Error('rejected by Geins');
  }),
}));
vi.mock('../../../server/services/user', () => ({ getUser }));

const { guestHiddenBrandIds } =
  await import('../../../server/utils/guest-hidden-brands');

let counter = 0;

/** A JWT-shaped token that expires in an hour; `kind` lands in the token. */
function session(kind: 'signed-in' | 'rejected', withRefresh = true) {
  const payload = Buffer.from(
    JSON.stringify({
      sub: `${kind}-${++counter}`,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString('base64url');
  return {
    authToken: `eyJhbGciOiJIUzI1NiJ9.${payload}.${kind}`,
    refreshToken: withRefresh ? `refresh-${counter}` : '',
  };
}

function event(guestHiddenBrandIds?: unknown): H3Event {
  return {
    context: {
      tenant: {
        tenantId: 'shop',
        hostname: 'shop.example.com',
        config: {
          tenantId: 'shop',
          ...(guestHiddenBrandIds === undefined
            ? {}
            : { catalog: { guestHiddenBrandIds } }),
        },
      },
    },
  } as unknown as H3Event;
}

describe('guestHiddenBrandIds: who the list applies to', () => {
  it('hides the tenant list from a guest', async () => {
    await expect(guestHiddenBrandIds(event([7, 9]), null)).resolves.toEqual([
      7, 9,
    ]);
  });

  it('hides nothing from a signed-in buyer Geins has verified', async () => {
    const auth = session('signed-in');
    await expect(guestHiddenBrandIds(event([7]), auth)).resolves.toEqual([]);
    expect(getUser).toHaveBeenCalledWith(auth.authToken, expect.anything());
  });

  it('treats a token Geins rejects as a guest', async () => {
    await expect(
      guestHiddenBrandIds(event([7]), session('rejected')),
    ).resolves.toEqual([7]);
  });

  it('treats a session without a refresh token (preview, login-as) as a guest', async () => {
    await expect(
      guestHiddenBrandIds(event([7]), session('signed-in', false)),
    ).resolves.toEqual([7]);
  });

  it('treats a forged, undecodable auth cookie as a guest', async () => {
    await expect(
      guestHiddenBrandIds(event([7]), {
        authToken: 'forged',
        refreshToken: 'forged',
      }),
    ).resolves.toEqual([7]);
  });

  it('does not ask Geins about the session when the tenant hides nothing', async () => {
    const auth = session('signed-in');
    await expect(guestHiddenBrandIds(event(), auth)).resolves.toEqual([]);
    await expect(guestHiddenBrandIds(event([]), auth)).resolves.toEqual([]);
    expect(getUser).not.toHaveBeenCalledWith(auth.authToken, expect.anything());
  });

  it('ignores malformed stored entries but keeps the valid ones', async () => {
    await expect(
      guestHiddenBrandIds(event([7, '8', -1, 7]), null),
    ).resolves.toEqual([7]);
    await expect(guestHiddenBrandIds(event('7'), null)).resolves.toEqual([]);
  });

  it('hides nothing on a request with no tenant context', async () => {
    await expect(
      guestHiddenBrandIds({} as unknown as H3Event, null),
    ).resolves.toEqual([]);
  });

  it('reads the stored override when the tenant config did not resolve', async () => {
    // A failed ?preview=1 lookup leaves only the hostname, while the SDK can
    // still serve the catalogue. The portal override is read from KV instead.
    const kv = new Map<string, unknown>([
      ['tenant:id:preview.example.com', 'preview-tenant'],
      [
        'tenant:override:preview-tenant',
        { catalog: { guestHiddenBrandIds: [5] } },
      ],
    ]);
    const storage = {
      getItem: vi.fn(async (key: string) => kv.get(key) ?? null),
    };
    const unresolved = {
      context: { tenant: { hostname: 'preview.example.com' } },
    } as unknown as H3Event;

    vi.stubGlobal('useStorage', () => storage);
    try {
      await expect(guestHiddenBrandIds(unresolved, null)).resolves.toEqual([5]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
