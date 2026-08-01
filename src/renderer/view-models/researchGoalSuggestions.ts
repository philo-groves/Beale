import type { GeneratedResearchGoalSuggestions, WorkspaceSnapshot } from '@shared/types';

export type ResearchGoalSuggestionLoader = () => Promise<GeneratedResearchGoalSuggestions>;

export type ResearchGoalSuggestionCacheState =
  | { status: 'idle'; result: null }
  | { status: 'loading'; result: null }
  | { status: 'ready'; result: GeneratedResearchGoalSuggestions };

interface PendingEntry {
  status: 'loading';
  promise: Promise<GeneratedResearchGoalSuggestions>;
}

interface ReadyEntry {
  status: 'ready';
  promise: Promise<GeneratedResearchGoalSuggestions>;
  result: GeneratedResearchGoalSuggestions;
}

type CacheEntry = PendingEntry | ReadyEntry;

const IDLE_STATE: ResearchGoalSuggestionCacheState = { status: 'idle', result: null };

export function researchGoalSuggestionCacheKey(
  snapshot: Pick<WorkspaceSnapshot, 'workspace' | 'activeScope'> | null
): string | null {
  if (!snapshot) return null;
  const workspaceId = snapshot.workspace.workspaceId.trim();
  const scopeId = snapshot.activeScope.id.trim();
  if (!workspaceId || !scopeId) return null;
  return `${encodeURIComponent(workspaceId)}::${encodeURIComponent(scopeId)}`;
}

export function researchGoalSuggestionRevision(
  snapshot: Pick<WorkspaceSnapshot, 'runs'> | null
): string {
  if (!snapshot) return '';
  let latestRunId = '';
  let latestEndedAt = '';
  for (const { run } of snapshot.runs) {
    if (!run.endedAt || run.endedAt < latestEndedAt) continue;
    if (run.endedAt === latestEndedAt && run.id <= latestRunId) continue;
    latestEndedAt = run.endedAt;
    latestRunId = run.id;
  }
  return latestEndedAt ? `${latestEndedAt}::${latestRunId}` : '';
}

export class ResearchGoalSuggestionCache {
  private readonly entries = new Map<string, CacheEntry>();

  public read(key: string | null): ResearchGoalSuggestionCacheState {
    if (!key) return IDLE_STATE;
    const entry = this.entries.get(key);
    if (!entry) return IDLE_STATE;
    return entry.status === 'ready'
      ? { status: 'ready', result: entry.result }
      : { status: 'loading', result: null };
  }

  public load(
    key: string,
    loader: ResearchGoalSuggestionLoader,
    options: { force?: boolean } = {}
  ): Promise<GeneratedResearchGoalSuggestions> {
    const existing = this.entries.get(key);
    if (!options.force && existing) return existing.promise;

    let loaded: Promise<GeneratedResearchGoalSuggestions>;
    try {
      loaded = loader();
    } catch (error) {
      loaded = Promise.reject(error);
    }

    const pending: PendingEntry = {
      status: 'loading',
      promise: Promise.resolve(loaded).then(
        (result) => {
          if (this.entries.get(key) === pending) {
            this.entries.set(key, { status: 'ready', promise: pending.promise, result });
          }
          return result;
        },
        (error: unknown) => {
          if (this.entries.get(key) === pending) this.entries.delete(key);
          throw error;
        }
      )
    };
    this.entries.set(key, pending);
    return pending.promise;
  }

  public invalidate(key: string): void {
    this.entries.delete(key);
  }

  public clear(): void {
    this.entries.clear();
  }
}
