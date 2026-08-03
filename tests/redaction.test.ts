import { describe, expect, it } from 'vitest';
import { redactCommandArgumentsForModel, redactForModelText } from '../src/main/redaction';

describe('host redaction', () => {
  it('redacts paired command credentials and complete authorization headers', () => {
    const redacted = redactCommandArgumentsForModel([
      '--password',
      'hunter2',
      '--token',
      'split-token-secret',
      '-H',
      'Authorization: Basic dXNlcjpwYXNzd29yZA==',
      '--user',
      'admin:password',
      '--cookie',
      'sessionid=raw-cookie-secret',
      '-b',
      'other=second-cookie-secret',
      '--cookie=inline-cookie-secret',
      '--header',
      'Accept: application/json'
    ]);

    expect(redacted).toEqual([
      '--password',
      '...redacted',
      '--token',
      '...redacted',
      '-H',
      'Authorization: ...redacted',
      '--user',
      '...redacted',
      '--cookie',
      '...redacted',
      '-b',
      '...redacted',
      '--cookie=...redacted',
      '--header',
      'Accept: application/json'
    ]);
    expect(JSON.stringify(redacted)).not.toMatch(
      /hunter2|split-token-secret|dXNlcjpwYXNzd29yZA|admin:password|raw-cookie-secret|second-cookie-secret|inline-cookie-secret/
    );
  });

  it('redacts standalone Basic and Bearer authorization values', () => {
    expect(redactForModelText('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe('Authorization: ...redacted');
    expect(redactForModelText('Bearer abcdefghijklmnop')).toBe('Bearer ...redacted');
    expect(redactForModelText('Cookie: sessionid=raw-cookie-secret')).toBe('Cookie: ...redacted');
  });
});
