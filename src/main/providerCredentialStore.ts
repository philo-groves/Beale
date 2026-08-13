import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResearchModelProviderId } from '@shared/types';

const API_KEY_ENVIRONMENT_VARIABLES: Readonly<Record<ResearchModelProviderId, string>> = {
  'openai-codex': 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  xai: 'XAI_API_KEY'
};
const MAX_API_KEY_LENGTH = 16_384;

interface EncryptedCredentialFile {
  version: 1;
  apiKeys: Partial<Record<ResearchModelProviderId, string>>;
}

export interface CredentialEncryption {
  available(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

export class ProviderCredentialStore {
  private readonly managedApiKeys = new Map<ResearchModelProviderId, string>();
  private readonly initialEnvironment = new Map<ResearchModelProviderId, string | undefined>();

  public constructor(
    private readonly path: string | null = null,
    private readonly encryption: CredentialEncryption | null = null
  ) {
    for (const providerId of providerIds()) {
      this.initialEnvironment.set(providerId, process.env[environmentVariable(providerId)]);
    }
    this.load();
  }

  public setApiKey(providerId: ResearchModelProviderId, apiKey: string): void {
    requireProviderId(providerId);
    const normalized = apiKey.trim();
    if (!normalized) throw new Error('API key is required.');
    if (normalized.length > MAX_API_KEY_LENGTH) throw new Error('API key is too long.');
    this.requireEncryption();
    const previousManaged = this.managedApiKeys.get(providerId);
    const previousEnvironment = process.env[environmentVariable(providerId)];
    this.managedApiKeys.set(providerId, normalized);
    process.env[environmentVariable(providerId)] = normalized;
    try {
      this.persist();
    } catch (error) {
      if (previousManaged === undefined) this.managedApiKeys.delete(providerId);
      else this.managedApiKeys.set(providerId, previousManaged);
      if (previousEnvironment === undefined) delete process.env[environmentVariable(providerId)];
      else process.env[environmentVariable(providerId)] = previousEnvironment;
      throw error;
    }
  }

  public isApiKeyConfigured(providerId: ResearchModelProviderId): boolean {
    requireProviderId(providerId);
    return Boolean(process.env[environmentVariable(providerId)]?.trim());
  }

  public removeApiKey(providerId: ResearchModelProviderId): void {
    requireProviderId(providerId);
    const managed = this.managedApiKeys.get(providerId);
    if (!managed) {
      if (process.env[environmentVariable(providerId)]?.trim()) {
        throw new Error('This API key comes from the host environment and must be removed there.');
      }
      return;
    }
    const previousEnvironment = process.env[environmentVariable(providerId)];
    this.managedApiKeys.delete(providerId);
    if (process.env[environmentVariable(providerId)] === managed) {
      const initial = this.initialEnvironment.get(providerId);
      if (initial === undefined) delete process.env[environmentVariable(providerId)];
      else process.env[environmentVariable(providerId)] = initial;
    }
    try {
      this.persist();
    } catch (error) {
      this.managedApiKeys.set(providerId, managed);
      if (previousEnvironment === undefined) delete process.env[environmentVariable(providerId)];
      else process.env[environmentVariable(providerId)] = previousEnvironment;
      throw error;
    }
  }

  private load(): void {
    if (!this.path || !this.encryption?.available()) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as EncryptedCredentialFile;
      if (parsed.version !== 1 || !parsed.apiKeys || typeof parsed.apiKeys !== 'object') return;
      for (const providerId of providerIds()) {
        const encrypted = parsed.apiKeys[providerId];
        if (typeof encrypted !== 'string' || !encrypted) continue;
        const apiKey = this.encryption.decrypt(Buffer.from(encrypted, 'base64')).trim();
        if (!apiKey) continue;
        this.managedApiKeys.set(providerId, apiKey);
        if (!process.env[environmentVariable(providerId)]?.trim()) {
          process.env[environmentVariable(providerId)] = apiKey;
        }
      }
    } catch {
      // A missing, unreadable, or undecryptable credential file is treated as empty.
    }
  }

  private persist(): void {
    if (!this.path || !this.encryption) return;
    const apiKeys: Partial<Record<ResearchModelProviderId, string>> = {};
    for (const [providerId, apiKey] of this.managedApiKeys) {
      apiKeys[providerId] = this.encryption.encrypt(apiKey).toString('base64');
    }
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ version: 1, apiKeys } satisfies EncryptedCredentialFile), {
      encoding: 'utf8',
      mode: 0o600
    });
  }

  private requireEncryption(): void {
    if (this.path && (!this.encryption || !this.encryption.available())) {
      throw new Error('Secure credential storage is unavailable on this system.');
    }
  }
}

function providerIds(): ResearchModelProviderId[] {
  return ['openai-codex', 'anthropic', 'xai'];
}

function environmentVariable(providerId: ResearchModelProviderId): string {
  return API_KEY_ENVIRONMENT_VARIABLES[providerId];
}

function requireProviderId(providerId: ResearchModelProviderId): void {
  if (!providerIds().includes(providerId)) throw new Error('Unsupported provider credential target.');
}
