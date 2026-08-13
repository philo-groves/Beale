import type { ResearchProviderId } from '@shared/types';

export interface SubscriptionAuthenticationStatus {
  subscriptionConfigured: boolean;
  loginInProgress: boolean;
}

export interface ResearchProviderSubscriptionAuthenticationStatus extends SubscriptionAuthenticationStatus {
  id: ResearchProviderId;
}

export function isSubscriptionAuthenticationConfirmed(
  status: SubscriptionAuthenticationStatus | null | undefined
): boolean {
  return Boolean(status?.subscriptionConfigured && !status.loginInProgress);
}

export function clearConfirmedProviderOAuthResults<T>(
  current: Partial<Record<ResearchProviderId, T>>,
  statuses: readonly ResearchProviderSubscriptionAuthenticationStatus[]
): Partial<Record<ResearchProviderId, T>> {
  let next = current;
  for (const status of statuses) {
    if (!(status.id in current) || !isSubscriptionAuthenticationConfirmed(status)) continue;
    if (next === current) next = { ...current };
    delete next[status.id];
  }
  return next;
}
