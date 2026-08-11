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
      onSelect: () => undefined,
      onRetry: () => undefined
    }));

    expect(defaultResearchWorkflowId(workflows)).toBe('survey');
    expect(html).toContain('>Survey</h4>');
    expect(html).toContain('>Synthesize</h4>');
    expect(html).not.toContain('Discovery');
    expect(html.match(/research-goal-choice-loading/g)).toHaveLength(12);
    expect(html).toContain('<option value="survey" selected="">Survey</option>');
    expect(html).toContain('<option value="synthesize">Synthesize</option>');
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
    expect(html).toContain('Study Settings');
    expect(html).toContain('Choose the workflow that matches the next research outcome.');
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

  it('uses profile type names, groups, colors, status labels, and readable fallbacks', () => {
    const profile = customProfile();
    const nodes = [
      node('published_note', 'note', 'published'),
      node('draft_note', 'note', 'draft'),
      node('retired', 'retired_note', 'draft'),
      node('unknown', 'old_observation', 'draft')
    ];

    expect(orderedCatalogMemoryTypes(nodes, profile.memory.types)).toEqual([
      { id: 'retired_note', label: 'Archived Note', group: 'Archive', color: '#778899' },
      { id: 'note', label: 'Note', group: 'Knowledge', color: '#123456' },
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
    expect(retiredHtml).toContain('style="--memory-type-color:#778899"');
    expect(retiredHtml).toContain('>Archived Note</span>');

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

  it('keeps memory and runbook labels canonical while retaining the profile session label', () => {
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
      selectedTraceEventId: null,
      searchHighlightQuery: '',
      visibleTraceCategories: [],
      onOpenRunbook: () => undefined,
      onSelectSubagent: () => undefined,
      onBackToRunbooks: () => undefined,
      onBackToSubagents: () => undefined,
      onSelectTraceEvent: () => undefined
    }));
    expect(html).toContain('aria-label="Study summary"');
    expect(html).toContain('>Study</h2>');
    expect(html).toContain('0 Memories');
    expect(html).toContain('0 Runbooks');
    expect(html).not.toContain('0 Notes');
    expect(html).not.toContain('0 Guides');
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
          allowedStatuses: ['draft', 'published']
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
    activeScope: { id: 'scope_one', networkProfile: 'disabled' },
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
