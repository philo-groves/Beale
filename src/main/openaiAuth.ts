import type { OpenAiAccountStatus, OpenAiAuthSource, OpenAiTransport } from '@shared/types';

export interface OpenAiCredential {
  token: string;
  source: Exclude<OpenAiAuthSource, 'not_configured'>;
}

export class OpenAiAuthService {
  public getStatus(): OpenAiAccountStatus {
    const credential = this.getCredential();
    const supportsWebSocket = typeof WebSocket === 'function';
    return {
      configured: credential !== null,
      source: credential?.source ?? 'not_configured',
      label: credential ? this.labelFor(credential.source) : 'OpenAI not configured',
      credentialHint: credential
        ? 'Credential is available only to the trusted host process.'
        : 'Set BEALE_OPENAI_ACCESS_TOKEN for OAuth bearer-token development, or OPENAI_API_KEY as a development fallback.',
      credentialsHostOnly: true,
      defaultModel: 'gpt-5.5',
      defaultReasoningEffort: 'xhigh',
      supportsWebSocket,
      preferredTransport: supportsWebSocket ? 'websocket' : 'sse_http'
    };
  }

  public getCredential(): OpenAiCredential | null {
    const oauthToken = process.env.BEALE_OPENAI_ACCESS_TOKEN?.trim();
    if (oauthToken) {
      return { token: oauthToken, source: 'oauth_bearer_env' };
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (apiKey) {
      return { token: apiKey, source: 'api_key_env' };
    }

    return null;
  }

  public getCredentialOrThrow(): OpenAiCredential {
    const credential = this.getCredential();
    if (!credential) {
      throw new Error('OpenAI credential is not configured on the host.');
    }
    return credential;
  }

  private labelFor(source: Exclude<OpenAiAuthSource, 'not_configured'>): string {
    return source === 'oauth_bearer_env' ? 'OAuth bearer token configured' : 'API key development fallback configured';
  }
}

export function resolveOpenAiTransport(): OpenAiTransport {
  const requested = process.env.BEALE_OPENAI_TRANSPORT?.trim();
  if (requested === 'websocket' && typeof WebSocket === 'function') {
    return 'websocket';
  }
  return 'sse_http';
}
