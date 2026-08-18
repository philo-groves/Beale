import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  HoneycrispMemoryNodeSummary,
  ResearchProfile,
  ResearchProfileWorkflow,
  WorkspaceSnapshot
} from '@shared/types';
import { MemoryTypeLabel } from '../src/renderer/features/research/MemoryTypeLabel';
import {
  orderedCatalogMemoryTypes,
  ResearchSidePanel
} from '../src/renderer/features/research/MemorySidePanel';
import {
  defaultResearchWorkflowId,
  ResearchGoalChooser,
  StartRunForm
} from '../src/renderer/features/sessions/StartRunForm';
import { ProfileSettingsView } from '../src/renderer/features/settings/SettingsModal';
import {
  memoryCatalogStatusSections,
  sessionMemoryTypeSummaries
} from '../src/renderer/view-models/memoryCatalog';
import { researchGoalSuggestionCacheKey } from '../src/renderer/view-models/researchGoalSuggestions';
import { testResearchProfile } from './researchProfileFixture';

describe('renderer research profile presentation', () => {
  it('renders arbitrary workflows and bounded profile-sized loading states', () => {
    const workflows: ResearchProfileWorkflow[] = [
      workflow('survey', 'Survey', 2, true),
      workflow('synthesize', 'Synthesize', 20)
    ];
    const html = renderToStaticMarkup(createElement(ResearchGoalChooser, {
      workflows,
      suggestions: {
        survey: ['Map the corpus.', 'Identify missing sources.'],
        synthesize: ['Compare the strongest explanations.']
      },
      loading: { survey: false, synthesize: true },
      errors: { survey: null, synthesize: null },
      selectedWorkflowId: 'synthesize',
      onSelect: () => undefined,
      onRetry: () => undefined
    }));

    expect(defaultResearchWorkflowId(workflows)).toBe('survey');
    expect(html).toContain('>Survey</button>');
    expect(html).toContain('>Synthesize</button>');
    expect(html).toContain('Synthesize the available material.');
    expect(html).not.toContain('Synthesize suggestions');
    expect(html).not.toContain('Survey suggestions');
    expect(html).toContain('research-goal-choice-scroll');
    expect(html).not.toContain('Map the corpus.');
    expect(html).not.toContain('Discovery');
    expect(html.match(/research-goal-choice-loading/g)).toHaveLength(12);
  });

  it('uses presentation labels and the default workflow in the start surface', () => {
    const profile = customProfile();
    const html = renderToStaticMarkup(createElement(StartRunForm, {
      snapshot: snapshot(profile),
      openAiStatus: null,
      defaultProviderId: 'openai-codex',
      providerModelDefaults: {},
      researchProviderStatuses: [],
      providerModelCatalog: [],
      researchGoalSuggestions: { survey: ['Map the corpus.'], synthesize: [] },
      researchGoalSuggestionsLoading: { survey: false, synthesize: false },
      researchGoalSuggestionErrors: { survey: null, synthesize: null },
      busy: false,
      runAction: async () => undefined,
      onCancel: () => undefined,
      onRetryResearchGoalSuggestions: () => undefined,
      onStarted: () => undefined
    }));

    expect(html).toContain('aria-label="Close New Inquiry"');
    expect(html).not.toContain('Study Settings');
    expect(html).not.toContain('>Minutes<');
    expect(html).toContain('aria-label="Research workflow"');
    expect(html).toContain('>Survey</span>');
    expect(html).toContain('>Start</button>');
  });

  it('orders exact profile statuses and retains unknown stored values', () => {
    const memory = customProfile().memory;
    const sections = memoryCatalogStatusSections([
      node('published', 'note', 'published'),
      node('draft', 'note', 'draft'),
      node('historical', 'retired_note', 'historical_state')
    ], memory.statuses);

    expect(sections.map((section) => [section.id, section.label, section.nodes.map((entry) => entry.id)])).toEqual([
      ['draft', 'Working', ['draft']],
      ['published', 'Published', ['published']],
      ['historical_state', 'Unknown status (Historical state)', ['historical']]
    ]);
  });

  it('uses profile type names, groups, heat colors, status labels, and readable fallbacks', () => {
    const profile = customProfile();
    const nodes = [
      node('published_note', 'note', 'published'),
      node('draft_note', 'note', 'draft'),
      node('retired', 'retired_note', 'draft'),
      node('unknown', 'old_observation', 'draft')
    ];

    expect(orderedCatalogMemoryTypes(nodes, profile.memory.types)).toEqual([
      { id: 'retired_note', label: 'Archived Note', group: 'Archive' },
      { id: 'note', label: 'Note', group: 'Knowledge' },
      { id: 'old_observation', label: 'Unknown type (Old observation)' }
    ]);
    expect(sessionMemoryTypeSummaries(nodes, profile.memory).map((summary) => ({
      type: summary.type,
      countLabel: summary.countLabel,
      statusLabel: summary.statusLabel
    }))).toEqual([
      { type: 'retired_note', countLabel: '1 Archived Note', statusLabel: '1 Working' },
      { type: 'note', countLabel: '2 Notes', statusLabel: '1 Working, 1 Published' },
      { type: 'old_observation', countLabel: '1 Unknown type (Old observation)', statusLabel: '1 Working' }
    ]);

    const retiredHtml = renderToStaticMarkup(createElement(MemoryTypeLabel, {
      type: 'retired_note',
      definitions: profile.memory.types
    }));
    expect(retiredHtml).toContain('data-memory-type-lifecycle="retired"');
    expect(retiredHtml).not.toContain('--memory-type-color');
    expect(retiredHtml).toContain('>Archived Note</span>');

    const draftHtml = renderToStaticMarkup(createElement(MemoryTypeLabel, {
      type: 'note',
      definitions: profile.memory.types,
      status: 'draft'
    }));
    expect(draftHtml).not.toContain('data-memory-heat');
    expect(draftHtml).not.toContain('--memory-type-color');

    const publishedHtml = renderToStaticMarkup(createElement(MemoryTypeLabel, {
      type: 'note',
      definitions: profile.memory.types,
      status: 'published'
    }));
    expect(publishedHtml).toContain('data-memory-heat="high"');
    expect(publishedHtml).toContain('style="--memory-type-color:var(--session-heat-high-color)"');

    const overriddenHtml = renderToStaticMarkup(createElement(MemoryTypeLabel, {
      type: 'note',
      definitions: profile.memory.types,
      status: 'published',
      profileId: profile.id,
      sessionHeatPreferences: {
        heatOverrides: { [profile.id]: { note: { published: 'critical' } } },
        paletteOverrides: {}
      }
    }));
    expect(overriddenHtml).toContain('data-memory-heat="critical"');
    expect(overriddenHtml).toContain('style="--memory-type-color:var(--session-heat-critical-color)"');

    const unknownHtml = renderToStaticMarkup(createElement(MemoryTypeLabel, {
      type: 'old_observation',
      definitions: profile.memory.types
    }));
    expect(unknownHtml).toContain('Unknown type (Old observation)');
  });

  it('includes profile workflow and vocabulary identity in suggestion cache keys', () => {
    const first = snapshot(customProfile());
    const second = snapshot({
      ...customProfile(),
      presentation: { ...customProfile().presentation, sessionLabel: 'Expedition' }
    });
    second.researchProfile.profileHash = first.researchProfile.profileHash;

    expect(researchGoalSuggestionCacheKey(first)).not.toBe(researchGoalSuggestionCacheKey(second));
    expect(researchGoalSuggestionCacheKey(first)).toContain('survey%3A2%2Csynthesize%3A3');
  });

  it('keeps sidenav resource and session labels canonical', () => {
    const profile = customProfile();
    const html = renderToStaticMarkup(createElement(ResearchSidePanel, {
      detail: null,
      events: [],
      memory: { nodes: [], runbooks: [], edges: [], contextWorkspaceId: 'w', contextSubjectId: 's' } as never,
      researchProfile: profile,
      providerModelCatalog: [],
      runId: 'run_one',
      runStatus: null,
      selectedRunbook: null,
      selectedRunbookDocument: null,
      runbookLoading: false,
      runbookError: null,
      selectedSubagentPath: null,
      selectedRunbookId: null,
      searchHighlightQuery: '',
      onOpenRunbook: () => undefined,
      onSelectSubagent: () => undefined,
      onBackToRunbooks: () => undefined,
      onBackToSubagents: () => undefined,
    }));
    expect(html).toContain('aria-label="Session summary"');
    expect(html).toContain('>Session</h2>');
    expect(html).not.toContain('Study summary');
    expect(html).toContain('0 Memories');
    expect(html).not.toContain('0 Runbooks');
    expect(html).not.toContain('0 Notes');
    expect(html).not.toContain('0 Guides');
  });

  it('renders the dark session heat variant by default with a light and dark toggle', () => {
    const profile = customProfile();
    const html = renderToStaticMarkup(createElement(ProfileSettingsView, {
      researchProfile: snapshot(profile).researchProfile,
      researchProfiles: [{ profile, hash: 'a'.repeat(64), source: 'explicit' }],
      sessionHeatPreferences: {
        heatOverrides: {},
        paletteOverrides: {
          [profile.id]: {
            light: { low: '#112233' },
            dark: { critical: '#445566' }
          }
        }
      },
      onSetSessionHeatPreference: () => undefined,
      onSetSessionHeatPalettePreference: () => undefined
    }));

    expect(html).toContain('<h2 id="profile-heat-heading">Heat Palette</h2>');
    expect(html).toContain('role="group" aria-label="Heat variant"');
    expect(html).toContain('aria-pressed="false">Light</button>');
    expect(html).toContain('class="active" type="button" aria-pressed="true">Dark</button>');
    expect(html).not.toContain('aria-label="Reset Light Heat colors"');
    expect(html).toContain('aria-label="Reset Dark Heat colors"');
    expect(html.indexOf('aria-label="Reset Dark Heat colors"')).toBeLessThan(
      html.indexOf('role="group" aria-label="Heat variant"')
    );
    expect(html).not.toContain('aria-label="Light Heat Low session heat color"');
    expect(html).not.toContain('value="#112233"');
    expect(html).toContain('aria-label="Dark Heat Critical session heat color"');
    expect(html).toContain('value="#445566"');
    expect(html).toContain('A subtle signal for sessions with light activity.');
    expect(html).toContain('The strongest signal for sessions with exceptional activity.');
    expect(html).toContain('>Note</span>');
    expect(html).not.toContain('>Archived Note</span>');
  });
});

function customProfile(): ResearchProfile {
  const base = testResearchProfile();
  return {
    ...base,
    memory: {
      ...base.memory,
      types: [
        {
          id: 'note',
          name: 'Note',
          pluralName: 'Notes',
          description: 'A durable note.',
          lifecycle: 'active',
          creatable: true,
          group: 'Knowledge',
          color: '#123456',
          order: 20,
          defaultStatus: 'draft',
          allowedStatuses: ['draft', 'published'],
          sessionHeat: { published: 'high' }
        },
        {
          id: 'retired_note',
          name: 'Archived Note',
          pluralName: 'Archived Notes',
          description: 'A historical note type.',
          lifecycle: 'retired',
          creatable: false,
          group: 'Archive',
          color: '#778899',
          order: 10,
          defaultStatus: 'draft',
          allowedStatuses: ['draft']
        }
      ],
      statuses: [
        { id: 'published', name: 'Published', description: 'Ready to share.', order: 20, terminal: true, polarity: 'positive' },
        { id: 'draft', name: 'Working', description: 'Still developing.', order: 10, polarity: 'neutral' }
      ]
    },
    workflows: [workflow('survey', 'Survey', 2, true), workflow('synthesize', 'Synthesize', 3)],
    presentation: {
      newResearchLabel: 'New Inquiry',
      memoryLabel: 'Note',
      runbookLabel: 'Guides',
      sessionLabel: 'Study'
    }
  };
}

function workflow(id: string, name: string, goalSuggestionCount: number, isDefault = false): ResearchProfileWorkflow {
  return {
    id,
    name,
    description: `${name} the available material.`,
    goalSuggestionCount,
    goalSuggestionInstructions: [],
    promptInstructions: [],
    outputRequirements: [],
    ...(isDefault ? { default: true } : {})
  };
}

function snapshot(profile: ResearchProfile): WorkspaceSnapshot {
  return {
    workspace: { workspaceId: 'workspace_one' },
    activeScope: { id: 'scope_one' },
    researchProfile: {
      id: 'snapshot_one',
      workspaceId: 'workspace_one',
      profileId: profile.id,
      profileVersion: profile.version,
      profileHash: 'a'.repeat(64),
      source: 'explicit',
      sourcePath: '.honeycrisp/profile.json',
      profile,
      active: true,
      createdAt: '2026-08-10T00:00:00.000Z'
    }
  } as WorkspaceSnapshot;
}

function node(id: string, type: string, status: string): HoneycrispMemoryNodeSummary {
  return {
    id,
    sessionIds: ['run_one'],
    workspaces: [{ id: 'workspace_one', name: 'Workspace' }],
    subjectId: 'subject_one',
    subjectName: 'Subject',
    type,
    title: id,
    summary: '',
    body: '',
    status,
    confidence: 0.5,
    assetIds: [],
    tags: [],
    attributes: {},
    evidenceRefs: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    updatedAt: '2026-08-10T00:00:00.000Z',
    revision: 1
  };
}
