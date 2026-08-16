import type {
  ProviderSettings,
  ResearchModelEffortLevel,
  ResearchModelProviderId
} from '@shared/types';
import { honeycrispProcessEnvironment } from './honeycrispRunEngine';
import { invokeHoneycrispCliProtocolAsync } from './honeycrispCliClient';

export interface ProviderTextCompletionRequest {
  provider: ResearchModelProviderId;
  model: string;
  effort: ResearchModelEffortLevel;
  systemPrompt: string;
  prompt: string;
  maxTokens?: number;
  cwd: string;
  signal?: AbortSignal;
  preferredAuthenticationMethods?: ProviderSettings['preferredAuthenticationMethods'];
}

export type ProviderTextCompleter = (request: ProviderTextCompletionRequest) => Promise<string>;

export async function completeProviderText(request: ProviderTextCompletionRequest): Promise<string> {
  // Keep credential/environment injection in Beale's trusted host adapter;
  // completion validation and provider execution belong to Honeycrisp.
  const envelope = await invokeHoneycrispCliProtocolAsync<{ text: string }>('provider.complete', ['complete', '--json'], {
    env: honeycrispProcessEnvironment(null, request.preferredAuthenticationMethods),
    ...(request.signal ? { signal: request.signal } : {}),
    stdin: JSON.stringify({
    schemaVersion: 1,
    provider: request.provider,
    model: request.model,
    effort: request.effort,
    systemPrompt: request.systemPrompt,
    prompt: request.prompt,
    ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    cwd: request.cwd
    })
  });
  if (typeof envelope.result.text !== 'string' || !envelope.result.text.trim()) {
    throw new Error('Honeycrisp returned an invalid provider completion result.');
  }
  return envelope.result.text.trim();
}
