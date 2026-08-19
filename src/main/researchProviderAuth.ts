import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type {
  ResearchModelEffortLevel,
  ResearchModelProviderId,
  ResearchProviderId,
  ResearchProviderModel,
  ResearchProviderModelCatalog,
  ResearchProviderOAuthStartResult,
  ResearchProviderStatus
} from '@shared/types';
import { honeycrispProcessEnvironment, resolveHoneycrispInvocation } from './honeycrispRunEngine';

const SUPPORTED_PROVIDERS: readonly ResearchProviderId[] = ['anthropic', 'xai', 'zai', 'openrouter'];
const MODEL_PROVIDERS: readonly ResearchModelProviderId[] = ['openai-codex', 'anthropic', 'xai', 'zai', 'openrouter'];
const EFFORT_LEVELS: readonly ResearchModelEffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const STATUS_TIMEOUT_MS = 10_000;
const INITIAL_OAUTH_OUTPUT_MS = 2_500;
const MAX_AUTH_OUTPUT_CHARS = 16_000;
const MAX_MODEL_CATALOG_OUTPUT_CHARS = 4 * 1024 * 1024;
const EXTERNAL_AUTH_TIMEOUT_MS = 5 * 60_000;

interface AuthCommandResult {
  stdout: string;
  stderr: string;
}

interface ParsedAuthStatus {
  providerId: string;
  providerName: string;
  authMethods: ('api_key' | 'oauth')[];
  storedCredentialType: 'api_key' | 'oauth' | null;
}

interface ParsedAuthVerification {
  providerId: string;
  providerName: string;
  modelId: string;
  configured: boolean;
  source: string | null;
}

export class ResearchProviderAuthService {
  private readonly loginProcesses = new Map<ResearchProviderId, ChildProcessWithoutNullStreams>();
  private readonly externalLoginDeadlines = new Map<ResearchProviderId, number>();
  private readonly latestStarts = new Map<ResearchProviderId, ResearchProviderOAuthStartResult>();
  private modelCatalog: ResearchProviderModelCatalog[] | null = null;

  public async getStatuses(): Promise<ResearchProviderStatus[]> {
    return Promise.all(SUPPORTED_PROVIDERS.map((providerId) => this.getStatus(providerId)));
  }

  public async getModelCatalog(): Promise<ResearchProviderModelCatalog[]> {
    if (this.modelCatalog) return this.modelCatalog;
    const catalogs = await Promise.all(
      MODEL_PROVIDERS.map(async (providerId) => {
        const result = await runHoneycrispCommand(
          ['models', 'list', providerId, '--json'],
          MAX_MODEL_CATALOG_OUTPUT_CHARS
        );
        const [catalog] = parseHoneycrispModelCatalog(result.stdout);
        if (!catalog || catalog.providerId !== providerId) {
          throw new Error(`Honeycrisp returned an unrecognized ${providerId} model catalog.`);
        }
        return catalog;
      })
    );
    this.modelCatalog = catalogs;
    return catalogs;
  }

  public async startOAuthLogin(providerId: ResearchProviderId): Promise<ResearchProviderOAuthStartResult> {
    requireSupportedProvider(providerId);
    if (providerId === 'openrouter') {
      throw new Error('OpenRouter supports API key authentication only.');
    }
    if (providerId === 'zai' && zcodeSubscriptionConfigured()) {
      return {
        providerId,
        started: false,
        command: 'ZCode',
        detail: 'Z.ai subscription authentication is already configured through ZCode.',
        verificationUri: null,
        userCode: null,
        instructions: null
      };
    }
    const running = this.loginProcesses.get(providerId);
    const externalLoginDeadline = this.externalLoginDeadlines.get(providerId) ?? 0;
    if ((running && running.exitCode === null && !running.killed) || externalLoginDeadline > Date.now()) {
      return this.latestStarts.get(providerId) ?? {
        providerId,
        started: false,
        command: `honeycrisp auth login ${providerId}`,
        detail: `${providerDisplayName(providerId)} authentication is already running.`,
        verificationUri: null,
        userCode: null,
        instructions: null
      };
    }
    this.externalLoginDeadlines.delete(providerId);

    const zcodeDesktop = providerId === 'zai' ? zcodeDesktopInvocation() : null;
    if (zcodeDesktop) {
      await launchDetachedApplication(zcodeDesktop);
      this.externalLoginDeadlines.set(providerId, Date.now() + EXTERNAL_AUTH_TIMEOUT_MS);
      const result: ResearchProviderOAuthStartResult = {
        providerId,
        started: true,
        command: zcodeDesktop.displayCommand,
        detail: 'ZCode opened. In Model Settings, select Z.ai and connect your account. Beale will detect the shared sign-in automatically.',
        verificationUri: null,
        userCode: null,
        instructions: null
      };
      this.latestStarts.set(providerId, result);
      return result;
    }

    const honeycrispInvocation = resolveHoneycrispInvocation();
    const claudeInvocation = claudeSubscriptionLoginInvocation();
    const zcodeInvocation = providerId === 'zai' ? zcodeCliInvocation(['login']) : null;
    if (providerId === 'zai' && !zcodeInvocation) {
      throw new Error('The official ZCode CLI was not found. Install ZCode before signing in with a Z.ai subscription.');
    }
    const invocation = providerId === 'anthropic' && claudeInvocation
      ? claudeInvocation
      : zcodeInvocation
        ? { ...zcodeInvocation, displayCommand: 'zcode login' }
      : {
          command: honeycrispInvocation.command,
          args: [...honeycrispInvocation.prefixArgs, 'auth', 'login', providerId],
          cwd: honeycrispInvocation.cwd,
          displayCommand: `honeycrisp auth login ${providerId}`
        };
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: providerAuthProcessEnvironment(providerId),
      windowsHide: true
    });
    this.loginProcesses.set(providerId, child);
    child.stdin.on('error', () => undefined);
    const clearLoginProcess = (): void => {
      if (this.loginProcesses.get(providerId) === child) this.loginProcesses.delete(providerId);
    };
    child.once('error', clearLoginProcess);
    child.once('exit', clearLoginProcess);

    const output = await collectInitialAuthOutput(child);
    const instructions = safeAuthOutput(output);
    const parsed = parseProviderOAuthInstructions(instructions);
    const result: ResearchProviderOAuthStartResult = {
      providerId,
      started: true,
      command: invocation.displayCommand,
      detail: providerId === 'anthropic' && claudeInvocation
        ? 'Complete Anthropic authentication in the opened Claude CLI window. Beale will refresh when the official CLI finishes.'
        : providerId === 'zai'
          ? 'Complete Z.ai authentication in the browser. Beale will refresh when the official ZCode CLI finishes.'
        : parsed.verificationUri
        ? `Complete ${providerDisplayName(providerId)} authentication in the browser, then refresh provider status.`
        : `${providerDisplayName(providerId)} authentication started. Complete the provider sign-in, then refresh status.`,
      verificationUri: parsed.verificationUri,
      userCode: parsed.userCode,
      instructions: instructions || null
    };
    this.latestStarts.set(providerId, result);
    return result;
  }

  public cancelOAuthLogin(providerId: ResearchProviderId): void {
    requireSupportedProvider(providerId);
    const child = this.loginProcesses.get(providerId);
    this.loginProcesses.delete(providerId);
    this.externalLoginDeadlines.delete(providerId);
    this.latestStarts.delete(providerId);
    child?.kill();
  }

  public async forgetSubscription(providerId: ResearchProviderId): Promise<void> {
    requireSupportedProvider(providerId);
    if (providerId === 'openrouter') return;
    this.cancelOAuthLogin(providerId);
    if (providerId === 'zai') {
      const invocation = zcodeCliInvocation(['logout']);
      if (!invocation) throw new Error('The official ZCode CLI was not found. Install ZCode before forgetting its subscription.');
      await collectCommandOutput(spawn(invocation.command, invocation.args, {
        cwd: invocation.cwd,
        env: providerAuthProcessEnvironment(providerId),
        windowsHide: true
      }), STATUS_TIMEOUT_MS);
      return;
    }
    await runHoneycrispCommand(['auth', 'logout', providerId]);
  }

  public dispose(): void {
    for (const providerId of [...this.loginProcesses.keys()]) this.cancelOAuthLogin(providerId);
  }

  private async getStatus(providerId: ResearchProviderId): Promise<ResearchProviderStatus> {
    if (providerId === 'zai') return this.getZaiStatus();
    const apiKeyEnvironmentVariable = providerApiKeyEnvironmentVariable(providerId);
    const environmentApiKeyConfigured = Boolean(process.env[apiKeyEnvironmentVariable]?.trim());
    try {
      const [statusResult, verifyResult] = await Promise.all([
        runHoneycrispCommand(['auth', 'status', providerId]),
        runHoneycrispCommand(['auth', 'verify', providerId])
      ]);
      const status = parseHoneycrispAuthStatus(statusResult.stdout);
      const verification = parseHoneycrispAuthVerification(verifyResult.stdout);
      if (!status || !verification || status.providerId !== providerId || verification.providerId !== providerId) {
        throw new Error(`Honeycrisp returned an unrecognized ${providerId} auth status.`);
      }
      const loginInProgress = this.loginProcesses.has(providerId);
      const source = verification.source ?? status.storedCredentialType ?? null;
      return {
        id: providerId,
        name: providerDisplayName(providerId),
        configured: verification.configured,
        subscriptionConfigured: status.storedCredentialType === 'oauth',
        apiKeyConfigured: environmentApiKeyConfigured || status.storedCredentialType === 'api_key',
        readiness: verification.configured ? 'ready' : 'not_configured',
        authMethods: status.authMethods,
        credentialType: status.storedCredentialType,
        source,
        defaultModel: verification.modelId,
        credentialsHostOnly: true,
        loginInProgress,
        statusDetail: providerStatusDetail(providerId, verification.configured, source, loginInProgress),
        apiKeyEnvironmentVariable
      };
    } catch (error) {
      return {
        id: providerId,
        name: providerDisplayName(providerId),
        configured: false,
        subscriptionConfigured: false,
        apiKeyConfigured: environmentApiKeyConfigured,
        readiness: 'unavailable',
        authMethods: providerId === 'openrouter' ? ['api_key'] : ['api_key', 'oauth'],
        credentialType: null,
        source: null,
        defaultModel: null,
        credentialsHostOnly: true,
        loginInProgress: this.loginProcesses.has(providerId),
        statusDetail: `Honeycrisp could not inspect ${providerDisplayName(providerId)}: ${errorMessage(error)}`,
        apiKeyEnvironmentVariable
      };
    }
  }

  private async getZaiStatus(): Promise<ResearchProviderStatus> {
    const apiKeyEnvironmentVariable = 'ZAI_API_KEY' as const;
    const apiKeyConfigured = Boolean(process.env[apiKeyEnvironmentVariable]?.trim());
    const subscriptionConfigured = zcodeSubscriptionConfigured();
    if (subscriptionConfigured || (this.externalLoginDeadlines.get('zai') ?? 0) <= Date.now()) {
      this.externalLoginDeadlines.delete('zai');
    }
    const cliAvailable = zcodeCliInvocation(['version']) !== null;
    const loginInProgress = this.loginProcesses.has('zai') || this.externalLoginDeadlines.has('zai');
    let defaultModel = 'glm-5.3';
    let honeycrispApiKeyConfigured = false;
    try {
      const verification = parseHoneycrispAuthVerification(
        (await runHoneycrispCommand(['auth', 'verify', 'zai', 'glm-5.3'])).stdout
      );
      if (verification?.providerId === 'zai') {
        defaultModel = verification.modelId;
        honeycrispApiKeyConfigured = verification.configured && verification.source === apiKeyEnvironmentVariable;
      }
    } catch {
      // Subscription readiness is owned by official ZCode state, not Honeycrisp's Pi route.
    }
    const configuredApiKey = apiKeyConfigured || honeycrispApiKeyConfigured;
    const configured = subscriptionConfigured || configuredApiKey;
    const source = subscriptionConfigured ? 'official ZCode subscription' : configuredApiKey ? apiKeyEnvironmentVariable : null;
    return {
      id: 'zai',
      name: providerDisplayName('zai'),
      configured,
      subscriptionConfigured,
      apiKeyConfigured: configuredApiKey,
      readiness: configured ? 'ready' : cliAvailable ? 'not_configured' : 'unavailable',
      authMethods: ['api_key', 'oauth'],
      credentialType: subscriptionConfigured ? 'oauth' : configuredApiKey ? 'api_key' : null,
      source,
      defaultModel,
      credentialsHostOnly: true,
      loginInProgress,
      statusDetail: !cliAvailable && !configuredApiKey
        ? 'The official ZCode CLI was not found. Install ZCode for subscription access, or configure a Z.ai API key.'
        : providerStatusDetail('zai', configured, source, loginInProgress),
      apiKeyEnvironmentVariable
    };
  }
}

export function parseHoneycrispAuthStatus(output: string): ParsedAuthStatus | null {
  const line = cleanOutput(output)
    .split('\n')
    .find((candidate) => candidate.includes('\t'));
  if (!line) return null;
  const [providerId, providerName, methods, stored] = line.split('\t').map((value) => value.trim());
  if (!providerId || !providerName || !methods || !stored) return null;
  const authMethods = methods
    .split(',')
    .map((method) => method.trim())
    .filter((method): method is 'api_key' | 'oauth' => method === 'api_key' || method === 'oauth');
  const storedCredentialType = stored === 'api_key' || stored === 'oauth' ? stored : null;
  return { providerId, providerName, authMethods, storedCredentialType };
}

export function parseHoneycrispAuthVerification(output: string): ParsedAuthVerification | null {
  const line = cleanOutput(output).split('\n').find((candidate) => candidate.includes(' model '));
  const match = line?.match(/^(.+) \(([^)]+)\) model (.+): (configured|not configured)(?: via (.+))?$/u);
  if (!match) return null;
  return {
    providerName: match[1]?.trim() ?? '',
    providerId: match[2]?.trim() ?? '',
    modelId: match[3]?.trim() ?? '',
    configured: match[4] === 'configured',
    source: match[5]?.trim() || null
  };
}

export function parseProviderOAuthInstructions(output: string): Pick<ResearchProviderOAuthStartResult, 'verificationUri' | 'userCode'> {
  const verificationUri = output.match(/https:\/\/[^\s)]+/iu)?.[0]?.replace(/[.,;]+$/u, '') ?? null;
  const explicitCode = output.match(/Enter code:\s*([^\s]+)/iu)?.[1] ?? null;
  const dashedCode = output.match(/\b[A-Z0-9]{4,10}-[A-Z0-9]{4,10}\b/iu)?.[0] ?? null;
  return { verificationUri, userCode: (explicitCode ?? dashedCode)?.toUpperCase() ?? null };
}

export function parseHoneycrispModelCatalog(output: string): ResearchProviderModelCatalog[] {
  const parsed = recordValue(JSON.parse(cleanOutput(output)) as unknown);
  if (!parsed || !Array.isArray(parsed.providers)) return [];
  return parsed.providers.flatMap((value) => {
    const provider = recordValue(value);
    const providerId = stringValue(provider?.providerId);
    const providerName = stringValue(provider?.providerName);
    if (!providerId || !providerName || !isModelProviderId(providerId) || !Array.isArray(provider?.models)) return [];
    const models = provider.models.flatMap(parseProviderModel);
    return [{ providerId, providerName, models }];
  });
}

async function runHoneycrispCommand(
  args: readonly string[],
  maxOutputChars = MAX_AUTH_OUTPUT_CHARS
): Promise<AuthCommandResult> {
  const invocation = resolveHoneycrispInvocation();
  const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: invocation.cwd,
    env: honeycrispProcessEnvironment(),
    windowsHide: true
  });
  return collectCommandOutput(child, STATUS_TIMEOUT_MS, maxOutputChars);
}

function parseProviderModel(value: unknown): ResearchProviderModel[] {
  const model = recordValue(value);
  const id = stringValue(model?.id);
  const name = stringValue(model?.name);
  const effortLevels = Array.isArray(model?.effortLevels)
    ? model.effortLevels.filter((level): level is ResearchModelEffortLevel => typeof level === 'string' && EFFORT_LEVELS.includes(level as ResearchModelEffortLevel))
    : [];
  if (!id || !name || typeof model?.reasoning !== 'boolean' || effortLevels.length === 0) return [];
  return [{
    id,
    name,
    reasoning: model.reasoning,
    effortLevels,
    contextWindow: finiteNumber(model.contextWindow),
    maxTokens: finiteNumber(model.maxTokens)
  }];
}

function collectCommandOutput(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
  maxOutputChars = MAX_AUTH_OUTPUT_CHARS
): Promise<AuthCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-maxOutputChars);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('Honeycrisp auth status timed out.')));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      finish(() => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(safeAuthOutput(stderr || stdout || `Honeycrisp auth exited with status ${String(code)}.`)));
      });
    });
  });
}

function collectInitialAuthOutput(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
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
      output = (output + chunk.toString('utf8')).slice(-MAX_AUTH_OUTPUT_CHARS);
      const parsed = parseProviderOAuthInstructions(output);
      if (parsed.verificationUri && parsed.userCode) finish();
    };
    const timer = setTimeout(finish, INITIAL_OAUTH_OUTPUT_MS);
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', (error) => fail(error.message));
    child.once('exit', (code) => {
      if (code === 0) finish();
      else fail(safeAuthOutput(output || `Honeycrisp auth exited with status ${String(code)}.`));
    });
  });
}

function cleanOutput(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/gu, '').trim();
}

function safeAuthOutput(value: string): string {
  return cleanOutput(value)
    .replace(/(?:sk|xai)-[A-Za-z0-9_-]+/gu, '...redacted')
    .replace(/\beyJ[A-Za-z0-9._~-]+/gu, '...redacted')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ...redacted')
    .slice(0, 2_000);
}

function providerStatusDetail(providerId: ResearchProviderId, configured: boolean, source: string | null, loginInProgress: boolean): string {
  const name = providerDisplayName(providerId);
  if (loginInProgress) return `${name} authentication is waiting for the provider sign-in to complete.`;
  if (configured) return `${name} is available to Honeycrisp${source ? ` via ${source}` : ''}.`;
  if (providerId === 'anthropic') {
    return `${name} is not configured. Sign in through the official Claude CLI with a Cyber Verification Program account, or provide ANTHROPIC_API_KEY in Beale's host environment.`;
  }
  if (providerId === 'zai') {
    return `${name} is not configured. Sign in through the official ZCode app, or provide ZAI_API_KEY in Beale's host environment.`;
  }
  if (providerId === 'openrouter') {
    return `${name} is not configured. Configure an API key in Beale or provide OPENROUTER_API_KEY in Beale's host environment.`;
  }

  return `${name} is not configured. Use subscription OAuth here or provide the provider API key in Beale's host environment.`;
}

interface InteractiveAuthInvocation {
  command: string;
  args: string[];
  cwd: string;
  displayCommand: string;
}

export function claudeSubscriptionLoginInvocation(
  platform = process.platform,
  systemRoot = process.env.SystemRoot?.trim() || 'C:\\Windows',
  cwd = process.cwd()
): InteractiveAuthInvocation | null {
  if (platform !== 'win32') return null;
  const powershell = `${systemRoot.replace(/[\\/]+$/u, '')}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const script = [
    "$process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', 'claude auth login --claudeai') -WindowStyle Normal -PassThru",
    '$process.WaitForExit()',
    'exit $process.ExitCode'
  ].join('; ');
  return {
    command: powershell,
    args: ['-NoProfile', '-NonInteractive', '-Command', script],
    cwd,
    displayCommand: 'claude auth login --claudeai'
  };
}

export function zcodeCliInvocation(
  args: readonly string[],
  platform = process.platform,
  userHome = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  cwd = process.cwd()
): Omit<InteractiveAuthInvocation, 'displayCommand'> | null {
  if (platform === 'win32') {
    const bundle = localAppData
      ? join(localAppData, 'Programs', 'ZCode', 'resources', 'glm', 'zcode.cjs')
      : '';
    if (!bundle || !existsSync(bundle)) return null;
    return { command: process.execPath, args: [bundle, ...args], cwd };
  }
  const macBundle = '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs';
  if (platform === 'darwin' && existsSync(macBundle)) {
    return { command: process.execPath, args: [macBundle, ...args], cwd };
  }
  if (!userHome) return null;
  return { command: 'zcode', args: [...args], cwd };
}

export function zcodeDesktopInvocation(
  platform = process.platform,
  localAppData = process.env.LOCALAPPDATA,
  cwd = process.cwd()
): InteractiveAuthInvocation | null {
  if (platform === 'win32') {
    const executable = localAppData ? join(localAppData, 'Programs', 'ZCode', 'ZCode.exe') : '';
    return executable && existsSync(executable)
      ? { command: executable, args: [], cwd, displayCommand: 'ZCode' }
      : null;
  }
  if (platform === 'darwin' && existsSync('/Applications/ZCode.app')) {
    return { command: 'open', args: ['-a', 'ZCode'], cwd, displayCommand: 'ZCode' };
  }
  return null;
}

export function zcodeSubscriptionConfigured(userHome = homedir()): boolean {
  const credentialsPath = join(userHome, '.zcode', 'v2', 'credentials.json');
  if (!existsSync(credentialsPath)) return false;
  try {
    const credentials = recordValue(JSON.parse(readFileSync(credentialsPath, 'utf8')) as unknown);
    const accessToken = credentials?.['oauth:zai:access_token'];
    return typeof accessToken === 'string' && accessToken.trim().length > 0;
  } catch {
    return false;
  }
}

function launchDetachedApplication(invocation: InteractiveAuthInvocation): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

function providerDisplayName(providerId: ResearchProviderId): string {
  if (providerId === 'anthropic') return 'Anthropic (Claude)';
  if (providerId === 'xai') return 'xAI (Grok/X)';
  if (providerId === 'zai') return 'Z.ai (ZCode/GLM)';
  return 'OpenRouter';
}

function providerApiKeyEnvironmentVariable(
  providerId: Exclude<ResearchProviderId, 'zai'>
): 'ANTHROPIC_API_KEY' | 'XAI_API_KEY' | 'OPENROUTER_API_KEY' {
  if (providerId === 'anthropic') return 'ANTHROPIC_API_KEY';
  if (providerId === 'xai') return 'XAI_API_KEY';
  return 'OPENROUTER_API_KEY';
}

function providerAuthProcessEnvironment(providerId: ResearchProviderId): NodeJS.ProcessEnv {
  const env = honeycrispProcessEnvironment();
  if (providerId === 'zai' && process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

function requireSupportedProvider(providerId: ResearchProviderId): void {
  if (!SUPPORTED_PROVIDERS.includes(providerId)) throw new Error(`Unsupported research provider: ${providerId}`);
}

function isModelProviderId(value: string): value is ResearchModelProviderId {
  return MODEL_PROVIDERS.includes(value as ResearchModelProviderId);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
