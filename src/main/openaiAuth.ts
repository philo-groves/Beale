import type { OpenAiAccountStatus, OpenAiAuthReadiness, OpenAiAuthSource, OpenAiOAuthStartResult, OpenAiOnboardingStep, OpenAiTransport } from '@shared/types';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { DEFAULT_RESEARCH_MODEL, DEFAULT_RESEARCH_REASONING_EFFORT } from '../shared/modelDefaults';
import { join, win32 } from 'node:path';

const SECRET_ENV_PATTERN = /KEY|TOKEN|SECRET|PASSWORD|COOKIE|CREDENTIAL|OPENAI/i;
export const OPENAI_SUBSCRIPTION_LOGIN_COMMAND = 'codex login';
export const OPENAI_SUBSCRIPTION_LOGIN_ARGS = ['login'] as const;

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
  private readonly statusCacheMs = positiveIntegerFromEnv('BEALE_OPENAI_STATUS_CACHE_MS', 10_000);
  private statusCache: { expiresAt: number; status: OpenAiAccountStatus } | null = null;

  public constructor(private readonly options: OpenAiAuthServiceOptions = {}) {}

  public getStatus(): OpenAiAccountStatus {
    const now = Date.now();
    if (this.statusCache && this.statusCache.expiresAt > now) {
      return this.statusCache.status;
    }
    const probe = this.resolveCredential();
    const credential = probe.credential;
    const supportsWebSocket = true;
    const readiness = readinessFor(probe);
    const codexCliAvailable = this.resolveCodexCommand() !== null;
    const subscriptionConfigured = credential?.source === 'oauth_command'
      || credential?.source === 'oauth_bearer_env'
      || credential?.source === 'codex_oauth_file'
      || this.getCodexAuthFileCredential() !== null;
    const status: OpenAiAccountStatus = {
      configured: credential !== null,
      subscriptionConfigured,
      apiKeyConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
      loginInProgress: Boolean(this.oauthLoginProcess && this.oauthLoginProcess.exitCode === null && !this.oauthLoginProcess.killed),
      source: credential?.source ?? 'not_configured',
      label: labelFor(credential?.source ?? null, readiness),
      credentialHint: credentialHintFor(readiness),
      credentialsHostOnly: true,
      defaultModel: DEFAULT_RESEARCH_MODEL,
      defaultReasoningEffort: DEFAULT_RESEARCH_REASONING_EFFORT,
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
    this.statusCache = { expiresAt: now + this.statusCacheMs, status };
    return status;
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
    this.statusCache = null;
  }

  public async startOAuthLogin(): Promise<OpenAiOAuthStartResult> {
    this.clearCachedCredential();
    const command = this.resolveCodexCommand();
    const displayCommand = OPENAI_SUBSCRIPTION_LOGIN_COMMAND;
    if (!command) throw new Error('Codex CLI could not be resolved from PATH or the installed Codex Desktop package.');
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

    const child = spawn(command, [...OPENAI_SUBSCRIPTION_LOGIN_ARGS], {
      env: minimalAuthCommandEnv(),
      windowsHide: true
    });
    this.oauthLoginProcess = child;
    child.once('error', () => {
      if (this.oauthLoginProcess === child) {
        this.oauthLoginProcess = null;
        this.statusCache = null;
      }
    });
    child.once('exit', () => {
      if (this.oauthLoginProcess === child) {
        this.oauthLoginProcess = null;
        this.statusCache = null;
      }
    });

    await collectInitialOAuthOutput(child);
    const result: OpenAiOAuthStartResult = {
      started: true,
      command: displayCommand,
      detail: 'Codex opened standard browser sign-in. Complete the local callback flow, then return to Beale.',
      verificationUri: null,
      userCode: null,
      instructions: null
    };
    this.latestOAuthStart = result;
    return result;
  }

  public cancelOAuthLogin(): void {
    const child = this.oauthLoginProcess;
    this.oauthLoginProcess = null;
    this.latestOAuthStart = null;
    child?.kill();
    this.clearCachedCredential();
  }

  public async forgetSubscription(): Promise<void> {
    this.cancelOAuthLogin();
    this.clearCachedCredential();
    const codexAuthPath = this.codexAuthPath();
    if (!this.getCodexAuthFileCredential()) {
      const source = this.resolveCredential().credential?.source;
      if (source === 'oauth_command' || source === 'oauth_bearer_env') {
        throw new Error('This OpenAI subscription credential comes from the host environment and must be removed there.');
      }
      return;
    }
    const command = this.resolveCodexCommand();
    if (command) {
      await collectCommandCompletion(spawn(command, ['logout'], {
        env: minimalAuthCommandEnv(),
        windowsHide: true
      }), 'Codex logout');
    } else if (codexAuthPath) {
      // Codex Desktop can provide the shared auth file without exposing its bundled
      // CLI on the PATH inherited by independently launched Electron applications.
      // The file was validated as a ChatGPT OAuth credential above, so removing this
      // exact file forgets only that host-side subscription session.
      try {
        unlinkSync(codexAuthPath);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
      }
    }
    this.clearCachedCredential();
  }

  public dispose(): void {
    this.cancelOAuthLogin();
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

  private resolveCodexCommand(): string | null {
    const command = this.codexCommand();
    if (commandExists(command)) return command;
    if (this.options.codexCommand?.trim() || process.platform !== 'win32') return null;
    return discoverWindowsCodexDesktopCommand();
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
  return 'Authenticate through Codex OAuth. Beale reads the resulting host-side session without exposing tokens to the renderer.';
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
  return readiness === 'oauth_ready' ? null : OPENAI_SUBSCRIPTION_LOGIN_COMMAND;
}

function onboardingStepsFor(probe: CredentialProbe, readiness: OpenAiAuthReadiness, codexCliAvailable: boolean): OpenAiOnboardingStep[] {
  const credential = probe.credential;
  return [
    {
      id: 'chatgpt_oauth',
      label: 'ChatGPT OAuth',
      status: readiness === 'oauth_ready' ? 'complete' : 'current',
      detail: readiness === 'oauth_ready' ? 'Signed-in account credential is available to Beale.' : codexCliAvailable ? 'Browser OAuth sign-in can be completed through Codex.' : 'Install or expose Codex CLI before browser OAuth sign-in.',
      command: readiness === 'oauth_ready' ? null : OPENAI_SUBSCRIPTION_LOGIN_COMMAND
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
      detail: 'OpenAI credentials stay in the host process and are not exposed to the renderer.',
      command: null
    },
    {
      id: 'model_defaults',
      label: 'Model defaults',
      status: 'complete',
      detail: `Responses API defaults are ${DEFAULT_RESEARCH_MODEL} with ${DEFAULT_RESEARCH_REASONING_EFFORT} reasoning.`,
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

async function collectInitialOAuthOutput(child: ChildProcessWithoutNullStreams): Promise<void> {
  let output = '';
  let settled = false;
  return new Promise((resolve, reject) => {
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    const fail = (message: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-2_000);
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

function discoverWindowsCodexDesktopCommand(): string | null {
  const localAppData = process.env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
  const localCommand = findCodexDesktopBinCommand(join(localAppData, 'OpenAI', 'Codex', 'bin'));
  if (localCommand) return localCommand;

  const systemRoot = process.env.SystemRoot?.trim() || 'C:\\Windows';
  const powershell = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = '$package = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Sort-Object Version -Descending | Select-Object -First 1; if ($null -ne $package) { Write-Output $package.InstallLocation }';
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: minimalAuthCommandEnv(),
    timeout: 3_000,
    windowsHide: true
  });
  if (result.error || result.status !== 0) return null;
  const installLocation = result.stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
  if (!installLocation) return null;
  const command = codexDesktopCommandFromInstallLocation(installLocation);
  return existsSync(command) ? command : null;
}

export function findCodexDesktopBinCommand(binRoot: string): string | null {
  try {
    return readdirSync(binRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(binRoot, entry.name, 'codex.exe'))
      .filter((candidate) => existsSync(candidate))
      .map((candidate) => ({ candidate, modifiedAt: statSync(candidate).mtimeMs }))
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0]?.candidate ?? null;
  } catch {
    return null;
  }
}

export function codexDesktopCommandFromInstallLocation(installLocation: string): string {
  const root = installLocation.trim();
  return win32.isAbsolute(root) ? win32.join(root, 'app', 'resources', 'codex.exe') : join(root, 'app', 'resources', 'codex.exe');
}

function collectCommandCompletion(child: ChildProcessWithoutNullStreams, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let output = '';
    const append = (chunk: Buffer): void => {
      output = (output + chunk.toString('utf8')).slice(-2_000);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed: ${safeCommandFailure(output || `status ${String(code)}`)}`));
    });
  });
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

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
