import type { WorkspaceRegistryEntry, WorkspaceRegistryState, ResearchSessionSummary } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';

export function researchSessionsForWorkspace(registry: WorkspaceRegistryState, workspace: WorkspaceRegistryEntry): ResearchSessionSummary[] {
  return registry.researchSessions.filter((session) => session.registryWorkspaceId === workspace.id);
}

export function workspaceById(registry: WorkspaceRegistryState | null, registryWorkspaceId: string | null): WorkspaceRegistryEntry | null {
  if (!registry || !registryWorkspaceId) return null;
  return registry.workspaces.find((workspace) => workspace.id === registryWorkspaceId) ?? null;
}

export function workspaceExists(registry: WorkspaceRegistryState | null, registryWorkspaceId: string | null): boolean {
  return Boolean(workspaceById(registry, registryWorkspaceId));
}

export function promptSessionTitle(session: ResearchSessionSummary): string {
  return displaySessionTitle(session.title, session.promptMarkdown);
}

export function shortRelativeAge(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}D`;
  return `${Math.max(1, Math.floor(days / 7))}W`;
}
