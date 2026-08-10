import { describe, expect, it, vi } from 'vitest';
import type { GeneratedResearchGoalSuggestions, WorkspaceSnapshot } from '@shared/types';
import {
  ResearchGoalSuggestionCache,
  researchGoalSuggestionCacheKey,
  researchGoalSuggestionRevision
} from '../src/renderer/view-models/researchGoalSuggestions';

describe('renderer research goal suggestion cache', () => {
  it('keys suggestions by workspace and active scope while ignoring unrelated snapshot changes', () => {
    const original = snapshot('workspace_one', 'scope_one');
    const sameResearchContext = {
      ...original,
      runs: [{ run: { id: 'run_new' } }]
    } as WorkspaceSnapshot;

    expect(researchGoalSuggestionCacheKey(null)).toBeNull();
    expect(researchGoalSuggestionCacheKey(original)).toBe('workspace_one::scope_one');
    expect(researchGoalSuggestionCacheKey(sameResearchContext)).toBe(researchGoalSuggestionCacheKey(original));
    expect(researchGoalSuggestionCacheKey(snapshot('workspace_two', 'scope_one'))).not.toBe(
      researchGoalSuggestionCacheKey(original)
    );
    expect(researchGoalSuggestionCacheKey(snapshot('workspace_one', 'scope_two'))).not.toBe(
      researchGoalSuggestionCacheKey(original)
    );
  });

  it('advances the research revision only when a session reaches a later terminal state', () => {
    const activeOnly = snapshot('workspace_one', 'scope_one');
    activeOnly.runs = [{ run: { id: 'run_active', endedAt: null } }] as WorkspaceSnapshot['runs'];
    expect(researchGoalSuggestionRevision(activeOnly)).toBe('');

    const completed = snapshot('workspace_one', 'scope_one');
    completed.runs = [
      { run: { id: 'run_old', endedAt: '2026-07-31T10:00:00.000Z' } },
      { run: { id: 'run_active', endedAt: null } },
      { run: { id: 'run_new', endedAt: '2026-08-01T09:00:00.000Z' } }
    ] as WorkspaceSnapshot['runs'];
    expect(researchGoalSuggestionRevision(completed)).toBe('2026-08-01T09:00:00.000Z::run_new');

    completed.runs.push({ run: { id: 'run_still_active', endedAt: null } } as WorkspaceSnapshot['runs'][number]);
    expect(researchGoalSuggestionRevision(completed)).toBe('2026-08-01T09:00:00.000Z::run_new');
  });

  it('deduplicates pending loads and reuses the ready result without calling another loader', async () => {
    const cache = new ResearchGoalSuggestionCache();
    const key = requiredKey(snapshot('workspace_one', 'scope_one'));
    const pending = deferred<GeneratedResearchGoalSuggestions>();
    const firstLoader = vi.fn(() => pending.promise);
    const duplicateLoader = vi.fn(async () => suggestions('duplicate'));

    const first = cache.load(key, firstLoader);
    const duplicate = cache.load(key, duplicateLoader);

    expect(duplicate).toBe(first);
    expect(firstLoader).toHaveBeenCalledTimes(1);
    expect(duplicateLoader).not.toHaveBeenCalled();
    expect(cache.read(key)).toEqual({ status: 'loading', result: null });

    const loaded = suggestions('first');
    pending.resolve(loaded);
    await expect(first).resolves.toBe(loaded);
    expect(cache.read(key)).toEqual({ status: 'ready', result: loaded });

    const readyLoader = vi.fn(async () => suggestions('ready duplicate'));
    const ready = cache.load(key, readyLoader);
    expect(ready).toBe(first);
    await expect(ready).resolves.toBe(loaded);
    expect(readyLoader).not.toHaveBeenCalled();
  });

  it('keeps late results associated with the workspace and scope that started each load', async () => {
    const cache = new ResearchGoalSuggestionCache();
    const firstKey = requiredKey(snapshot('workspace_one', 'scope_one'));
    const secondKey = requiredKey(snapshot('workspace_two', 'scope_two'));
    const firstPending = deferred<GeneratedResearchGoalSuggestions>();
    const secondPending = deferred<GeneratedResearchGoalSuggestions>();

    const firstLoad = cache.load(firstKey, () => firstPending.promise);
    const secondLoad = cache.load(secondKey, () => secondPending.promise);
    const secondResult = suggestions('second');
    secondPending.resolve(secondResult);
    await secondLoad;

    expect(cache.read(secondKey)).toEqual({ status: 'ready', result: secondResult });
    expect(cache.read(firstKey)).toEqual({ status: 'loading', result: null });

    const firstResult = suggestions('first');
    firstPending.resolve(firstResult);
    await firstLoad;

    expect(cache.read(firstKey)).toEqual({ status: 'ready', result: firstResult });
    expect(cache.read(secondKey)).toEqual({ status: 'ready', result: secondResult });
  });

  it('lets a forced retry supersede an older pending result for the same key', async () => {
    const cache = new ResearchGoalSuggestionCache();
    const key = requiredKey(snapshot('workspace_one', 'scope_one'));
    const originalPending = deferred<GeneratedResearchGoalSuggestions>();
    const retryPending = deferred<GeneratedResearchGoalSuggestions>();

    const originalLoad = cache.load(key, () => originalPending.promise);
    const retryLoad = cache.load(key, () => retryPending.promise, { force: true });
    expect(retryLoad).not.toBe(originalLoad);

    const retryResult = suggestions('retry');
    retryPending.resolve(retryResult);
    await retryLoad;
    expect(cache.read(key)).toEqual({ status: 'ready', result: retryResult });

    originalPending.resolve(suggestions('stale'));
    await originalLoad;
    expect(cache.read(key)).toEqual({ status: 'ready', result: retryResult });
  });

  it('removes failed entries so the next load can retry', async () => {
    const cache = new ResearchGoalSuggestionCache();
    const key = requiredKey(snapshot('workspace_one', 'scope_one'));
    const failure = new Error('suggestion generation failed');
    const failingLoader = vi.fn(async () => {
      throw failure;
    });

    await expect(cache.load(key, failingLoader)).rejects.toBe(failure);
    expect(cache.read(key)).toEqual({ status: 'idle', result: null });

    const retryResult = suggestions('recovered');
    const retryLoader = vi.fn(async () => retryResult);
    await expect(cache.load(key, retryLoader)).resolves.toBe(retryResult);
    expect(retryLoader).toHaveBeenCalledTimes(1);
    expect(cache.read(key)).toEqual({ status: 'ready', result: retryResult });
  });
});

function snapshot(workspaceId: string, scopeId: string): WorkspaceSnapshot {
  return {
    workspace: { workspaceId },
    activeScope: { id: scopeId },
    runs: []
  } as unknown as WorkspaceSnapshot;
}

function requiredKey(value: WorkspaceSnapshot): string {
  const key = researchGoalSuggestionCacheKey(value);
  if (!key) throw new Error('Expected a research goal suggestion cache key');
  return key;
}

function suggestions(prefix: string): GeneratedResearchGoalSuggestions {
  return {
    phase: 'discovery',
    suggestions: [1, 2, 3, 4].map((index) => `${prefix} discovery suggestion ${index}.`) as GeneratedResearchGoalSuggestions['suggestions']
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, resolve: resolvePromise, reject: rejectPromise };
}
