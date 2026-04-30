import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProgramRegistryEntry, ProgramRegistryState, ResearchSessionSummary } from '@shared/types';
import { promptSessionTitle, researchSessionsForProgram, shortRelativeAge } from '../src/renderer/view-models/programDisplay';

describe('renderer program display view models', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps sessions with their fixed program by id and legacy workspace path', () => {
    const first = program('program_first', '/workspace/first');
    const second = program('program_second', '/workspace/second');
    const firstSession = session({ id: 'session_first', programId: first.id, workspacePath: '/workspace/renamed' });
    const legacyFirstSession = session({ id: 'session_legacy_first', programId: null, workspacePath: first.workspacePath });
    const secondSession = session({ id: 'session_second', programId: second.id, workspacePath: second.workspacePath });
    const registry: ProgramRegistryState = {
      registryPath: '/home/user/.beale/programs.json',
      vmPreference: { enabled: false, backendKind: null, updatedAt: null },
      programs: [first, second],
      researchSessions: [firstSession, legacyFirstSession, secondSession]
    };

    expect(researchSessionsForProgram(registry, first).map((item) => item.id)).toEqual(['session_first', 'session_legacy_first']);
    expect(researchSessionsForProgram(registry, second).map((item) => item.id)).toEqual(['session_second']);
  });

  it('formats session titles and compact relative ages for sidebar rows', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-30T12:00:00.000Z'));

    expect(promptSessionTitle(session({ title: 'Android Deep Link Auth Bypass', promptMarkdown: 'Audit Android links.' }))).toBe('Android Deep Link Auth Bypass');
    expect(shortRelativeAge('2026-04-30T10:00:00.000Z')).toBe('2H');
    expect(shortRelativeAge('2026-04-22T12:00:00.000Z')).toBe('1W');
  });
});

function program(id: string, workspacePath: string): ProgramRegistryEntry {
  return {
    id,
    workspacePath,
    workspaceId: id.replace('program_', 'workspace_'),
    programName: id,
    organizationName: '',
    descriptionMarkdown: '',
    rulesMarkdown: '',
    networkProfile: 'scoped',
    expiresAt: null,
    createdAt: '2026-04-30T00:00:00.000Z',
    updatedAt: '2026-04-30T00:00:00.000Z',
    lastOpenedAt: null,
    runCount: 0,
    lastRunAt: null
  };
}

function session(input: Partial<ResearchSessionSummary>): ResearchSessionSummary {
  return {
    id: 'session_test',
    programId: 'program_test',
    workspacePath: '/workspace/test',
    workspaceId: 'workspace_test',
    runId: 'run_test',
    title: '',
    status: 'completed',
    runEngine: 'openai_responses',
    mode: 'dynamic',
    promptMarkdown: '',
    summary: '',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    networkProfile: 'scoped',
    sandboxProfile: 'host_research_only',
    createdAt: '2026-04-30T00:00:00.000Z',
    startedAt: '2026-04-30T00:00:00.000Z',
    endedAt: '2026-04-30T01:00:00.000Z',
    updatedAt: '2026-04-30T01:00:00.000Z',
    ...input
  };
}
