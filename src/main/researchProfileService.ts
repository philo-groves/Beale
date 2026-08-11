import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeResolvedResearchProfile, serializeResearchProfile } from '../shared/researchProfile';
import type { ResearchProfileId, ResolvedResearchProfile } from '@shared/types';
import { redactForModelText } from './redaction';
import type { HoneycrispInvocation } from './honeycrispRunEngine';

export const RESEARCH_PROFILE_CATALOG_PROTOCOL_VERSION = 1 as const;
const RESEARCH_PROFILE_RESOLUTION_TIMEOUT_MS = 30_000;
const RESEARCH_PROFILE_RESOLUTION_MAX_BYTES = 2 * 1024 * 1024;

interface ResearchProfileCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface ResearchProfileServiceOptions {
  resolveInvocation?: () => HoneycrispInvocation;
  runCommand?: (command: string, args: readonly string[], invocation: HoneycrispInvocation) => ResearchProfileCommandResult;
}

export interface ResearchProfileCatalogEnvelope {
  catalogProtocolVersion: typeof RESEARCH_PROFILE_CATALOG_PROTOCOL_VERSION;
  supportedResearchProfileSchemaVersions: readonly number[];
  resolvedProfile: ResolvedResearchProfile;
}

export class ResearchProfileService {
  public constructor(private readonly options: ResearchProfileServiceOptions = {}) {}

  public resolve(workspaceRoot: string, profileId: ResearchProfileId): ResolvedResearchProfile {
    const invocation = (this.options.resolveInvocation ?? resolveHoneycrispProfileInvocation)();
    const args = [
      ...invocation.prefixArgs,
      'profile',
      'resolve',
      '--workspace-root',
      resolve(workspaceRoot),
      '--profile-id',
      profileId,
      '--json'
    ];
    const result = (this.options.runCommand ?? runResearchProfileCommand)(invocation.command, args, invocation);
    if (result.error || result.status !== 0) {
      const detail = redactForModelText(result.stderr || result.stdout || result.error?.message || 'Honeycrisp profile resolution failed.');
      throw new Error(`Honeycrisp research profile resolution failed: ${detail.slice(0, 1_000)}`);
    }
    return decodeResearchProfileCatalogEnvelope(parseJsonCommandOutput(result.stdout)).resolvedProfile;
  }
}

export function decodeResearchProfileCatalogEnvelope(value: unknown): ResearchProfileCatalogEnvelope {
  const envelope = recordValue(value, 'Honeycrisp research profile catalog');
  if (envelope.catalogProtocolVersion !== RESEARCH_PROFILE_CATALOG_PROTOCOL_VERSION) {
    throw new Error(`Unsupported Honeycrisp profile catalog protocol: ${String(envelope.catalogProtocolVersion)}`);
  }
  const supportedVersions = envelope.supportedResearchProfileSchemaVersions;
  if (
    !Array.isArray(supportedVersions)
    || supportedVersions.length === 0
    || !supportedVersions.every((version) => typeof version === 'number' && Number.isSafeInteger(version) && version > 0)
  ) {
    throw new Error('Honeycrisp profile catalog returned invalid supported schema versions.');
  }
  if (!supportedVersions.includes(1)) {
    throw new Error('Honeycrisp does not advertise research profile schema version 1 support.');
  }

  const resolvedProfile = decodeResolvedResearchProfile({
    profile: envelope.profile,
    hash: envelope.hash,
    source: envelope.source,
    ...(envelope.path === undefined ? {} : { path: envelope.path })
  });
  if (!supportedVersions.includes(resolvedProfile.profile.schemaVersion)) {
    throw new Error(`Honeycrisp profile schema version ${resolvedProfile.profile.schemaVersion} is not advertised by the catalog.`);
  }
  const calculatedHash = createHash('sha256')
    .update('honeycrisp:research-profile:v1\0')
    .update(serializeResearchProfile(resolvedProfile.profile))
    .digest('hex');
  if (calculatedHash !== resolvedProfile.hash) {
    throw new Error(`Honeycrisp research profile hash mismatch for ${resolvedProfile.profile.id}@${resolvedProfile.profile.version}.`);
  }
  return {
    catalogProtocolVersion: RESEARCH_PROFILE_CATALOG_PROTOCOL_VERSION,
    supportedResearchProfileSchemaVersions: supportedVersions as number[],
    resolvedProfile
  };
}

export function resolveHoneycrispProfileInvocation(options: { defaultRoot?: string } = {}): HoneycrispInvocation {
  const command = process.env.BEALE_HONEYCRISP_PROFILE_COMMAND?.trim();
  if (command) {
    return {
      command,
      prefixArgs: parseEnvironmentArgs('BEALE_HONEYCRISP_PROFILE_ARGS_JSON'),
      cwd: process.env.BEALE_HONEYCRISP_PROFILE_CWD?.trim() || process.cwd(),
      configuredBy: 'env_command',
      usesNodeRuntime: isNodeExecutable(command)
    };
  }

  // Profile resolution deliberately ignores the run-engine command, args,
  // cwd, root, and runtime overrides. Those may be launch-only wrappers or
  // fixtures and are not the trusted CLI that normalizes the profile catalog.
  const configuredProfileRoot = process.env.BEALE_HONEYCRISP_PROFILE_ROOT?.trim();
  const root = configuredProfileRoot
    ? resolve(configuredProfileRoot)
    : resolve(options.defaultRoot ?? resolve(process.cwd(), '..', 'honeycrisp'));
  const cliPath = join(root, 'packages', 'cli', 'dist', 'cli.js');
  if (existsSync(cliPath)) {
    return {
      command: process.env.BEALE_HONEYCRISP_PROFILE_NODE_COMMAND?.trim()
        || process.env.npm_node_execpath?.trim()
        || 'node',
      prefixArgs: [cliPath],
      cwd: root,
      configuredBy: configuredProfileRoot ? 'env_root' : 'sibling_root',
      usesNodeRuntime: true
    };
  }
  if (!existsSync(join(root, 'package.json'))) {
    throw new Error(
      'Canonical Honeycrisp profile resolution is unavailable. Configure BEALE_HONEYCRISP_PROFILE_COMMAND or BEALE_HONEYCRISP_PROFILE_ROOT.'
    );
  }
  return {
    command: process.env.BEALE_HONEYCRISP_PROFILE_PNPM_COMMAND?.trim() || 'pnpm',
    prefixArgs: ['--dir', root, 'start'],
    cwd: root,
    configuredBy: configuredProfileRoot ? 'env_root' : 'sibling_root',
    usesNodeRuntime: false
  };
}

function runResearchProfileCommand(
  command: string,
  args: readonly string[],
  invocation: HoneycrispInvocation
): ResearchProfileCommandResult {
  const result = spawnSync(command, args, {
    cwd: invocation.cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: process.env.NO_COLOR ?? '1' },
    timeout: RESEARCH_PROFILE_RESOLUTION_TIMEOUT_MS,
    maxBuffer: RESEARCH_PROFILE_RESOLUTION_MAX_BYTES,
    windowsHide: true
  });
  return {
    status: result.status,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    ...(result.error ? { error: result.error } : {})
  };
}

function parseJsonCommandOutput(stdout: string): unknown {
  if (Buffer.byteLength(stdout, 'utf8') > RESEARCH_PROFILE_RESOLUTION_MAX_BYTES) {
    throw new Error('Honeycrisp research profile catalog output exceeded the host limit.');
  }
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    // Package runners may write a short command banner before CLI JSON.
  }
  const start = stdout.indexOf('{');
  const end = stdout.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as unknown;
    } catch {
      // Fall through to the bounded error below.
    }
  }
  throw new Error(`Honeycrisp research profile resolution returned non-JSON output: ${redactForModelText(stdout.slice(0, 500))}`);
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}

function parseEnvironmentArgs(name: string): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error(`${name} must be a JSON string array.`);
  }
  return parsed;
}

function isNodeExecutable(path: string): boolean {
  const name = path.split(/[\\/]+/u).at(-1)?.toLowerCase() ?? '';
  return name === 'node' || name === 'node.exe';
}
