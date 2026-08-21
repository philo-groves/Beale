import { describe, expect, it } from 'vitest';
import type { HoneycrispMemoryNodeSummary, HoneycrispMemorySummary, ResearchProfile, RunDetail } from '@shared/types';
import {
  EMPTY_SESSION_HEAT_DISPLAY_STATE,
  readSessionHeatPreferences,
  sessionHeatDisplayStateForSelection,
  sessionHeatForDetail,
  sessionHeatForHoneycrispMemory,
  sessionHeatPaletteForProfile,
  sessionHeatPaletteStyle,
  withSessionHeatPalettePreference,
  withSessionHeatPreference
} from '../src/renderer/view-models/sessionHeat';
import { testResearchProfile } from './researchProfileFixture';

describe('renderer session heat view models', () => {
  it('uses none when no session is selected or no triggering memory exists in the session', () => {
    expect(sessionHeatForDetail(null)).toBe('none');
    expect(sessionHeatForDetail(runDetail())).toBe('none');
    expect(sessionHeatForDetail(runDetail({
      nodes: [memoryNode({ type: 'source', status: 'confirmed' })]
    }))).toBe('none');
  });

  it.each([
    ['sink', 'confirmed', 'low'],
    ['primitive', 'suspected', 'medium'],
    ['primitive', 'confirmed', 'medium'],
    ['chain', 'suspected', 'high'],
    ['chain', 'confirmed', 'critical']
  ] as const)('maps a %s in %s state to %s heat', (type, status, expected) => {
    expect(sessionHeatForDetail(runDetail({ nodes: [memoryNode({ type, status })] }))).toBe(expected);
  });

  it('ignores triggering memories from other sessions', () => {
    const memory = honeycrispMemory([
      memoryNode({ sessionIds: ['run_older'], type: 'chain', status: 'confirmed' }),
      memoryNode({ sessionIds: ['run_current'], type: 'sink', status: 'confirmed' })
    ]);

    expect(sessionHeatForHoneycrispMemory(memory, 'run_current', heatProfile())).toBe('low');
  });

  it('downgrades when a triggering memory is rejected', () => {
    const suspectedChain = memoryNode({ id: 'chain_test', type: 'chain', status: 'suspected' });
    const confirmedPrimitive = memoryNode({ id: 'primitive_test', type: 'primitive', status: 'confirmed' });
    expect(sessionHeatForDetail(runDetail({ nodes: [suspectedChain, confirmedPrimitive] }))).toBe('high');

    const rejectedChain = { ...suspectedChain, status: 'rejected', revision: 2 };
    expect(sessionHeatForDetail(runDetail({ nodes: [rejectedChain, confirmedPrimitive] }))).toBe('medium');
  });

  it('retains the prior heat and palette while the next selected session detail loads', () => {
    const highDetail = runDetail({ nodes: [memoryNode({ type: 'chain', status: 'suspected' })] });
    const highState = sessionHeatDisplayStateForSelection(
      EMPTY_SESSION_HEAT_DISPLAY_STATE,
      'run_current',
      highDetail
    );

    expect(highState.heat).toBe('high');
    expect(sessionHeatDisplayStateForSelection(highState, 'run_next', null)).toBe(highState);

    const lowDetail = {
      ...runDetail({ nodes: [memoryNode({ type: 'sink', status: 'confirmed', sessionIds: ['run_next'] })] }),
      run: { id: 'run_next' }
    } as RunDetail;
    expect(sessionHeatDisplayStateForSelection(highState, 'run_next', lowDetail).heat).toBe('low');
    expect(sessionHeatDisplayStateForSelection(highState, null, null)).toBe(EMPTY_SESSION_HEAT_DISPLAY_STATE);
  });

  it('uses the recorded profile instead of security-specific type semantics', () => {
    const detail = runDetail({ nodes: [memoryNode({ type: 'theorem', status: 'verified' })] }, mathematicsHeatProfile());
    expect(sessionHeatForDetail(detail)).toBe('critical');
  });

  it('applies and removes profile-scoped visual overrides', () => {
    const detail = runDetail({ nodes: [memoryNode({ type: 'primitive', status: 'confirmed' })] });
    const overridden = withSessionHeatPreference({}, 'security-research', 'primitive', 'confirmed', 'critical');
    expect(sessionHeatForDetail(detail, overridden)).toBe('critical');
    expect(sessionHeatForDetail(detail, withSessionHeatPreference(overridden, 'security-research', 'primitive', 'confirmed', null))).toBe('medium');
  });

  it('normalizes stored preferences and exposes profile palette variables', () => {
    const preferences = readSessionHeatPreferences({
      getItem: () => JSON.stringify({ mathematics: { theorem: { verified: 'critical', draft: 'invalid' } } })
    });
    expect(preferences).toEqual({
      heatOverrides: { mathematics: { theorem: { verified: 'critical' } } },
      paletteOverrides: {}
    });
    expect(sessionHeatPaletteStyle(mathematicsHeatProfile().presentation.sessionHeatPalette)).toEqual({
      '--session-heat-low-color': '#45b8d8',
      '--session-heat-medium-color': '#4f87e8',
      '--session-heat-high-color': '#7768e8',
      '--session-heat-critical-color': '#b14ee8'
    });
  });

  it('applies theme-scoped palette overrides while preserving profile defaults', () => {
    const profile = mathematicsHeatProfile();
    const preferences = withSessionHeatPalettePreference(
      { heatOverrides: {}, paletteOverrides: {} },
      'mathematics',
      'light',
      'critical',
      'f0a'
    );

    expect(sessionHeatPaletteForProfile(profile, preferences, 'light')).toEqual({
      low: '#45b8d8',
      medium: '#4f87e8',
      high: '#7768e8',
      critical: '#ff00aa'
    });
    expect(sessionHeatPaletteForProfile(profile, preferences, 'dark')).toEqual(profile.presentation.sessionHeatPalette);
  });

  it('uses Security-specific Light and Dark heat defaults without changing Mathematics palettes', () => {
    const cyberProfile = heatProfile();
    const mathematicsProfile = mathematicsHeatProfile();

    expect(sessionHeatPaletteForProfile(cyberProfile, undefined, 'dark')).toEqual({
      low: '#857300',
      medium: '#612d00',
      high: '#7e1117',
      critical: '#5c0006'
    });
    expect(sessionHeatPaletteForProfile(cyberProfile, undefined, 'light')).toEqual({
      low: '#e6ce7f',
      medium: '#ce9564',
      high: '#d37e83',
      critical: '#d2565e'
    });
    expect(sessionHeatPaletteForProfile(mathematicsProfile, undefined, 'light')).toEqual(mathematicsProfile.presentation.sessionHeatPalette);
    expect(sessionHeatPaletteForProfile(mathematicsProfile, undefined, 'dark')).toEqual(mathematicsProfile.presentation.sessionHeatPalette);
  });

  it('uses warm Cream defaults and stores Cream overrides independently', () => {
    const profile = mathematicsHeatProfile();
    const preferences = withSessionHeatPalettePreference(
      { heatOverrides: {}, paletteOverrides: {} },
      profile.id,
      'cream',
      'high',
      '#9f3d2f'
    );

    expect(sessionHeatPaletteForProfile(profile, undefined, 'cream')).toEqual({
      low: '#dbb061',
      medium: '#d0793e',
      high: '#e66565',
      critical: '#c24747'
    });
    expect(sessionHeatPaletteForProfile(profile, preferences, 'cream').high).toBe('#9f3d2f');
    expect(sessionHeatPaletteForProfile(profile, preferences, 'dark').high).toBe('#7768e8');
  });

  it('uses cool Midnight defaults and stores Midnight overrides independently', () => {
    const profile = mathematicsHeatProfile();
    const preferences = withSessionHeatPalettePreference(
      { heatOverrides: {}, paletteOverrides: {} },
      profile.id,
      'midnight',
      'critical',
      '#bd58b8'
    );

    expect(sessionHeatPaletteForProfile(profile, undefined, 'midnight')).toEqual({
      low: '#657be6',
      medium: '#4b5baa',
      high: '#31296a',
      critical: '#181433'
    });
    expect(sessionHeatPaletteForProfile(profile, preferences, 'midnight').critical).toBe('#bd58b8');
    expect(sessionHeatPaletteForProfile(profile, preferences, 'dark').critical).toBe('#b14ee8');
  });
});

function runDetail(
  input: { nodes?: HoneycrispMemoryNodeSummary[] } = {},
  profile = heatProfile()
): RunDetail {
  return {
    run: { id: 'run_current' },
    honeycrispMemory: honeycrispMemory(input.nodes ?? []),
    researchProfile: { profileId: profile.id, profile }
  } as unknown as RunDetail;
}

function heatProfile(): ResearchProfile {
  const profile = testResearchProfile();
  return {
    ...profile,
    memory: {
      ...profile.memory,
      types: [
        { ...profile.memory.types[0], id: 'source', name: 'Source', pluralName: 'Sources', sessionHeat: {} },
        { ...profile.memory.types[0], id: 'sink', name: 'Sink', pluralName: 'Sinks', sessionHeat: { confirmed: 'low' as const } },
        { ...profile.memory.types[0], id: 'primitive', name: 'Primitive', pluralName: 'Primitives', sessionHeat: { suspected: 'medium' as const, confirmed: 'medium' as const } },
        { ...profile.memory.types[0], id: 'chain', name: 'Chain', pluralName: 'Chains', sessionHeat: { suspected: 'high' as const, confirmed: 'critical' as const } }
      ].map((type) => ({ ...type, allowedStatuses: ['draft', 'suspected', 'confirmed', 'rejected'] }))
    }
  };
}

function mathematicsHeatProfile(): ResearchProfile {
  const profile = testResearchProfile();
  return {
    ...profile,
    id: 'mathematics',
    presentation: {
      ...profile.presentation,
      sessionHeatPalette: { low: '#45b8d8', medium: '#4f87e8', high: '#7768e8', critical: '#b14ee8' }
    },
    memory: {
      ...profile.memory,
      types: [{
        ...profile.memory.types[0],
        id: 'theorem',
        name: 'Theorem',
        pluralName: 'Theorems',
        defaultStatus: 'draft',
        allowedStatuses: ['draft', 'plausible', 'verified'],
        sessionHeat: { plausible: 'high' as const, verified: 'critical' as const }
      }]
    }
  };
}

function honeycrispMemory(nodes: HoneycrispMemoryNodeSummary[]): HoneycrispMemorySummary {
  return {
    status: nodes.length > 0 ? 'ready' : 'empty',
    source: 'honeycrisp_sqlite',
    nodes
  } as HoneycrispMemorySummary;
}

function memoryNode(overrides: Partial<HoneycrispMemoryNodeSummary> = {}): HoneycrispMemoryNodeSummary {
  return {
    id: 'memory_test',
    sessionIds: ['run_current'],
    workspaces: [{ id: 'workspace_zsh', name: 'Zsh' }],
    subjectId: 'subject_apple',
    subjectName: 'Apple',
    type: 'primitive',
    title: 'Memory title',
    summary: 'Memory summary',
    body: '',
    status: 'suspected',
    confidence: 0.8,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-07-21T12:00:00.000Z',
    updatedAt: '2026-07-21T12:00:00.000Z',
    revision: 1,
    ...overrides
  };
}
