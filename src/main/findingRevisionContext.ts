import { createHash } from 'node:crypto';
import { release } from 'node:os';
import type { WorkspaceScopeVersion } from '@shared/types';

export interface FindingRevisionContext {
  sourceRevision: string;
  environmentFingerprint: string;
  assetIds: string[];
}

const SOURCE_ATTRIBUTE_KEYS = [
  'repositoryUrl', 'ref', 'commit', 'head', 'headRefName', 'headDescribe',
  'requestedRefHead', 'requestedRefMatchesHead', 'version'
] as const;
const ENVIRONMENT_ATTRIBUTE_KEYS = [
  'environment', 'environmentFingerprint', 'targetVersion', 'deviceOs',
  'platform', 'runtime'
] as const;

export function findingRevisionContext(scope: WorkspaceScopeVersion): FindingRevisionContext {
  const assets = scope.assets
    .filter((asset) => asset.direction === 'in_scope')
    .sort((left, right) => left.id.localeCompare(right.id));
  const source = assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    value: asset.value,
    attributes: selectedAttributes(asset.attributes, SOURCE_ATTRIBUTE_KEYS)
  }));
  const environment = {
    host: { platform: process.platform, architecture: process.arch, release: release() },
    targets: assets.map((asset) => ({
      id: asset.id,
      attributes: selectedAttributes(asset.attributes, ENVIRONMENT_ATTRIBUTE_KEYS)
    }))
  };
  return {
    sourceRevision: `source:${digest({ scopeId: scope.id, scopeVersion: scope.version, assets: source })}`,
    environmentFingerprint: `environment:${digest(environment)}`,
    assetIds: assets.map((asset) => asset.id)
  };
}

function selectedAttributes(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[]
): Record<string, unknown> {
  if (!attributes) return {};
  return Object.fromEntries(keys.flatMap((key) => attributes[key] === undefined ? [] : [[key, attributes[key]]]));
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex').slice(0, 32);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
