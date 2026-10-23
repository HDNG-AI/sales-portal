import { isError } from 'h3';

const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_NAME = /^[A-Za-z]{1,64}$/;

export interface ResetErrorSummary {
  category: 'app' | 'timeout' | 'graphql' | 'network' | 'sdk' | 'unknown';
  errorName?: string;
  httpStatus?: number;
  code?: string;
}

const safeCode = (value: unknown) =>
  typeof value === 'string' && SAFE_CODE.test(value) ? value : undefined;
const safeStatus = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) ? value : undefined;

/**
 * Reduces a failed reset request to fields that cannot carry personal data:
 * a fixed category, the error class name, an HTTP status and an
 * upper-case error code. Upstream messages, URLs and payloads are never read,
 * because Geins' exception text can contain anything the request carried.
 */
export function summarizeResetError(error: unknown): ResetErrorSummary {
  const e = (error ?? {}) as Record<string, unknown>;
  const errorName =
    typeof e.name === 'string' && SAFE_NAME.test(e.name) ? e.name : undefined;

  if (isError(error)) {
    const data = e.data as Record<string, unknown> | undefined;
    return {
      category: 'app',
      errorName,
      httpStatus: safeStatus(e.statusCode),
      code: safeCode(data?.code),
    };
  }
  if (errorName === 'AbortError' || errorName === 'TimeoutError') {
    return { category: 'timeout', errorName };
  }
  const graphQLErrors = e.graphQLErrors;
  if (Array.isArray(graphQLErrors) && graphQLErrors.length > 0) {
    const extensions = (graphQLErrors[0] as Record<string, unknown>)
      ?.extensions as Record<string, unknown> | undefined;
    return {
      category: 'graphql',
      errorName,
      code: safeCode(extensions?.code),
    };
  }
  if (e.networkError) {
    const networkError = e.networkError as Record<string, unknown>;
    return {
      category: 'network',
      errorName,
      httpStatus: safeStatus(networkError.statusCode),
    };
  }
  const code = safeCode(e.code);
  if (code) return { category: 'sdk', errorName, code };
  return { category: 'unknown', errorName };
}
