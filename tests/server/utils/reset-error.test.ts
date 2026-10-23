import { describe, it, expect } from 'vitest';
import { createError } from 'h3';
import { summarizeResetError } from '../../../server/utils/reset-error';

// Text that must never survive into a summary, whatever the error shape.
const UPSTREAM_TEXT =
  'user@example.com https://api.example/x?token=s3cret Bearer abc.def password=hunter2';

describe('summarizeResetError', () => {
  it('reports an app error by status and code only', () => {
    const error = createError({
      statusCode: 502,
      message: UPSTREAM_TEXT,
      data: { code: 'EXTERNAL_API_ERROR', details: UPSTREAM_TEXT },
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'app',
      errorName: 'Error',
      httpStatus: 502,
      code: 'EXTERNAL_API_ERROR',
    });
  });

  it('reports a timeout', () => {
    const error = Object.assign(new Error(UPSTREAM_TEXT), {
      name: 'TimeoutError',
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'timeout',
      errorName: 'TimeoutError',
    });
  });

  it('reports a GraphQL error by its extension code only', () => {
    const error = Object.assign(new Error(UPSTREAM_TEXT), {
      name: 'ApolloError',
      graphQLErrors: [
        { message: UPSTREAM_TEXT, extensions: { code: 'BAD_USER_INPUT' } },
      ],
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'graphql',
      errorName: 'ApolloError',
      code: 'BAD_USER_INPUT',
    });
  });

  it('reports a network error by HTTP status only', () => {
    const error = Object.assign(new Error(UPSTREAM_TEXT), {
      name: 'ApolloError',
      graphQLErrors: [],
      networkError: { statusCode: 503, result: UPSTREAM_TEXT },
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'network',
      errorName: 'ApolloError',
      httpStatus: 503,
    });
  });

  it('reports an SDK error by its code', () => {
    const error = Object.assign(new Error(UPSTREAM_TEXT), {
      name: 'GeinsError',
      code: 'INVALID_ARGUMENT',
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'sdk',
      errorName: 'GeinsError',
      code: 'INVALID_ARGUMENT',
    });
  });

  it('drops codes, names and statuses that are not plain identifiers', () => {
    const error = Object.assign(new Error(UPSTREAM_TEXT), {
      name: 'user@example.com',
      code: 'token=s3cret',
    });
    expect(summarizeResetError(error)).toEqual({
      category: 'unknown',
      errorName: undefined,
    });
    expect(
      summarizeResetError({
        graphQLErrors: [{ extensions: { code: UPSTREAM_TEXT } }],
      }),
    ).toEqual({ category: 'graphql', errorName: undefined, code: undefined });
    expect(
      summarizeResetError({ networkError: { statusCode: '401 user@x.se' } }),
    ).toEqual({
      category: 'network',
      errorName: undefined,
      httpStatus: undefined,
    });
  });

  it('handles non-Error throws', () => {
    expect(summarizeResetError(UPSTREAM_TEXT)).toEqual({
      category: 'unknown',
      errorName: undefined,
    });
    expect(summarizeResetError(undefined)).toEqual({
      category: 'unknown',
      errorName: undefined,
    });
  });

  it('never returns any part of the upstream text', () => {
    const shapes: unknown[] = [
      createError({ statusCode: 500, message: UPSTREAM_TEXT }),
      Object.assign(new Error(UPSTREAM_TEXT), {
        networkError: { statusCode: 500 },
      }),
      Object.assign(new Error(UPSTREAM_TEXT), {
        graphQLErrors: [{ message: UPSTREAM_TEXT }],
      }),
      new Error(UPSTREAM_TEXT),
    ];
    for (const shape of shapes) {
      const out = JSON.stringify(summarizeResetError(shape));
      for (const part of [
        'user@example.com',
        's3cret',
        'Bearer',
        'hunter2',
        'https://',
      ]) {
        expect(out).not.toContain(part);
      }
    }
  });
});
