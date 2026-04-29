import { existsSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';
import type { RunRecord, ScopeAsset } from '@shared/types';

const LOCAL_ASSET_KINDS: ReadonlySet<ScopeAsset['kind']> = new Set(['path', 'repo', 'binary', 'documentation', 'other']);
const GENERIC_ALIASES: ReadonlySet<string> = new Set(['asset', 'assets', 'code', 'edit', 'github', 'primary', 'repo', 'scope', 'scopes', 'source', 'target']);

export interface RunTargetSelectionInput {
  title: string;
  promptMarkdown: string;
  targetAssetId?: string | null;
  targetPath?: string | null;
}

export interface RunTargetSelection {
  targetAssetId: string | null;
  targetPath: string | null;
  score: number;
  reason: string;
}

export function selectRunTarget(assets: ScopeAsset[], input: RunTargetSelectionInput): RunTargetSelection {
  const explicitAsset = input.targetAssetId ? assets.find((asset) => asset.id === input.targetAssetId) ?? null : null;
  if (explicitAsset) {
    return {
      targetAssetId: explicitAsset.id,
      targetPath: scopedLocalPath(explicitAsset),
      score: Number.POSITIVE_INFINITY,
      reason: 'explicit_asset'
    };
  }

  const explicitPath = input.targetPath ? resolve(input.targetPath) : null;
  if (explicitPath) {
    const explicitPathAsset = assets.find((asset) => scopedLocalPath(asset) === explicitPath) ?? null;
    return {
      targetAssetId: explicitPathAsset?.id ?? null,
      targetPath: explicitPathAsset ? explicitPath : null,
      score: Number.POSITIVE_INFINITY,
      reason: explicitPathAsset ? 'explicit_path_asset' : 'explicit_path_not_scoped'
    };
  }

  const scored = assets
    .map((asset) => ({ asset, score: scoreTargetAsset(asset, input) }))
    .sort((left, right) => right.score - left.score);
  const best = scored[0];
  if (best && best.score > 0) {
    return {
      targetAssetId: best.asset.id,
      targetPath: scopedLocalPath(best.asset),
      score: best.score,
      reason: 'prompt_match'
    };
  }

  const localAssets = assets.filter((asset) => scopedLocalPath(asset));
  if (localAssets.length === 1) {
    return {
      targetAssetId: localAssets[0].id,
      targetPath: scopedLocalPath(localAssets[0]),
      score: 1,
      reason: 'only_local_asset'
    };
  }

  return { targetAssetId: null, targetPath: null, score: 0, reason: 'no_target_selected' };
}

export function localRunTargetPath(assets: ScopeAsset[], run: Pick<RunRecord, 'targetAssetId' | 'targetPath' | 'title' | 'promptMarkdown'>): string | null {
  if (run.targetPath && isScopedLocalPath(run.targetPath, assets)) return resolve(run.targetPath);

  if (run.targetAssetId) {
    const asset = assets.find((candidate) => candidate.id === run.targetAssetId || candidate.attributes?.sourceAssetId === run.targetAssetId) ?? null;
    const path = asset ? scopedLocalPath(asset) : null;
    if (path) return path;
  }

  const selected = selectRunTarget(assets, run);
  return selected.targetPath;
}

export function scopedLocalPath(asset: ScopeAsset): string | null {
  if (!isScopedLocalAsset(asset)) return null;
  return resolve(asset.value);
}

function isScopedLocalPath(path: string, assets: ScopeAsset[]): boolean {
  const resolved = resolve(path);
  return assets.some((asset) => scopedLocalPath(asset) === resolved);
}

function scoreTargetAsset(asset: ScopeAsset, input: RunTargetSelectionInput): number {
  const title = input.title.toLowerCase();
  const haystack = `${input.title}\n${input.promptMarkdown}`.toLowerCase();
  const normalizedHaystack = normalizeMatchText(haystack);
  const normalizedTitle = normalizeMatchText(title);
  let score = 0;
  for (const alias of targetAliases(asset)) {
    const aliasScore = scoreAliasMatch(alias, haystack, normalizedHaystack, normalizedTitle);
    score = Math.max(score, aliasScore);
  }
  return score;
}

function targetAliases(asset: ScopeAsset): string[] {
  const aliases = new Set<string>();
  aliases.add(asset.value);
  aliases.add(wildcardStrippedValue(asset.value));
  if (isScopedLocalAsset(asset)) aliases.add(basename(asset.value));
  if (isAbsolute(asset.value)) aliases.add(resolve(asset.value));
  if (looksLikeUrl(asset.value)) aliases.add(repositoryNameFromUrl(asset.value));
  addStringAttributeAlias(aliases, asset.attributes?.displayName);
  addStringAttributeAlias(aliases, asset.attributes?.repositoryUrl);
  addStringAttributeAlias(aliases, asset.attributes?.sourcePath);
  addStringAttributeAlias(aliases, asset.attributes?.localPath);
  if (asset.kind === 'repo') {
    addRepositoryNameAlias(aliases, asset.value);
    addRepositoryNameAlias(aliases, stringAttribute(asset.attributes?.repositoryUrl));
  }
  if (isScopedLocalAsset(asset) || asset.kind === 'repo') {
    for (const part of basename(asset.value).split(/[^A-Za-z0-9]+/)) {
      if (part.length >= 4 && !GENERIC_ALIASES.has(part.toLowerCase())) aliases.add(part);
    }
  }
  return [...aliases].filter(Boolean);
}

function scoreAliasMatch(alias: string, haystack: string, normalizedHaystack: string, normalizedTitle: string): number {
  const trimmed = alias.trim();
  if (!trimmed) return 0;
  const lowerAlias = trimmed.toLowerCase();
  const normalizedAlias = normalizeMatchText(trimmed);
  if (normalizedAlias.length < 4 || GENERIC_ALIASES.has(normalizedAlias)) return 0;
  let score = 0;
  if (lowerAlias.length >= 8 && haystack.includes(lowerAlias)) score = Math.max(score, 1600 + Math.min(lowerAlias.length, 300));
  if (normalizedAlias.length >= 4 && phraseIncludes(normalizedTitle, normalizedAlias)) score = Math.max(score, 2200 + Math.min(normalizedAlias.length, 300));
  if (normalizedAlias.length >= 4 && phraseIncludes(normalizedHaystack, normalizedAlias)) score = Math.max(score, 800 + Math.min(normalizedAlias.length, 300));
  return score;
}

function phraseIncludes(normalizedHaystack: string, normalizedAlias: string): boolean {
  return ` ${normalizedHaystack} `.includes(` ${normalizedAlias} `);
}

function wildcardStrippedValue(value: string): string {
  return value.replace(/^\*\./, '');
}

function addStringAttributeAlias(aliases: Set<string>, value: unknown): void {
  if (typeof value !== 'string' || !value.trim()) return;
  aliases.add(value);
  addRepositoryNameAlias(aliases, value);
}

function addRepositoryNameAlias(aliases: Set<string>, value: string): void {
  if (!looksLikeUrl(value)) return;
  const name = repositoryNameFromUrl(value);
  if (name && !GENERIC_ALIASES.has(name.toLowerCase())) aliases.add(name);
}

function isScopedLocalAsset(asset: ScopeAsset): boolean {
  return asset.direction === 'in_scope' && LOCAL_ASSET_KINDS.has(asset.kind) && isAbsolute(asset.value) && existsSync(asset.value) && !looksLikeUrl(asset.value);
}

function repositoryNameFromUrl(value: string): string {
  const trimmed = value.replace(/\.git$/i, '').replace(/\/+$/g, '');
  return trimmed.split('/').at(-1) ?? trimmed;
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value);
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
