import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ResearchModelProviderId } from '@shared/types';

const API_KEY_ENVIRONMENT_VARIABLES: Readonly<Record<ResearchModelProviderId, string>> = {
  'openai-codex': 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  xai: 'XAI_API_KEY',
  zai: 'ZAI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY'
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

export interface ProviderCredentialStoreOptions {
  deferLoad?: boolean;
}

export class ProviderCredentialStore {
  private readonly managedApiKeys = new Map<ResearchModelProviderId, string>();
  private readonly initialEnvironment = new Map<ResearchModelProviderId, string | undefined>();
  private loaded = false;

  public constructor(
    private readonly path: string | null = null,
    private readonly encryption: CredentialEncryption | null = null,
    options: ProviderCredentialStoreOptions = {}
  ) {
    for (const providerId of providerIds()) {
      this.initialEnvironment.set(providerId, process.env[environmentVariable(providerId)]);
    }
    if (!options.deferLoad) this.ensureLoaded();
  }

  public setApiKey(providerId: ResearchModelProviderId, apiKey: string): void {
    this.ensureLoaded();
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

  public initialize(): boolean {
    return this.ensureLoaded();
  }

  public isApiKeyConfigured(providerId: ResearchModelProviderId): boolean {
    this.ensureLoaded();
    requireProviderId(providerId);
    return Boolean(process.env[environmentVariable(providerId)]?.trim());
  }

  public removeApiKey(providerId: ResearchModelProviderId): void {
    this.ensureLoaded();
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
    if (!this.path || !existsSync(this.path)) return;
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as EncryptedCredentialFile;
      if (parsed.version !== 1 || !parsed.apiKeys || typeof parsed.apiKeys !== 'object') return;
      const encryptedApiKeys = providerIds()
        .map((providerId) => [providerId, parsed.apiKeys[providerId]] as const)
        .filter((entry): entry is readonly [ResearchModelProviderId, string] =>
          typeof entry[1] === 'string' && entry[1].length > 0);
      if (encryptedApiKeys.length === 0 || !this.encryption?.available()) return;
      for (const [providerId, encrypted] of encryptedApiKeys) {
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

  private ensureLoaded(): boolean {
    if (this.loaded) return false;
    this.loaded = true;
    this.load();
    return true;
  }

  private persist(): void {
    if (!this.path) return;
    if (this.managedApiKeys.size === 0) {
      if (existsSync(this.path)) unlinkSync(this.path);
      return;
    }
    if (!this.encryption) return;
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
  return ['openai-codex', 'anthropic', 'xai', 'zai', 'openrouter'];
}

function environmentVariable(providerId: ResearchModelProviderId): string {
  return API_KEY_ENVIRONMENT_VARIABLES[providerId];
}

function requireProviderId(providerId: ResearchModelProviderId): void {
  if (!providerIds().includes(providerId)) throw new Error('Unsupported provider credential target.');
}
