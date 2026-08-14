import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ProviderCredentialStore } from '../src/main/providerCredentialStore';

const originalEnvironment = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  XAI_API_KEY: process.env.XAI_API_KEY,
  ZAI_API_KEY: process.env.ZAI_API_KEY
};
const directories: string[] = [];

afterEach(() => {
  restoreEnvironment('OPENAI_API_KEY');
  restoreEnvironment('ANTHROPIC_API_KEY');
  restoreEnvironment('XAI_API_KEY');
  restoreEnvironment('ZAI_API_KEY');
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('provider credential store', () => {
  it('persists encrypted API keys and restores them without writing plaintext', () => {
    delete process.env.XAI_API_KEY;
    const directory = mkdtempSync(join(tmpdir(), 'beale-provider-credentials-'));
    directories.push(directory);
    const path = join(directory, 'credentials.json');
    const encryption = {
      available: () => true,
      encrypt: (value: string) => Buffer.from(`encrypted:${[...value].reverse().join('')}`, 'utf8'),
      decrypt: (value: Buffer) => [...value.toString('utf8').replace(/^encrypted:/u, '')].reverse().join('')
    };
    const key = 'xai-test-secret-value';

    new ProviderCredentialStore(path, encryption).setApiKey('xai', key);

    expect(process.env.XAI_API_KEY).toBe(key);
    expect(readFileSync(path, 'utf8')).not.toContain(key);
    delete process.env.XAI_API_KEY;
    new ProviderCredentialStore(path, encryption);
    expect(process.env.XAI_API_KEY).toBe(key);
  });

  it('maps Z.ai API-key credentials to the dedicated host environment variable', () => {
    delete process.env.ZAI_API_KEY;
    const store = new ProviderCredentialStore();
    store.setApiKey('zai', 'zai-test-secret');
    expect(process.env.ZAI_API_KEY).toBe('zai-test-secret');
    store.removeApiKey('zai');
    expect(process.env.ZAI_API_KEY).toBeUndefined();
  });

  it('removes only Beale-managed keys and preserves host-environment ownership', () => {
    delete process.env.OPENAI_API_KEY;
    const store = new ProviderCredentialStore();
    store.setApiKey('openai-codex', 'managed-key');
    store.removeApiKey('openai-codex');
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    process.env.ANTHROPIC_API_KEY = 'environment-key';
    const environmentStore = new ProviderCredentialStore();
    expect(() => environmentStore.removeApiKey('anthropic')).toThrow('comes from the host environment');
    expect(process.env.ANTHROPIC_API_KEY).toBe('environment-key');
  });
});

function restoreEnvironment(name: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
