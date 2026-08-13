import { describe, expect, it, vi } from 'vitest';
import {
  ResearchProviderAuthService,
  claudeSubscriptionLoginInvocation,
  parseHoneycrispAuthStatus,
  parseHoneycrispAuthVerification,
  parseHoneycrispModelCatalog,
  parseProviderOAuthInstructions
} from '../src/main/researchProviderAuth';

describe('research provider auth parsing', () => {
  it('launches Windows Claude subscription login in a visible tracked terminal', () => {
    const invocation = claudeSubscriptionLoginInvocation('win32', 'C:\\Windows', 'C:\\workspace');

    expect(invocation?.command).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(invocation?.displayCommand).toBe('claude auth login --claudeai');
    expect(invocation?.args.join(' ')).toContain('Start-Process');
    expect(invocation?.args.join(' ')).toContain('claude auth login --claudeai');
    expect(invocation?.args.join(' ')).toContain('WaitForExit');
  });

  it('cancels only the selected provider login process', () => {
    const auth = new ResearchProviderAuthService();
    const kill = vi.fn();
    const otherKill = vi.fn();
    const internals = auth as unknown as {
      loginProcesses: Map<'anthropic' | 'xai', { kill: () => void }>;
      latestStarts: Map<'anthropic' | 'xai', unknown>;
    };
    internals.loginProcesses.set('anthropic', { kill });
    internals.loginProcesses.set('xai', { kill: otherKill });
    internals.latestStarts.set('anthropic', { started: true });

    auth.cancelOAuthLogin('anthropic');

    expect(kill).toHaveBeenCalledOnce();
    expect(otherKill).not.toHaveBeenCalled();
    expect(internals.loginProcesses.has('anthropic')).toBe(false);
    expect(internals.latestStarts.has('anthropic')).toBe(false);
  });

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

  it('parses Pi model catalogs with model-specific effort levels', () => {
    expect(
      parseHoneycrispModelCatalog(JSON.stringify({
        providers: [{
          providerId: 'xai',
          providerName: 'xAI',
          models: [{
            id: 'grok-4.5',
            name: 'Grok 4.5',
            reasoning: true,
            effortLevels: ['low', 'medium', 'high'],
            contextWindow: 2_000_000,
            maxTokens: 32_000
          }]
        }]
      }))
    ).toEqual([{
      providerId: 'xai',
      providerName: 'xAI',
      models: [{
        id: 'grok-4.5',
        name: 'Grok 4.5',
        reasoning: true,
        effortLevels: ['low', 'medium', 'high'],
        contextWindow: 2_000_000,
        maxTokens: 32_000
      }]
    }]);
  });
});
