import { describe, expect, it } from 'vitest';
import {
  parseHoneycrispAuthStatus,
  parseHoneycrispAuthVerification,
  parseProviderOAuthInstructions
} from '../src/main/researchProviderAuth';

describe('research provider auth parsing', () => {
  it('parses Honeycrisp stored OAuth state', () => {
    expect(
      parseHoneycrispAuthStatus(
        'Auth file: /Users/researcher/.honeycrisp/auth.json\nanthropic\tAnthropic\tapi_key, oauth\toauth\n'
      )
    ).toEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic',
      authMethods: ['api_key', 'oauth'],
      storedCredentialType: 'oauth'
    });
  });

  it('parses ambient API-key verification without reading the key', () => {
    expect(
      parseHoneycrispAuthVerification(
        'Anthropic (anthropic) model claude-sonnet-4-6: configured via ANTHROPIC_API_KEY\n'
      )
    ).toEqual({
      providerId: 'anthropic',
      providerName: 'Anthropic',
      modelId: 'claude-sonnet-4-6',
      configured: true,
      source: 'ANTHROPIC_API_KEY'
    });
  });

  it('parses an xAI device-code prompt', () => {
    expect(
      parseProviderOAuthInstructions(
        'Open this URL in your browser:\nhttps://auth.x.ai/device?code=ABCD-EFGH\nEnter code: ABCD-EFGH\n'
      )
    ).toEqual({
      verificationUri: 'https://auth.x.ai/device?code=ABCD-EFGH',
      userCode: 'ABCD-EFGH'
    });
  });
});
