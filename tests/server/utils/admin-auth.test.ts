import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '../../../server/utils/admin-auth';

describe('timingSafeStringEqual', () => {
  it('accepts a value matching the secret', () => {
    expect(timingSafeStringEqual('correct-secret', 'correct-secret')).toBe(
      true,
    );
  });

  it('rejects a value that does not match', () => {
    expect(timingSafeStringEqual('wrong-secret', 'correct-secret')).toBe(false);
  });

  it('rejects a value that is a prefix or different length', () => {
    expect(timingSafeStringEqual('correct', 'correct-secret')).toBe(false);
    expect(
      timingSafeStringEqual('correct-secret-extra', 'correct-secret'),
    ).toBe(false);
  });

  it('treats two empty strings as equal', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
  });
});
