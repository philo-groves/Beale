import type { OpenAiAccountStatus, OpenAiAuthSource, OpenAiTransport } from '@shared/types';
import { spawnSync } from 'node:child_process';

export interface OpenAiCredential {
  token: string;
  source: Exclude<OpenAiAuthSource, 'not_configured'>;
}

interface CachedCommandCredential {
  commandKey: string;
  credential: OpenAiCredential;
  expiresAt: number;
}

export class OpenAiAuthService {
  private commandCredential: CachedCommandCredential | null = null;

  public getStatus(): OpenAiAccountStatus {
    const credential = this.getCredential();
    const supportsWebSocket = true;
    return {
      configured: credential !== null,
      source: credential?.source ?? 'not_configured',
      label: credential ? this.labelFor(credential.source) : 'OpenAI not configured',
      credentialHint: credential
        ? 'Credential is available only to the trusted host process.'
        : 'Set BEALE_OPENAI_AUTH_COMMAND for an OAuth token command, BEALE_OPENAI_ACCESS_TOKEN for bearer-token development, or OPENAI_API_KEY as a development fallback.',
      credentialsHostOnly: true,
      defaultModel: 'gpt-5.5',
      defaultReasoningEffort: 'xhigh',
      supportsWebSocket,
      preferredTransport: resolveOpenAiTransport(supportsWebSocket)
    };
  }

  public getCredential(): OpenAiCredential | null {
    const command = process.env.BEALE_OPENAI_AUTH_COMMAND?.trim();
    if (command) {
      const credential = this.getCommandCredential(command);
      if (credential) return credential;
    }

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
    switch (source) {
      case 'oauth_command':
        return 'OAuth command token configured';
      case 'oauth_bearer_env':
        return 'OAuth bearer token configured';
      case 'api_key_env':
        return 'API key development fallback configured';
    }
  }

  private getCommandCredential(command: string): OpenAiCredential | null {
    const args = parseCommandArgs();
    const commandKey = JSON.stringify({ command, args });
    const now = Date.now();
    if (this.commandCredential && this.commandCredential.commandKey === commandKey && this.commandCredential.expiresAt > now) {
      return this.commandCredential.credential;
    }

    const timeoutMs = positiveIntegerFromEnv('BEALE_OPENAI_AUTH_COMMAND_TIMEOUT_MS', 5000);
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: process.env,
      timeout: timeoutMs,
      windowsHide: true
    });
    if (result.error || result.status !== 0) {
      return null;
    }

    const token = normalizeBearerToken(result.stdout);
    if (!token) {
      return null;
    }

    const refreshMs = positiveIntegerFromEnv('BEALE_OPENAI_AUTH_COMMAND_REFRESH_MS', 300_000);
    const credential: OpenAiCredential = { token, source: 'oauth_command' };
    this.commandCredential = {
      commandKey,
      credential,
      expiresAt: now + refreshMs
    };
    return credential;
  }
}

export function resolveOpenAiTransport(supportsWebSocket = true): OpenAiTransport {
  const requested = process.env.BEALE_OPENAI_TRANSPORT?.trim();
  if (requested === 'websocket' && supportsWebSocket) {
    return 'websocket';
  }
  if (requested === 'sse_http' || requested === 'sse' || requested === 'http') return 'sse_http';
  return 'sse_http';
}

function parseCommandArgs(): string[] {
  const raw = process.env.BEALE_OPENAI_AUTH_ARGS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeBearerToken(output: string): string | null {
  const firstLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstLine) return null;
  return firstLine.replace(/^Bearer\s+/i, '').trim() || null;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
