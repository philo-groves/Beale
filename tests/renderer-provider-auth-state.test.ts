import { describe, expect, it } from 'vitest';
import {
  clearConfirmedProviderOAuthResults,
  isSubscriptionAuthenticationConfirmed
} from '../src/renderer/view-models/providerAuthentication';

describe('renderer provider authentication state', () => {
  it('recognizes a completed subscription only after authentication stops', () => {
    expect(isSubscriptionAuthenticationConfirmed({ subscriptionConfigured: true, loginInProgress: false })).toBe(true);
    expect(isSubscriptionAuthenticationConfirmed({ subscriptionConfigured: true, loginInProgress: true })).toBe(false);
    expect(isSubscriptionAuthenticationConfirmed({ subscriptionConfigured: false, loginInProgress: false })).toBe(false);
  });

  it('clears only completed provider sign-in notices', () => {
    const current = {
      anthropic: { detail: 'Claude opened in a browser.' },
      xai: { detail: 'xAI opened in a browser.' }
    };
    const next = clearConfirmedProviderOAuthResults(current, [
      { id: 'anthropic', subscriptionConfigured: true, loginInProgress: false },
      { id: 'xai', subscriptionConfigured: true, loginInProgress: true }
    ]);

    expect(next).toEqual({ xai: current.xai });
    expect(current).toHaveProperty('anthropic');
  });

  it('preserves the existing result object when no authentication completed', () => {
    const current = { xai: { detail: 'Waiting for xAI.' } };
    expect(clearConfirmedProviderOAuthResults(current, [
      { id: 'xai', subscriptionConfigured: false, loginInProgress: false }
    ])).toBe(current);
  });
});
