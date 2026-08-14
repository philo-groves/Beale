import { spawn } from 'node:child_process';
import type {
  ProviderSettings,
  ResearchModelEffortLevel,
  ResearchModelProviderId
} from '@shared/types';
import { honeycrispProcessEnvironment, resolveHoneycrispInvocation } from './honeycrispRunEngine';

const COMPLETION_TIMEOUT_MS = 5 * 60_000;
const MAX_COMPLETION_OUTPUT_CHARS = 2_000_000;

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
  const invocation = resolveHoneycrispInvocation();
  const child = spawn(invocation.command, [...invocation.prefixArgs, 'complete', '--json'], {
    cwd: invocation.cwd,
    env: honeycrispProcessEnvironment(null, request.preferredAuthenticationMethods),
    windowsHide: true
  });
  child.stdin.on('error', () => undefined);
  child.stdin.end(JSON.stringify({
    schemaVersion: 1,
    provider: request.provider,
    model: request.model,
    effort: request.effort,
    systemPrompt: request.systemPrompt,
    prompt: request.prompt,
    ...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
    cwd: request.cwd
  }));

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (value: string, chunk: Buffer): string => {
      const next = value + chunk.toString('utf8');
      return next.length <= MAX_COMPLETION_OUTPUT_CHARS ? next : next.slice(-MAX_COMPLETION_OUTPUT_CHARS);
    };
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', abort);
      callback();
    };
    const abort = (): void => {
      child.kill();
      finish(() => reject(new Error('Provider completion was canceled.')));
    };
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error('Provider completion timed out.')));
    }, COMPLETION_TIMEOUT_MS);
    timeout.unref();
    if (request.signal?.aborted) {
      abort();
      return;
    }
    request.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.once('error', (error) => finish(() => reject(error)));
    child.once('close', (code) => {
      finish(() => {
        if (code !== 0) {
          reject(new Error(safeCompletionError(stderr || stdout || `Honeycrisp completion exited with status ${String(code)}.`)));
          return;
        }
        try {
          const line = stdout.trim().split(/\r?\n/u).filter(Boolean).at(-1);
          const parsed = line ? JSON.parse(line) as unknown : null;
          if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.text !== 'string' || !parsed.text.trim()) {
            throw new Error('Honeycrisp returned an invalid completion response.');
          }
          resolve(parsed.text.trim());
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    });
  });
}

function safeCompletionError(value: string): string {
  return value
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .replace(/(?:sk|xai)-[A-Za-z0-9_-]+/gu, '...redacted')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/giu, 'Bearer ...redacted')
    .trim()
    .slice(0, 2_000);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
