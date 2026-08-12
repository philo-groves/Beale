import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
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

const SUPPORTED_PROVIDERS: readonly ResearchProviderId[] = ['anthropic', 'xai'];
const MODEL_PROVIDERS: readonly ResearchModelProviderId[] = ['openai-codex', 'anthropic', 'xai'];
const EFFORT_LEVELS: readonly ResearchModelEffortLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const STATUS_TIMEOUT_MS = 10_000;
const INITIAL_OAUTH_OUTPUT_MS = 2_500;
const MAX_AUTH_OUTPUT_CHARS = 16_000;

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
  private readonly latestStarts = new Map<ResearchProviderId, ResearchProviderOAuthStartResult>();
  private modelCatalog: ResearchProviderModelCatalog[] | null = null;

  public async getStatuses(): Promise<ResearchProviderStatus[]> {
    return Promise.all(SUPPORTED_PROVIDERS.map((providerId) => this.getStatus(providerId)));
  }

  public async getModelCatalog(): Promise<ResearchProviderModelCatalog[]> {
    if (this.modelCatalog) return this.modelCatalog;
    const catalogs = await Promise.all(
      MODEL_PROVIDERS.map(async (providerId) => {
        const result = await runHoneycrispCommand(['models', 'list', providerId, '--json']);
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
    const running = this.loginProcesses.get(providerId);
    if (running && running.exitCode === null && !running.killed) {
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

    const invocation = resolveHoneycrispInvocation();
    const child = spawn(invocation.command, [...invocation.prefixArgs, 'auth', 'login', providerId], {
      cwd: invocation.cwd,
      env: honeycrispProcessEnvironment(),
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
      command: `honeycrisp auth login ${providerId}`,
      detail: parsed.verificationUri
        ? `Complete ${providerDisplayName(providerId)} authentication in the browser, then refresh provider status.`
        : `${providerDisplayName(providerId)} authentication started. Complete the provider sign-in, then refresh status.`,
      verificationUri: parsed.verificationUri,
      userCode: parsed.userCode,
      instructions: instructions || null
    };
    this.latestStarts.set(providerId, result);
    return result;
  }

  public dispose(): void {
    for (const child of this.loginProcesses.values()) child.kill();
    this.loginProcesses.clear();
  }

  private async getStatus(providerId: ResearchProviderId): Promise<ResearchProviderStatus> {
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
        readiness: verification.configured ? 'ready' : 'not_configured',
        authMethods: status.authMethods,
        credentialType: status.storedCredentialType,
        source,
        defaultModel: verification.modelId,
        credentialsHostOnly: true,
        loginInProgress,
        statusDetail: providerStatusDetail(providerId, verification.configured, source, loginInProgress),
        apiKeyEnvironmentVariable: providerId === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'XAI_API_KEY'
      };
    } catch (error) {
      return {
        id: providerId,
        name: providerDisplayName(providerId),
        configured: false,
        readiness: 'unavailable',
        authMethods: ['api_key', 'oauth'],
        credentialType: null,
        source: null,
        defaultModel: null,
        credentialsHostOnly: true,
        loginInProgress: this.loginProcesses.has(providerId),
        statusDetail: `Honeycrisp could not inspect ${providerDisplayName(providerId)}: ${errorMessage(error)}`,
        apiKeyEnvironmentVariable: providerId === 'anthropic' ? 'ANTHROPIC_API_KEY' : 'XAI_API_KEY'
      };
    }
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

async function runHoneycrispCommand(args: readonly string[]): Promise<AuthCommandResult> {
  const invocation = resolveHoneycrispInvocation();
  const child = spawn(invocation.command, [...invocation.prefixArgs, ...args], {
    cwd: invocation.cwd,
    env: honeycrispProcessEnvironment(),
    windowsHide: true
  });
  return collectCommandOutput(child, STATUS_TIMEOUT_MS);
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

function collectCommandOutput(child: ChildProcessWithoutNullStreams, timeoutMs: number): Promise<AuthCommandResult> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current: string, chunk: Buffer): string => (current + chunk.toString('utf8')).slice(-MAX_AUTH_OUTPUT_CHARS);
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
  return `${name} is not configured. Use subscription OAuth here or provide the provider API key in Beale's host environment.`;
}

function providerDisplayName(providerId: ResearchProviderId): string {
  return providerId === 'anthropic' ? 'Anthropic (Claude)' : 'xAI (Grok/X)';
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
