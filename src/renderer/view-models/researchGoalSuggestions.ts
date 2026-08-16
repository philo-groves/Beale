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

interface RefreshingEntry {
  status: 'refreshing';
  promise: Promise<GeneratedResearchGoalSuggestions>;
  result: GeneratedResearchGoalSuggestions;
}

type CacheEntry = PendingEntry | ReadyEntry | RefreshingEntry;

const IDLE_STATE: ResearchGoalSuggestionCacheState = { status: 'idle', result: null };

export function researchGoalSuggestionCacheKey(
  snapshot: Pick<WorkspaceSnapshot, 'workspace' | 'activeScope'> & Partial<Pick<WorkspaceSnapshot, 'researchProfile'>> | null
): string | null {
  if (!snapshot) return null;
  const workspaceId = snapshot.workspace.workspaceId.trim();
  const scopeId = snapshot.activeScope.id.trim();
  if (!workspaceId || !scopeId) return null;
  const profileHash = snapshot.researchProfile?.profileHash.trim();
  const profile = snapshot.researchProfile?.profile;
  const profileCacheParts = profileHash && profile
    ? [
        snapshot.researchProfile?.profileId ?? profile.id,
        profileHash,
        profile.workflows.map((workflow) => `${workflow.id}:${workflow.goalSuggestionCount}`).join(','),
        profile.workspace.workspaceNoun,
        profile.workspace.subjectNoun,
        profile.workspace.boundaryNoun,
        profile.presentation.newResearchLabel,
        profile.presentation.memoryLabel,
        profile.presentation.runbookLabel,
        profile.presentation.sessionLabel
      ]
    : [];
  return [workspaceId, scopeId, ...profileCacheParts]
    .map((part) => encodeURIComponent(part))
    .join('::');
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
  private readonly hiddenSuggestions = new Map<string, Set<string>>();

  public read(key: string | null): ResearchGoalSuggestionCacheState {
    if (!key) return IDLE_STATE;
    const entry = this.entries.get(key);
    if (!entry) return IDLE_STATE;
    return entry.status === 'ready' || entry.status === 'refreshing'
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

    const previousReady = existing?.status === 'ready' || existing?.status === 'refreshing'
      ? existing.result
      : null;
    const pending: PendingEntry | RefreshingEntry = {
      ...(previousReady
        ? { status: 'refreshing' as const, result: previousReady }
        : { status: 'loading' as const }),
      promise: Promise.resolve(loaded).then(
        (result) => {
          const visibleResult = this.visibleResult(key, result);
          if (this.entries.get(key) === pending) {
            this.entries.set(key, { status: 'ready', promise: pending.promise, result: visibleResult });
          }
          return visibleResult;
        },
        (error: unknown) => {
          if (this.entries.get(key) === pending) {
            if (previousReady) {
              this.entries.set(key, {
                status: 'ready',
                promise: Promise.resolve(previousReady),
                result: previousReady
              });
            }
            else this.entries.delete(key);
          }
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

  public consume(key: string, suggestion: string): number | null {
    const identity = suggestionIdentity(suggestion);
    if (!identity) return null;
    const hidden = this.hiddenSuggestions.get(key) ?? new Set<string>();
    hidden.add(identity);
    this.hiddenSuggestions.set(key, hidden);
    const entry = this.entries.get(key);
    if (!entry || entry.status === 'loading') return null;
    const result = this.visibleResult(key, entry.result);
    entry.result = result;
    if (entry.status === 'ready') entry.promise = Promise.resolve(result);
    return result.suggestions.length;
  }

  public clear(): void {
    this.entries.clear();
    this.hiddenSuggestions.clear();
  }

  private visibleResult(key: string, result: GeneratedResearchGoalSuggestions): GeneratedResearchGoalSuggestions {
    const hidden = this.hiddenSuggestions.get(key);
    if (!hidden?.size) return result;
    const suggestions = result.suggestions.filter((suggestion) => !hidden.has(suggestionIdentity(suggestion)));
    return suggestions.length === result.suggestions.length ? result : { ...result, suggestions };
  }
}

function suggestionIdentity(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}
