import type { ProgramRegistryEntry, ProgramRegistryState, ResearchSessionSummary } from '@shared/types';
import { displaySessionTitle } from '../../shared/sessionTitle';

export function researchSessionsForProgram(registry: ProgramRegistryState, program: ProgramRegistryEntry): ResearchSessionSummary[] {
  return registry.researchSessions.filter((session) => session.programId === program.id || (!session.programId && session.workspacePath === program.workspacePath));
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
