import type { OpenAiAccountStatus, OpenAiAuthReadiness, OpenAiAuthSource, OpenAiOAuthStartResult, OpenAiOnboardingStep, OpenAiTransport } from '@shared/types';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;

export interface OpenAiCredential {
  token: string;
  source: Exclude<OpenAiAuthSource, 'not_configured'>;
  accountId?: string;
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

export interface OpenAiAuthServiceOptions {
  codexAuthPath?: string | null;
  codexCommand?: string;
}

export class OpenAiAuthService {
  private commandCredential: CachedCommandCredential | null = null;
  private oauthLoginProcess: ChildProcessWithoutNullStreams | null = null;
  private latestOAuthStart: OpenAiOAuthStartResult | null = null;

  public constructor(private readonly options: OpenAiAuthServiceOptions = {}) {}

  public getStatus(): OpenAiAccountStatus {
    const probe = this.resolveCredential();
    const credential = probe.credential;
    const supportsWebSocket = true;
    const readiness = readinessFor(probe);
    const codexCliAvailable = commandExists(this.codexCommand());
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

  public async startOAuthLogin(): Promise<OpenAiOAuthStartResult> {
    const command = this.codexCommand();
    const displayCommand = `${command} login --device-auth`;
    if (!commandExists(command)) {
      throw new Error('Codex CLI was not found on PATH. Install Codex or add it to PATH before authenticating with OpenAI.');
    }
    if (this.oauthLoginProcess && this.oauthLoginProcess.exitCode === null && !this.oauthLoginProcess.killed) {
      return this.latestOAuthStart ?? {
        started: false,
        command: displayCommand,
        detail: 'OpenAI OAuth login is already running.',
        verificationUri: null,
        userCode: null,
        instructions: null
      };
    }

    const child = spawn(command, ['login', '--device-auth'], {
      env: minimalAuthCommandEnv(),
      windowsHide: true
    });
    this.oauthLoginProcess = child;
    child.once('exit', () => {
      if (this.oauthLoginProcess === child) {
        this.oauthLoginProcess = null;
      }
    });

    const output = await collectInitialOAuthOutput(child);
    const instructions = safeDisplayOutput(output);
    const parsed = parseOAuthInstructions(instructions);
    const result: OpenAiOAuthStartResult = {
      started: true,
      command: displayCommand,
      detail: parsed.verificationUri
        ? 'Complete the browser OAuth step, then refresh provider status.'
        : 'Started Codex OAuth login. Complete sign-in, then refresh provider status.',
      verificationUri: parsed.verificationUri,
      userCode: parsed.userCode,
      instructions: instructions || null
    };
    this.latestOAuthStart = result;
    return result;
  }

  public dispose(): void {
    this.oauthLoginProcess?.kill();
    this.oauthLoginProcess = null;
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
      return { credential: credentialFromToken(oauthToken, 'oauth_bearer_env'), oauthCommandConfigured: false, commandError: null };
    }

    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (apiKey) {
      return { credential: { token: apiKey, source: 'api_key_env' }, oauthCommandConfigured: false, commandError: null };
    }

    const codexCredential = this.getCodexAuthFileCredential();
    if (codexCredential) {
      return { credential: codexCredential, oauthCommandConfigured: false, commandError: null };
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
    const credential = credentialFromToken(token, 'oauth_command');
    this.commandCredential = {
      commandKey,
      credential,
      expiresAt: now + refreshMs
    };
    return { credential, error: null };
  }

  private getCodexAuthFileCredential(): OpenAiCredential | null {
    const path = this.codexAuthPath();
    if (!path || !existsSync(path)) return null;
    try {
      const root = recordFromUnknown(JSON.parse(readFileSync(path, 'utf8')));
      const tokens = recordFromUnknown(root?.tokens);
      const accessToken = stringField(tokens, 'access_token');
      if (root && stringField(root, 'auth_mode') === 'chatgpt' && accessToken) {
        const accountId =
          stringField(tokens, 'account_id') ??
          stringField(tokens, 'accountId') ??
          stringField(tokens, 'chatgpt_account_id') ??
          stringField(root, 'account_id') ??
          stringField(root, 'accountId') ??
          extractChatGptAccountId(accessToken) ??
          undefined;
        return accountId ? { token: accessToken, source: 'codex_oauth_file', accountId } : { token: accessToken, source: 'codex_oauth_file' };
      }
    } catch {
      return null;
    }
    return null;
  }

  private codexAuthPath(): string | null {
    if (this.options.codexAuthPath !== undefined) return this.options.codexAuthPath;
    const configuredPath = process.env.BEALE_OPENAI_CODEX_AUTH_FILE?.trim();
    if (configuredPath) return configuredPath;
    if ((process.env.NODE_ENV === 'test' || process.env.VITEST_WORKER_ID) && process.env.BEALE_OPENAI_ENABLE_CODEX_AUTH_FILE !== '1') return null;
    return join(homedir(), '.codex', 'auth.json');
  }

  private codexCommand(): string {
    return this.options.codexCommand?.trim() || 'codex';
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
  if (probe.credential?.source === 'oauth_command' || probe.credential?.source === 'oauth_bearer_env' || probe.credential?.source === 'codex_oauth_file') return 'oauth_ready';
  if (probe.credential?.source === 'api_key_env') return 'development_fallback';
  if (probe.oauthCommandConfigured) return 'oauth_command_failed';
  return 'not_configured';
}

function labelFor(source: Exclude<OpenAiAuthSource, 'not_configured'> | null, readiness: OpenAiAuthReadiness): string {
  if (source === 'oauth_command') return 'OAuth command token configured';
  if (source === 'oauth_bearer_env') return 'OAuth bearer token configured';
  if (source === 'codex_oauth_file') return 'Codex OAuth session configured';
  if (source === 'api_key_env') return 'API key development fallback configured';
  if (readiness === 'oauth_command_failed') return 'OAuth command needs attention';
  return 'OpenAI OAuth not configured';
}

function credentialHintFor(readiness: OpenAiAuthReadiness): string {
  if (readiness === 'oauth_ready') return 'Credential is available only to the trusted host process.';
  if (readiness === 'development_fallback') return 'Development fallback is active. OAuth remains the first-release path.';
  if (readiness === 'oauth_command_failed') return 'The configured OAuth command did not produce a usable bearer token.';
  return 'Authenticate through Codex OAuth. Beale reads the resulting host-side session without exposing tokens to the renderer or guest VMs.';
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
  return 'Authenticate with OpenAI in Settings > Providers.';
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
      status: credential?.source === 'oauth_command' || credential?.source === 'oauth_bearer_env' || credential?.source === 'codex_oauth_file' ? 'complete' : readiness === 'development_fallback' ? 'warning' : probe.oauthCommandConfigured ? 'current' : 'blocked',
      detail: credential?.source === 'oauth_command' || credential?.source === 'oauth_bearer_env' || credential?.source === 'codex_oauth_file'
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

async function collectInitialOAuthOutput(child: ChildProcessWithoutNullStreams): Promise<string> {
  let output = '';
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(output);
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      const parsed = parseOAuthInstructions(output);
      if (parsed.verificationUri && parsed.userCode) {
        finish();
      }
    };
    const timer = setTimeout(finish, 2500);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => fail(error.message));
    child.once('exit', (code) => {
      if (code === 0) {
        finish();
        return;
      }
      fail(safeCommandFailure(output || `status ${code}`));
    });
  });
}

function parseOAuthInstructions(output: string): Pick<OpenAiOAuthStartResult, 'verificationUri' | 'userCode'> {
  const verificationUri = output.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
  const userCode = output.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/i)?.[0].toUpperCase() ?? null;
  return { verificationUri, userCode };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function extractChatGptAccountId(token: string): string | null {
  const payload = decodeJwtPayload(token);
  const authClaim = recordFromUnknown(payload?.['https://api.openai.com/auth']);
  return stringField(authClaim, 'chatgpt_account_id');
}

function credentialFromToken(token: string, source: Exclude<OpenAiAuthSource, 'not_configured'>): OpenAiCredential {
  const accountId = extractChatGptAccountId(token);
  return accountId ? { token, source, accountId } : { token, source };
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1] ?? '';
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '=');
    return recordFromUnknown(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')));
  } catch {
    return null;
  }
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
    'DBUS_SESSION_BUS_ADDRESS',
    'DISPLAY',
    'WAYLAND_DISPLAY',
    'BROWSER',
    'WSL_INTEROP',
    'WSL_DISTRO_NAME',
    'XAUTHORITY'
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

function safeDisplayOutput(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/sk-[A-Za-z0-9_-]+/g, 'sk-...redacted')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer ...redacted')
    .replace(/\b[A-Za-z0-9._%+-]+:[A-Za-z0-9._%+-]+@/g, '...redacted@')
    .trim()
    .slice(0, 1000);
}
