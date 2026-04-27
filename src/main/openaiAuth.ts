import type { OpenAiAccountStatus, OpenAiAuthReadiness, OpenAiAuthSource, OpenAiOnboardingStep, OpenAiTransport } from '@shared/types';
import { spawnSync } from 'node:child_process';

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;

export interface OpenAiCredential {
  token: string;
  source: Exclude<OpenAiAuthSource, 'not_configured'>;
}

interface CachedCommandCredential {
  commandKey: string;
  credential: OpenAiCredential;
  expiresAt: number;
}

interface CredentialProbe {
  credential: OpenAiCredential | null;
  oauthCommandConfigured: boolean;
  commandError: string | null;
}

interface CommandCredentialResult {
  credential: OpenAiCredential | null;
  error: string | null;
}

export class OpenAiAuthService {
  private commandCredential: CachedCommandCredential | null = null;

  public getStatus(): OpenAiAccountStatus {
    const probe = this.resolveCredential();
    const credential = probe.credential;
    const supportsWebSocket = true;
    const readiness = readinessFor(probe);
    const codexCliAvailable = commandExists('codex');
    return {
      configured: credential !== null,
      source: credential?.source ?? 'not_configured',
      label: labelFor(credential?.source ?? null, readiness),
      credentialHint: credentialHintFor(readiness),
      credentialsHostOnly: true,
      defaultModel: 'gpt-5.5',
      defaultReasoningEffort: 'xhigh',
      supportsWebSocket,
      preferredTransport: resolveOpenAiTransport(supportsWebSocket),
      readiness,
      statusDetail: statusDetailFor(probe, readiness, codexCliAvailable),
      userAction: userActionFor(readiness),
      setupCommand: setupCommandFor(readiness),
      oauthCommandConfigured: probe.oauthCommandConfigured,
      codexCliAvailable,
      onboardingSteps: onboardingStepsFor(probe, readiness, codexCliAvailable)
    };
  }

  public getCredential(): OpenAiCredential | null {
    return this.resolveCredential().credential;
  }

  public getCredentialOrThrow(): OpenAiCredential {
    const credential = this.getCredential();
    if (!credential) {
      throw new Error('OpenAI credential is not configured on the host.');
    }
    return credential;
  }

  public clearCachedCredential(): void {
    this.commandCredential = null;
  }

  private resolveCredential(): CredentialProbe {
    const command = process.env.BEALE_OPENAI_AUTH_COMMAND?.trim();
    if (command) {
      const result = this.getCommandCredential(command);
      if (result.credential) {
        return { credential: result.credential, oauthCommandConfigured: true, commandError: null };
      }
      return {
        credential: null,
        oauthCommandConfigured: true,
        commandError: result.error ?? 'OAuth command did not return a bearer token.'
      };
    }

    const oauthToken = process.env.BEALE_OPENAI_ACCESS_TOKEN?.trim();
    if (oauthToken) {
      return { credential: { token: oauthToken, source: 'oauth_bearer_env' }, oauthCommandConfigured: false, commandError: null };
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (apiKey) {
      return { credential: { token: apiKey, source: 'api_key_env' }, oauthCommandConfigured: false, commandError: null };
    }

    return { credential: null, oauthCommandConfigured: false, commandError: null };
  }

  private getCommandCredential(command: string): CommandCredentialResult {
    const args = parseCommandArgs();
    const commandKey = JSON.stringify({ command, args });
    const now = Date.now();
    if (this.commandCredential && this.commandCredential.commandKey === commandKey && this.commandCredential.expiresAt > now) {
      return { credential: this.commandCredential.credential, error: null };
    }

    const timeoutMs = positiveIntegerFromEnv('BEALE_OPENAI_AUTH_COMMAND_TIMEOUT_MS', 5000);
    const result = spawnSync(command, args, {
      encoding: 'utf8',
      env: minimalAuthCommandEnv(),
      timeout: timeoutMs,
      windowsHide: true
    });
    if (result.error || result.status !== 0) {
      return { credential: null, error: safeCommandFailure(result.stderr || result.error?.message || `status ${result.status}`) };
    }

    const token = normalizeBearerToken(result.stdout);
    if (!token) {
      return { credential: null, error: 'OAuth command completed without a bearer token.' };
    }

    const refreshMs = positiveIntegerFromEnv('BEALE_OPENAI_AUTH_COMMAND_REFRESH_MS', 300_000);
    const credential: OpenAiCredential = { token, source: 'oauth_command' };
    this.commandCredential = {
      commandKey,
      credential,
      expiresAt: now + refreshMs
    };
    return { credential, error: null };
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

function readinessFor(probe: CredentialProbe): OpenAiAuthReadiness {
  if (probe.credential?.source === 'oauth_command' || probe.credential?.source === 'oauth_bearer_env') return 'oauth_ready';
  if (probe.credential?.source === 'api_key_env') return 'development_fallback';
  if (probe.oauthCommandConfigured) return 'oauth_command_failed';
  return 'not_configured';
}

function labelFor(source: Exclude<OpenAiAuthSource, 'not_configured'> | null, readiness: OpenAiAuthReadiness): string {
  if (source === 'oauth_command') return 'OAuth command token configured';
  if (source === 'oauth_bearer_env') return 'OAuth bearer token configured';
  if (source === 'api_key_env') return 'API key development fallback configured';
  if (readiness === 'oauth_command_failed') return 'OAuth command needs attention';
  return 'OpenAI OAuth not configured';
}

function credentialHintFor(readiness: OpenAiAuthReadiness): string {
  if (readiness === 'oauth_ready') return 'Credential is available only to the trusted host process.';
  if (readiness === 'development_fallback') return 'Development fallback is active. OAuth remains the first-release path.';
  if (readiness === 'oauth_command_failed') return 'The configured OAuth command did not produce a usable bearer token.';
  return 'Run codex login, then set BEALE_OPENAI_AUTH_COMMAND for an OAuth token command. BEALE_OPENAI_ACCESS_TOKEN and OPENAI_API_KEY remain development fallbacks.';
}

function statusDetailFor(probe: CredentialProbe, readiness: OpenAiAuthReadiness, codexCliAvailable: boolean): string {
  if (readiness === 'oauth_ready') return 'Host-only OpenAI credential is available.';
  if (readiness === 'development_fallback') return 'OpenAI access is available through a development fallback, not the OAuth-first product path.';
  if (readiness === 'oauth_command_failed') return probe.commandError ?? 'OAuth command did not return a credential.';
  return codexCliAvailable ? 'Codex CLI is available; OAuth sign-in still needs to be connected to Beale.' : 'Codex CLI was not found on PATH.';
}

function userActionFor(readiness: OpenAiAuthReadiness): string | null {
  if (readiness === 'oauth_ready') return null;
  if (readiness === 'development_fallback') return 'Finish OAuth setup before treating this workspace as release-ready.';
  if (readiness === 'oauth_command_failed') return 'Refresh after completing browser sign-in or repairing the token command.';
  return 'Complete OAuth sign-in and configure a host-side token command.';
}

function setupCommandFor(readiness: OpenAiAuthReadiness): string | null {
  return readiness === 'oauth_ready' ? null : 'codex login';
}

function onboardingStepsFor(probe: CredentialProbe, readiness: OpenAiAuthReadiness, codexCliAvailable: boolean): OpenAiOnboardingStep[] {
  const credential = probe.credential;
  return [
    {
      id: 'chatgpt_oauth',
      label: 'ChatGPT OAuth',
      status: readiness === 'oauth_ready' ? 'complete' : 'current',
      detail: readiness === 'oauth_ready' ? 'Signed-in account credential is available to Beale.' : codexCliAvailable ? 'Browser OAuth sign-in can be completed through Codex.' : 'Install or expose Codex CLI before browser OAuth sign-in.',
      command: readiness === 'oauth_ready' ? null : 'codex login'
    },
    {
      id: 'host_credential_bridge',
      label: 'Host credential bridge',
      status: credential?.source === 'oauth_command' || credential?.source === 'oauth_bearer_env' ? 'complete' : readiness === 'development_fallback' ? 'warning' : probe.oauthCommandConfigured ? 'current' : 'blocked',
      detail: credential?.source === 'oauth_command' || credential?.source === 'oauth_bearer_env'
        ? 'Beale can resolve a bearer token on the trusted host.'
        : readiness === 'development_fallback'
          ? 'A fallback credential is present; OAuth should replace it for v1 use.'
          : probe.oauthCommandConfigured
            ? 'The configured command needs to return a bearer token.'
            : 'No host token command is configured for Beale.',
      command: null
    },
    {
      id: 'secret_isolation',
      label: 'Secret isolation',
      status: 'complete',
      detail: 'OpenAI credentials stay in the host process and are not mounted into guest VMs.',
      command: null
    },
    {
      id: 'model_defaults',
      label: 'Model defaults',
      status: 'complete',
      detail: 'Responses API defaults are gpt-5.5 with xhigh reasoning.',
      command: null
    }
  ];
}

function commandExists(command: string): boolean {
  const env = minimalAuthCommandEnv();
  const result =
    process.platform === 'win32'
      ? spawnSync('where', [command], { encoding: 'utf8', env, timeout: 1000, windowsHide: true })
      : spawnSync('sh', ['-lc', `command -v ${shellQuote(command)}`], { encoding: 'utf8', env, timeout: 1000, windowsHide: true });
  return !result.error && result.status === 0;
}

function minimalAuthCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'HOME',
    'USER',
    'USERNAME',
    'LOGNAME',
    'SHELL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'ComSpec',
    'APPDATA',
    'LOCALAPPDATA',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_RUNTIME_DIR',
    'DBUS_SESSION_BUS_ADDRESS'
  ]) {
    const value = process.env[key];
    if (value && !SECRET_ENV_PATTERN.test(key)) {
      env[key] = value;
    }
  }
  return env;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function safeCommandFailure(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ...redacted')
    .replace(/\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, '...redacted@')
    .slice(0, 240);
}
