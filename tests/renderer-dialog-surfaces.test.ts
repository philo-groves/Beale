import { createElement } from 'react';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HoneycrispMemoryNodeSummary, ResearchCollaborationProviderPreference, ResearchGoalSuggestionsByPhase, RunDetail, TraceEventRecord, WorkspaceSnapshot } from '@shared/types';
import { BottomSheet, Modal } from '../src/renderer/app/Modal';
import { MemoryDetailView } from '../src/renderer/features/research/MemorySidePanel';
import { expandedDeviceCapturePanelWidth, isIosDeviceOs, latestOverallRunbookExecution, sessionContentAvailable, shouldShowSessionNextSteps } from '../src/renderer/features/sessions/MainSessionWorkspace';
import { enableCollaboratorAtTop, newResearchPromptPlaceholder, ResearchGoalChooser, StartRunForm } from '../src/renderer/features/sessions/StartRunForm';
import { SessionNextSteps, SessionNextStepsWidget } from '../src/renderer/features/sessions/SessionNextSteps';
import { WorkspaceCreationView } from '../src/renderer/features/workspaces/WorkspaceCreationView';
import { INSET_SCROLLBAR_SELECTOR } from '../src/renderer/hooks/useInsetScrollbarActivation';
import { applyResearchKit, emptyWorkspaceOnboardingForm, onboardingFormFromDefaults } from '../src/renderer/view-models/workspaceOnboarding';

describe('renderer dialog surfaces', () => {
  it('sizes expanded device capture from the available height instead of half the workspace', () => {
    expect(expandedDeviceCapturePanelWidth(1440, 900, 1290 / 2796)).toBe(423);
    expect(expandedDeviceCapturePanelWidth(1000, 900, 2)).toBe(634);
    expect(expandedDeviceCapturePanelWidth(0, 900, 1290 / 2796)).toBe(0);
  });

  it('recognizes iOS proof-run lifecycle events for connected-device presentation', () => {
    const event = {
      payload: {
        eventType: 'runbook_execution',
        runbookRunId: 'runbook-run-1',
        cellId: null,
        status: 'running',
        proofTarget: 'device',
        deviceOs: 'iOS 27.0'
      }
    } as unknown as TraceEventRecord;

    expect(latestOverallRunbookExecution([event])).toEqual({
      runId: 'runbook-run-1',
      status: 'running',
      proofTarget: 'device',
      deviceOs: 'iOS 27.0'
    });
    expect(isIosDeviceOs('iOS 27.0')).toBe(true);
    expect(isIosDeviceOs('Android 18')).toBe(false);
  });

  it('renders the reusable bottom-sheet presentation with shared dialog semantics', () => {
    const html = renderToStaticMarkup(
      createElement(
        BottomSheet,
        {
          title: 'Session Summary',
          onClose: () => undefined,
          wide: true,
          children: createElement('p', null, 'Summary content')
        }
      )
    );

    expect(html).toContain('class="modal-backdrop bottom-sheet-backdrop"');
    expect(html).toContain('class="modal-panel bottom-sheet-panel wide-modal"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toMatch(/aria-labelledby="([^"]+)"/);
    expect(html).toContain('aria-label="Close Session Summary"');
    expect(html).not.toContain('class="modal-footer"');
  });

  it('keeps centered modals on the standard presentation', () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          title: 'Search',
          footer: createElement('button', null, 'Done'),
          onClose: () => undefined,
          children: createElement('p', null, 'Search content')
        }
      )
    );

    expect(html).toContain('class="modal-backdrop"');
    expect(html).toContain('class="modal-panel"');
    expect(html).not.toContain('bottom-sheet');
  });

  it('renders workspace creation as sequential workspace views instead of a dialog', () => {
    const form = onboardingFormFromDefaults({
      workspacePath: '/math/erdos-straus',
      workspaceName: 'Erdos-Straus Conjecture',
      scopeOwner: '',
      descriptionMarkdown: '',
      rules: [],
      expiresAt: null,
      assets: []
    });
    const render = (researchProfileId: 'security-research' | 'mathematics'): string => renderToStaticMarkup(
      createElement(WorkspaceCreationView, {
        form: { ...form, researchProfileId },
        busy: false,
        progress: null,
        onChange: () => undefined,
        onCancel: () => undefined,
        onLookupHackerOne: async () => undefined,
        onResearchKit: () => undefined,
        onSubmit: () => undefined
      })
    );

    const securityHtml = render('security-research');
    const mathematicsHtml = render('mathematics');
    const emptyHtml = renderToStaticMarkup(createElement(WorkspaceCreationView, {
      form: emptyWorkspaceOnboardingForm(),
      busy: false,
      progress: null,
      onChange: () => undefined,
      onCancel: () => undefined,
      onLookupHackerOne: async () => undefined,
      onResearchKit: () => undefined,
      onSubmit: () => undefined
    }));
    expect(securityHtml).toContain('aria-label="Research Kit"');
    expect(securityHtml).toContain('aria-label="Workspace directories"');
    expect(securityHtml).toContain('aria-label="Add workspace directory"');
    expect(emptyHtml).toContain('aria-label="Choose workspace directory"');
    expect(securityHtml).toContain('class="workspace-dashboard workspace-creation"');
    expect(securityHtml).toContain('aria-label="New Workspace views"');
    expect(securityHtml).not.toContain('role="dialog"');
    expect(securityHtml).toContain('<select');
    expect(securityHtml).toContain('<option value="security-research" selected="">Security</option>');
    expect(securityHtml).not.toContain('Authorization owner');
    expect(securityHtml).not.toContain('Authorization expires');
    expect(securityHtml).not.toContain('Index Now');
    expect(securityHtml).not.toContain('Repository cloning');
    expect(securityHtml).not.toContain('Clone Later');
    expect(securityHtml).not.toContain('>Repositories<');
    expect(securityHtml).toContain('>Cancel</button>');
    expect(securityHtml).toContain('<option value="hackerone">HackerOne</option>');
    expect(securityHtml).toContain('<option value="apple-security-bounty">Apple Security Bounty</option>');
    expect(securityHtml).toContain('<option value="msrc">MSRC</option>');
    expect(securityHtml).toContain('<span>Overview</span>');
    expect(securityHtml).toContain('<span>Resources</span>');
    expect(securityHtml).toContain('<span>Rules</span>');
    expect(securityHtml).not.toContain('aria-controls="workspace-creation-kit-panel"');
    expect(securityHtml).toMatch(/aria-controls="workspace-creation-resources-panel"[^>]*disabled=""/u);
    expect(securityHtml).toMatch(/aria-controls="workspace-creation-rules-panel"[^>]*disabled=""/u);
    expect(securityHtml).toContain('class="primary-button" type="button">Next</button>');
    expect(mathematicsHtml).toContain('aria-label="Research Kit"');
    expect(mathematicsHtml).toContain('<option value="general" selected="">General</option>');
    expect(mathematicsHtml).not.toContain('<option value="hackerone">HackerOne</option>');
    expect(mathematicsHtml).toContain('<option value="mathematics" selected="">Mathematics</option>');
    expect(mathematicsHtml).not.toContain('<option value="apple-security-bounty">Apple Security Bounty</option>');
    expect(mathematicsHtml).not.toContain('<option value="msrc">MSRC</option>');

    const appleHtml = renderToStaticMarkup(createElement(WorkspaceCreationView, {
      form: applyResearchKit(form, 'apple-security-bounty'),
      busy: false,
      progress: null,
      onChange: () => undefined,
      onCancel: () => undefined,
      onLookupHackerOne: async () => undefined,
      onResearchKit: () => undefined,
      onSubmit: () => undefined
    }));
    expect(appleHtml).toContain('<span>Apple Security Bounty</span>');
    expect(appleHtml).toMatch(/aria-controls="workspace-creation-kit-panel"[^>]*disabled=""/u);
    expect(appleHtml.match(/role="tab"/gu)).toHaveLength(4);
  });

  it('waits for session commentary content before exposing the summary sidenav', () => {
    const emptyDetail = {
      run: { id: 'run_empty', promptMarkdown: '' }
    } as unknown as RunDetail;
    const promptDetail = {
      run: { id: 'run_prompt', promptMarkdown: 'Inspect the parser.' }
    } as unknown as RunDetail;

    expect(sessionContentAvailable(null, [])).toBe(false);
    expect(sessionContentAvailable(emptyDetail, [])).toBe(false);
    expect(sessionContentAvailable(promptDetail, [])).toBe(true);
    expect(sessionContentAvailable(emptyDetail, [{ id: 'event_one' } as never])).toBe(true);
  });

  it('shows one lazily selected suggestion workflow at a time', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(ResearchGoalChooser, {
        suggestions,
        loading: phaseValues(false),
        errors: phaseValues(null),
        onSelect: () => undefined,
        onRetry: () => undefined
      })
    );

    expect(html.match(/aria-label="Discovery goal \d:/g)).toHaveLength(4);
    expect(html).not.toMatch(/aria-label="Longshot goal \d:/);
    expect(html).not.toMatch(/aria-label="Chaining goal \d:/);
    expect(html).not.toMatch(/aria-label="Reporting goal \d:/);
    expect(html.match(/role="tab"/g)).toHaveLength(4);
    expect(html).toContain('role="tab" aria-selected="true" class="selected">Discovery</button>');
    expect(html).toContain('>Longshot</button>');
    for (const suggestion of suggestions.discovery ?? []) expect(html).toContain(suggestion);
    for (const suggestion of [...(suggestions.longshot ?? []), ...(suggestions.chaining ?? []), ...(suggestions.reporting ?? [])]) expect(html).not.toContain(suggestion);
  });

  it('starts goals directly by default in New Research', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        defaultProviderId: 'openai-codex',
        providerModelDefaults: {},
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: suggestions,
        researchGoalSuggestionsLoading: phaseValues(false),
        researchGoalSuggestionErrors: phaseValues(null),
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );

    expect(html).toContain('class="new-research-goal-toggle"');
    expect(html).toContain('class="new-research-generate-toggle"');
    expect(html).toMatch(/<input type="checkbox" checked=""\/>/);
    expect(html).toContain('<span>Goal</span>');
    expect(html).toContain('<span>Add Context</span>');
    expect(html).toContain('aria-label="Shell safety mode"');
    expect(html).toContain('Auto-Review');
    expect(html).toContain('aria-label="Research workflow"');
    expect(html).toContain('aria-label="Lead model settings"');
    expect(html).toContain('class="research-model-squircle research-lead-model-picker model-selection-picker');
    expect(html).toContain('aria-label="Add collaborator"');
    expect(html).not.toContain('research-collaborator-squircle');
    expect(html).not.toContain('Independent first pass');
    expect(html.match(/class="collaboration-inline-control"/g)).toHaveLength(3);
    expect(html.indexOf('>Challenge Rounds</span>')).toBeLessThan(html.indexOf('>Mode</span>'));
    expect(html).toContain('title="Sets how many rounds collaborators use to challenge and refine one another&#x27;s conclusions."');
    expect(html).toContain('title="Controls whether research runs solo, calls collaborators adaptively, or always uses the configured team."');
    expect(html).toContain('title="Controls how broadly and deeply collaborators are used during the session."');
    expect(html).not.toContain('>Add Context</button>');
    expect(html).toContain('>Start</button>');
    expect(html).not.toContain('>Nevermind</button>');
    expect(html).not.toContain('new-research-send');
    expect(html).not.toContain('<label>Network');
    for (const suggestion of suggestions.discovery ?? []) expect(html).toContain(suggestion);
    for (const suggestion of [...(suggestions.chaining ?? []), ...(suggestions.reporting ?? [])]) expect(html).not.toContain(suggestion);
    expect(html).not.toContain('Reviewing prior research…');
    expect(html).toContain('aria-label="Research goal"');
    expect(html).toContain('autofocus=""');
    expect(html).toContain('class="new-research-compose-layout"');
    expect(html).toContain('class="modal-panel wide-modal start-run-dialog"');
    expect(html).not.toContain('bottom-sheet-panel');
  });

  it('opens New Research in the shared commentary session surface', () => {
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        presentation: 'session',
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one', workspaceName: 'Parser Workspace' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        defaultProviderId: 'openai-codex',
        providerModelDefaults: {},
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: phaseSuggestions(),
        researchGoalSuggestionsLoading: phaseValues(false),
        researchGoalSuggestionErrors: phaseValues(null),
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const modalSource = readFileSync(new URL('../src/renderer/app/AppModals.tsx', import.meta.url), 'utf8');
    const settingsSource = readFileSync(new URL('../src/renderer/features/sessions/StartRunForm.tsx', import.meta.url), 'utf8');

    expect(html).toContain('class="main-trace-view main-commentary-view new-research-session-view"');
    expect(html).toContain('class="main-commentary-scroll"');
    expect(html).toContain('class="new-research-welcome"');
    expect(html).toContain('class="new-research-welcome-icon"');
    expect(html).toContain('Let&#x27;s research Parser Workspace');
    expect(html).toContain('aria-label="Research suggestion categories"');
    expect(html.match(/class="new-research-workflow-option"/g)).toHaveLength(4);
    expect(html).toContain('Find a new primitive by pairing a system area with a plausible bug class');
    expect(html).toContain('class="main-trace-footer has-pre-composer-content has-post-composer-content"');
    expect(html).toContain('class="main-steer-input-row without-trace-filters"');
    expect(html).toContain('class="new-research-options-tray"');
    expect(html).toContain('class="new-research-options-tray-left"');
    expect(html).toContain('class="new-research-options-tray-right"');
    expect(html.indexOf('new-research-repeat-picker')).toBeLessThan(html.indexOf('new-research-goal-toggle'));
    expect(html.indexOf('new-research-options-tray')).toBeLessThan(html.indexOf('class="main-steer-input-row without-trace-filters"'));
    expect(html.match(/class="new-research-goal-toggle"/g)).toHaveLength(1);
    expect(html.match(/class="new-research-generate-toggle"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Shell safety mode"');
    expect(html).toContain('aria-label="Model settings for the next agent turn"');
    expect(html).toContain('aria-label="Send steering instruction"');
    expect(html).toContain('placeholder="Write a full research prompt"');
    expect(html).toContain('class="new-research-collaboration-tray"');
    expect(html).toContain('aria-label="Collaboration settings"');
    expect(html).toContain('>Collaboration</span>');
    expect(html).toContain('class="new-research-collaborator-add"');
    expect(html).toContain('aria-label="Add collaborator"');
    expect(html).not.toContain('new-research-compose-layout');
    expect(html).not.toContain('research-goal-chooser');
    expect(html).not.toContain('collaboration-settings');
    expect(html).not.toContain('aria-label="Research workflow"');
    expect(html).not.toContain('role="dialog"');
    expect(appSource).toContain('presentation="session"');
    expect(appSource).toContain('const closeNewResearch = useCallback');
    expect(appSource).toContain('const sessionHeatRunId = newResearchOpen ? null : selectedRunId');
    expect(appSource).toContain('const sessionHeatRunDetail = newResearchOpen ? null : activeRunDetail');
    expect(appSource).toContain('onOpenWorkspace={(workspace) => {\n            closeNewResearch();');
    expect(appSource).toContain('onOpenResearchSession={(workspace, session) => {\n            closeNewResearch();');
    expect(appSource).toContain('onCancel={closeNewResearch}');
    expect(modalSource).not.toContain('StartRunForm');
    expect(settingsSource).toContain('const oldest = index === enabledCollaborators.length - 1');
    expect(settingsSource).toContain('{oldest ? (');
    expect(settingsSource).toContain('className="new-research-collaborator-row is-empty"');
    expect(settingsSource).toContain('className="new-research-collaborator-remove"');
    expect(settingsSource).toContain("label: 'Mode'");
    expect(settingsSource).toContain("label: 'Intensity'");
    expect(settingsSource).toContain("label: 'Challenge Rounds'");
    expect(settingsSource).toContain('setSelectedWorkflowId(workflow.id)');
    expect(settingsSource).toContain('onOpenWorkflow(workflow.id)');
    expect(settingsSource).toContain('title={null}');
  });

  it('changes the New Research prompt hint when context enrichment is enabled', () => {
    expect(newResearchPromptPlaceholder(false)).toBe('Write a full research prompt');
    expect(newResearchPromptPlaceholder(true)).toBe('Write a sentence or two');
  });

  it('prevents New Research checkbox labels from being text-selected', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const toggleStyles = styles.match(/\.new-research-goal-toggle,\s*\.new-research-generate-toggle\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(toggleStyles).toContain('user-select: none');
  });

  it('styles the New Research welcome as a large divided category list', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const welcomeStyles = styles.match(/\.new-research-welcome\s*\{([^}]*)\}/)?.[1] ?? '';
    const iconStyles = styles.match(/\.new-research-welcome-icon\s*\{([^}]*)\}/)?.[1] ?? '';
    const headingStyles = styles.match(/\.new-research-welcome > h2\s*\{([^}]*)\}/)?.[1] ?? '';
    const listStyles = styles.match(/\.new-research-workflow-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionStyles = styles.match(/\.new-research-workflow-option\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionIconStyles = styles.match(/\.new-research-workflow-option > svg\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionLabelStyles = styles.match(/\.new-research-workflow-option > span\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionNameStyles = styles.match(/\.new-research-workflow-option strong\s*\{([^}]*)\}/)?.[1] ?? '';
    const descriptionStyles = styles.match(/\.new-research-workflow-option span span\s*\{([^}]*)\}/)?.[1] ?? '';
    const backStyles = styles.match(/\.session-next-steps-back\s*\{([^}]*)\}/)?.[1] ?? '';
    const backHoverStyles = styles.match(/\.session-next-steps-back:hover:not\(:disabled\),\s*\.session-next-steps-back:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionRowStyles = styles.match(/\.new-research-suggestion-panel \.session-next-step-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionTextStyles = styles.match(/\.new-research-suggestion-panel \.session-next-step-button > span\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionChevronStyles = styles.match(/\.new-research-suggestion-panel \.session-next-step-button > svg:last-child\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionPanelStyles = styles.match(/\.new-research-suggestion-panel \.session-next-steps\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionHeaderStyles = styles.match(/\.new-research-suggestion-panel \.session-next-steps-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const suggestionListStyles = styles.match(/\.new-research-suggestion-panel \.session-next-steps-list\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(welcomeStyles).toContain('gap: 0');
    expect(iconStyles).toContain('width: 140px');
    expect(iconStyles).toContain('height: 140px');
    expect(headingStyles).toContain('font-size: 2.2rem');
    expect(listStyles).toContain('gap: 0');
    expect(listStyles).toContain('border-top: 1px solid var(--panel-border)');
    expect(optionStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(optionStyles).toContain('padding: 6px 7px');
    expect(optionIconStyles).toContain('align-self: center');
    expect(optionLabelStyles).toContain('gap: 1px');
    expect(optionNameStyles).toContain('color: var(--text)');
    expect(optionNameStyles).toContain('font-weight: 400');
    expect(descriptionStyles).toContain('font-size: 1rem');
    expect(descriptionStyles).toContain('overflow-wrap: anywhere');
    expect(descriptionStyles).toContain('white-space: normal');
    expect(backStyles).toContain('padding: 0');
    expect(backStyles).toContain('font-size: 1rem');
    expect(backHoverStyles).toContain('background: transparent');
    expect(backHoverStyles).toContain('color: var(--text)');
    expect(suggestionRowStyles).toContain('grid-template-columns: 22px minmax(0, 1fr)');
    expect(suggestionRowStyles).toContain('padding: 6px 7px');
    expect(suggestionTextStyles).toContain('font-size: 1rem');
    expect(suggestionTextStyles).toContain('white-space: normal');
    expect(suggestionChevronStyles).toContain('display: none');
    expect(suggestionPanelStyles).toContain('grid-template-rows: minmax(0, 1fr) auto');
    expect(suggestionHeaderStyles).toContain('grid-row: 2');
    expect(suggestionHeaderStyles).toContain('justify-content: flex-start');
    expect(suggestionListStyles).toContain('grid-row: 1');
    expect(suggestionListStyles).toContain('border-top: 1px solid var(--panel-border)');
  });

  it('prepends newly enabled collaborators', () => {
    const providers: ResearchCollaborationProviderPreference[] = [
      { provider: 'openai-codex', model: 'gpt-5.6-sol', reasoningEffort: 'high', enabled: true },
      { provider: 'anthropic', model: 'claude-opus-4-1', reasoningEffort: 'high', enabled: false }
    ];

    const enabled = enableCollaboratorAtTop(providers, providers[1]);

    expect(enabled.map((provider) => provider.provider)).toEqual(['anthropic', 'openai-codex']);
    expect(enabled[0]?.enabled).toBe(true);
    expect(providers[1]?.enabled).toBe(false);
  });

  it('styles collaboration dropdowns as compact inline controls', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const controlStyles = styles.match(/\.collaboration-inline-control\s*\{([^}]*)\}/)?.[1] ?? '';
    const selectStyles = styles.match(/\.collaboration-inline-control select\s*\{([^}]*)\}/)?.[1] ?? '';
    const selectHoverStyles = styles.match(/\.collaboration-inline-control select:hover:not\(:disabled\),\s*\.collaboration-inline-control select:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';
    const teamLabelStyles = styles.match(/\.research-model-team-label\s*\{([^}]*)\}/)?.[1] ?? '';
    const modelSurfaceStyles = styles.match(/\.research-model-squircle\s*\{([^}]*)\}/)?.[1] ?? '';
    const workspaceKitInputStyles = styles.match(/\.workspace-research-kit-source input\s*\{([^}]*)\}/)?.[1] ?? '';
    const startRunDialogStyles = styles.match(/\.modal-panel\.start-run-dialog\s*\{([^}]*)\}/)?.[1] ?? '';
    const startRunBodyStyles = styles.match(/\.modal-panel\.start-run-dialog \.modal-body\s*\{([^}]*)\}/)?.[1] ?? '';
    const startRunTitleStyles = styles.match(/\.modal-panel\.start-run-dialog \.modal-header h2\s*\{([^}]*)\}/)?.[1] ?? '';
    const startRunFooterStyles = styles.match(/\.modal-panel\.start-run-dialog \.modal-footer\s*\{([^}]*)\}/)?.[1] ?? '';
    const startRunFooterButtonStyles = styles.match(/\.modal-panel\.start-run-dialog \.modal-footer button\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchLayoutStyles = styles.match(/\.new-research-compose-layout\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchComposerStyles = styles.match(/\.new-research-composer\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchComposerActionStyles = styles.match(/\.new-research-composer-actions\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchTrayStyles = styles.match(/\.new-research-options-tray\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaborationTrayStyles = styles.match(/\.new-research-collaboration-tray\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaborationPickerStyles = styles.match(/\.new-research-collaboration-picker\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaborationPickerTriggerStyles = styles.match(/\.new-research-collaboration-picker \.model-selection-picker-trigger\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaborationPickerLabelStyles = styles.match(/\.new-research-collaboration-picker \.model-selection-picker-model\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaboratorActionStyles = styles.match(/\.new-research-collaborator-add,\s*\.new-research-collaborator-remove\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaboratorPickerStyles = styles.match(/\.new-research-collaborator-picker\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaboratorIdentityStyles = styles.match(/\.new-research-collaborator-picker \.model-selection-picker-trigger:not\(:disabled\) \.model-selection-picker-provider-icon,\s*\.new-research-collaborator-picker \.model-selection-picker-trigger:not\(:disabled\) \.model-selection-picker-model\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchCollaboratorRowStyles = styles.match(/\.new-research-collaborator-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchRepeatTriggerStyles = styles.match(/\.new-research-repeat-trigger\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchRepeatActiveStyles = styles.match(/\.new-research-repeat-picker\.is-non-default \.new-research-repeat-trigger\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchToggleStyles = styles.match(/\.new-research-goal-toggle,\s*\.new-research-generate-toggle\s*\{([^}]*)\}/)?.[1] ?? '';
    const newResearchToggleActiveStyles = styles.match(/\.new-research-goal-toggle:has\(input:checked\),\s*\.new-research-generate-toggle:has\(input:checked\)\s*\{([^}]*)\}/)?.[1] ?? '';
    const researchGoalChooserStyles = styles.match(/\.research-goal-chooser\s*\{([^}]*)\}/)?.[1] ?? '';
    const researchGoalChoiceScrollStyles = styles.match(/\.research-goal-choice-scroll\s*\{([^}]*)\}/)?.[1] ?? '';
    const researchGoalChoiceListStyles = styles.match(/\.research-goal-choice-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const researchGoalChoiceStyles = styles.match(/\.research-goal-choice\s*\{([^}]*)\}/)?.[1] ?? '';
    const researchGoalChoiceHoverStyles = styles.match(/button\.research-goal-choice:hover:not\(:disabled\),\s*button\.research-goal-choice:focus-visible\s*\{([^}]*)\}/)?.[1] ?? '';

    expect(INSET_SCROLLBAR_SELECTOR).toContain('.research-goal-choice-list');
    expect(styles.match(/  \.research-goal-choice-list,/g)).toHaveLength(6);
    expect(controlStyles).toContain('display: inline-flex');
    expect(controlStyles).toContain('gap: 5px');
    expect(controlStyles).toContain('color: var(--muted)');
    expect(controlStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(controlStyles).toContain('font-weight: 400');
    expect(selectStyles).toContain('max-width: 120px');
    expect(selectStyles).toContain('border: 0');
    expect(selectStyles).toContain('background-color: var(--panel-column)');
    expect(selectStyles).toContain('font-weight: 400');
    expect(selectHoverStyles).toContain('box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--text) 9%, transparent)');
    expect(teamLabelStyles).toContain('color: var(--muted)');
    expect(teamLabelStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(teamLabelStyles).toContain('font-weight: 400');
    expect(teamLabelStyles).toContain('line-height: normal');
    expect(modelSurfaceStyles).toContain('background: var(--panel-column)');
    expect(workspaceKitInputStyles).toContain('background: var(--panel-strong)');
    expect(startRunDialogStyles).toContain('min-height: 0');
    expect(startRunDialogStyles).toContain('border-radius: 34px');
    expect(startRunDialogStyles).toContain('corner-shape: squircle');
    expect(startRunDialogStyles).toContain('background: var(--panel-raised)');
    expect(startRunBodyStyles).toContain('padding-bottom: 12px');
    expect(startRunTitleStyles).toContain('color: var(--muted)');
    expect(startRunTitleStyles).toContain('font-size: 1rem');
    expect(startRunTitleStyles).toContain('font-weight: 400');
    expect(startRunTitleStyles).toContain('line-height: 1.3');
    expect(startRunFooterStyles).toContain('background: var(--panel-raised)');
    expect(startRunFooterButtonStyles).toContain('border: 0');
    expect(newResearchLayoutStyles).toContain('gap: 0');
    expect(newResearchLayoutStyles).toContain('background: var(--panel)');
    expect(newResearchComposerStyles).toContain('border: 0');
    expect(newResearchComposerStyles).toContain('background: var(--panel-column)');
    expect(newResearchComposerActionStyles).toContain('padding: 2px 3px 5px 4px');
    expect(newResearchTrayStyles).toContain('justify-content: space-between');
    expect(newResearchTrayStyles).toContain('border-radius: var(--trace-footer-radius) var(--trace-footer-radius) 0 0');
    expect(newResearchTrayStyles).toContain('position: absolute');
    expect(newResearchTrayStyles).toContain('background: var(--panel-column)');
    expect(newResearchTrayStyles).toContain('padding: 5px 7px calc(5px + var(--new-research-options-tray-overlap))');
    expect(newResearchTrayStyles).toContain('animation: new-research-options-tray-reveal');
    expect(newResearchCollaborationTrayStyles).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(newResearchCollaborationTrayStyles).toContain('border-radius: 0 0 var(--trace-footer-radius) var(--trace-footer-radius)');
    expect(newResearchCollaborationTrayStyles).toContain('background: var(--panel-column)');
    expect(newResearchCollaborationTrayStyles).toContain('padding: calc(5px + var(--new-research-options-tray-overlap)) 0 5px 4px');
    expect(newResearchCollaborationTrayStyles).toContain('animation: new-research-collaboration-tray-reveal');
    expect(newResearchCollaborationPickerStyles).toContain('color: var(--muted)');
    expect(newResearchCollaborationPickerTriggerStyles).toContain('font-size: inherit');
    expect(newResearchCollaborationPickerLabelStyles).toContain('color: var(--muted)');
    expect(newResearchCollaboratorActionStyles).toContain('width: 31px');
    expect(newResearchCollaboratorActionStyles).toContain('height: 31px');
    expect(newResearchCollaboratorActionStyles).toContain('border-radius: 999px');
    expect(newResearchCollaboratorActionStyles).toContain('justify-self: start');
    expect(newResearchCollaboratorPickerStyles).toContain('width: max-content');
    expect(newResearchCollaboratorPickerStyles).toContain('justify-self: end');
    expect(newResearchCollaboratorIdentityStyles).toContain('color: var(--muted)');
    expect(newResearchCollaboratorRowStyles).toContain('grid-template-columns: minmax(0, 250px) 35px');
    expect(newResearchCollaboratorRowStyles).toContain('gap: 6px');
    expect(newResearchRepeatTriggerStyles).toContain('color: var(--muted)');
    expect(newResearchRepeatActiveStyles).toContain('color: var(--text)');
    expect(newResearchToggleStyles).toContain('color: var(--muted)');
    expect(newResearchToggleActiveStyles).toContain('color: var(--text)');
    expect(researchGoalChooserStyles).toContain('margin-left: -18px');
    expect(researchGoalChooserStyles).toContain('background: transparent');
    expect(researchGoalChooserStyles).toContain('padding: 10px 0 0 28px');
    expect(researchGoalChoiceScrollStyles).toContain('box-shadow: inset 0 1px var(--line)');
    expect(researchGoalChoiceScrollStyles).not.toContain('inset 0 -1px');
    expect(researchGoalChoiceListStyles).toContain('padding: 1px 0 0');
    expect(researchGoalChoiceListStyles).not.toContain('scrollbar-gutter');
    expect(researchGoalChoiceStyles).toContain('border-top: 1px solid transparent');
    expect(researchGoalChoiceHoverStyles).toContain('border-top-color: var(--text)');
    expect(researchGoalChoiceHoverStyles).toContain('border-bottom-color: var(--text)');
    expect(researchGoalChoiceHoverStyles).toContain('background: transparent');
    expect(researchGoalChoiceHoverStyles).toContain('color: var(--text)');
    expect(styles).toContain('.research-collaborator-squircle:has(.research-collaborator-picker .model-selection-picker-trigger:hover:not(:disabled))');
    expect(styles).toContain('box-shadow: inset 0 0 0 999px color-mix(in srgb, var(--text) 9%, transparent)');
    expect(styles).toContain('.research-collaborator-squircle .research-collaborator-picker .model-selection-picker-trigger:hover:not(:disabled)');
    expect(styles).toMatch(/\.research-collaborator-add:hover:not\(:disabled\),[\s\S]*?box-shadow: inset 0 0 0 999px color-mix\(in srgb, var\(--text\) 9%, transparent\)/);
  });

  it('keeps the terminal-session next-step widget structurally stable while suggestions load', () => {
    const render = (loading: boolean, suggestions: string[]): string => renderToStaticMarkup(
      createElement(SessionNextStepsWidget, {
        loading,
        suggestions,
        error: null,
        onSelect: () => undefined
      })
    );
    const loadingHtml = render(true, []);
    const loadedHtml = render(false, [
      'Verify the strongest unresolved boundary from the completed session.',
      'Generalize the session result to the nearest related research case.',
      'Stress-test the key conclusion against a materially different construction.'
    ]);

    expect(loadingHtml).toContain('class="session-next-steps"');
    expect(loadingHtml).toContain('<header class="session-next-steps-header"><h3>Suggestions</h3>');
    expect(loadingHtml).not.toContain('Regenerate suggestions');
    expect(loadingHtml).not.toContain('<span>Refresh</span>');
    expect(loadingHtml.match(/class="session-next-step-skeleton"/g)).toHaveLength(3);
    expect(loadedHtml).toContain('class="session-next-steps"');
    expect(loadedHtml.match(/class="session-next-step-button"/g)).toHaveLength(3);
    expect(loadedHtml.match(/session-next-step-icon/g)).toHaveLength(3);

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const containerStyles = styles.match(/\.session-next-steps\s*\{([^}]*)\}/)?.[1] ?? '';
    const headerStyles = styles.match(/\.session-next-steps-header\s*\{([^}]*)\}/)?.[1] ?? '';
    const listStyles = styles.match(/\.session-next-steps-list\s*\{([^}]*)\}/)?.[1] ?? '';
    const rowStyles = styles.match(/\.session-next-step-button,\s*\.session-next-step-skeleton\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(containerStyles).toContain('background: transparent');
    expect(containerStyles).toContain('border-radius: 0');
    expect(containerStyles).toContain('width: 100%');
    expect(containerStyles).toContain('max-width: var(--trace-content-max-width)');
    expect(containerStyles).toContain('margin: 10px auto -14px');
    expect(containerStyles).not.toContain('height: 219px');
    expect(headerStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(listStyles).toContain('grid-template-rows: repeat(3, auto)');
    expect(listStyles).toContain('align-content: start');
    expect(listStyles).toContain('--session-next-step-row-height: calc(2.6rem + 14px)');
    expect(rowStyles).toContain('background: transparent');
    expect(rowStyles).toContain('border-radius: 0');
    expect(rowStyles).toContain('border-bottom: 1px solid var(--panel-border)');
    expect(rowStyles).toContain('min-height: var(--session-next-step-row-height)');
    const skeletonStyles = styles.match(/\.session-next-step-skeleton\s*\{([^}]*)\}/g)?.at(-1) ?? '';
    expect(skeletonStyles).toContain('padding: 6px 10px');
    const buttonStyles = styles.match(/\.session-next-step-button\s*\{([^}]*)\}/)?.[1] ?? '';
    const buttonHoverStyles = styles.match(/\.session-next-step-button:hover:not\(:disabled\)\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(buttonStyles).toContain('padding: 6px 0');
    expect(buttonStyles).toContain('border-top: 1px solid transparent');
    expect(buttonStyles).toContain('grid-template-columns: auto minmax(0, 1fr) auto');
    expect(buttonHoverStyles).toContain('border-top-color: var(--text)');
    expect(buttonHoverStyles).toContain('border-bottom-color: var(--text)');
    expect(buttonHoverStyles).toContain('background: transparent');
    expect(buttonHoverStyles).toContain('color: var(--text)');
  });

  it('reuses the session suggestion rows for a selected New Research category', () => {
    const html = renderToStaticMarkup(createElement(SessionNextStepsWidget, {
      loading: false,
      suggestions: ['One', 'Two', 'Three', 'Four'],
      error: null,
      title: null,
      suggestionLimit: 4,
      onBack: () => undefined,
      onSelect: () => undefined
    }));

    expect(html).not.toContain('Discovery Suggestions');
    expect(html).toContain('<header class="session-next-steps-header"><button');
    expect(html).toContain('class="session-next-steps-back"');
    expect(html).toContain('Categories');
    expect(html.match(/class="session-next-step-button"/g)).toHaveLength(4);
  });

  it('loads missing suggestions for every ended session view', () => {
    const emptyHtml = renderToStaticMarkup(createElement(SessionNextStepsWidget, {
      loading: false,
      suggestions: [],
      error: null,
      onSelect: () => undefined
    }));

    expect(emptyHtml).toContain('No suggestions to show.');
    expect(emptyHtml).not.toContain('Regenerate suggestions');
    expect(shouldShowSessionNextSteps('completed', true)).toBe(true);
    expect(shouldShowSessionNextSteps('completed', false)).toBe(false);

    const detail = {
      run: {
        id: 'run_complete',
        status: 'completed',
        endedAt: '2026-08-12T12:00:00.000Z',
        summary: 'Completed bounded research.',
        finalDisposition: null,
        budget: { researchWorkflowId: 'discovery' }
      },
      nextStepSuggestions: null
    } as unknown as RunDetail;
    const revisitHtml = renderToStaticMarkup(createElement(SessionNextSteps, {
      detail,
      onSelect: () => undefined
    }));
    expect(revisitHtml).toContain('aria-busy="true"');
    expect(revisitHtml.match(/session-next-step-skeleton/g)).toHaveLength(3);
  });

  it('renders persisted session next steps immediately without a loading state', () => {
    const suggestions = [
      'Verify the strongest unresolved boundary from the completed session.',
      'Generalize the session result to the nearest related research case.',
      'Stress-test the key conclusion against a materially different construction.'
    ];
    const detail = {
      run: {
        id: 'run_complete',
        endedAt: '2026-08-12T12:00:00.000Z',
        summary: 'Completed bounded research.',
        finalDisposition: null,
        budget: { researchWorkflowId: 'discovery' }
      },
      nextStepSuggestions: { phase: 'discovery', suggestions }
    } as unknown as RunDetail;

    const html = renderToStaticMarkup(createElement(SessionNextSteps, {
      detail,
      onSelect: () => undefined
    }));

    expect(html).toContain('aria-busy="false"');
    expect(html.match(/class="session-next-step-button"/g)).toHaveLength(3);
    expect(html).not.toContain('session-next-step-skeleton');
    for (const suggestion of suggestions) expect(html).toContain(suggestion);
  });

  it('seeds the shared New Research composer from a session suggestion', () => {
    const sentence = 'Verify the strongest unresolved boundary from the completed session.';
    const promptMarkdown = 'Continue from the prior evidence and verify the unresolved parser boundary.';
    const html = renderToStaticMarkup(
      createElement(StartRunForm, {
        snapshot: {
          workspace: { workspaceId: 'workspace_one' },
          activeScope: { id: 'scope_one' }
        } as WorkspaceSnapshot,
        openAiStatus: null,
        defaultProviderId: 'openai-codex',
        providerModelDefaults: {},
        researchProviderStatuses: [],
        providerModelCatalog: [],
        researchGoalSuggestions: phaseSuggestions(),
        researchGoalSuggestionsLoading: phaseValues(false),
        researchGoalSuggestionErrors: phaseValues(null),
        initialGoal: { sentence, phase: 'discovery', promptMarkdown },
        busy: false,
        runAction: async () => undefined,
        onCancel: () => undefined,
        onRetryResearchGoalSuggestions: () => undefined,
        onStarted: () => undefined
      })
    );

    expect(html).toContain(promptMarkdown);
    expect(html).toContain('aria-label="Research objective brief"');
    expect(html).toContain('>Start</button>');
    expect(html).toContain('aria-label="Research suggestions"');
    expect(html).not.toContain('Discovery suggestions');
    expect(html).toContain('research-goal-choice-scroll');
    expect(html).not.toContain('Choose another goal');
  });

  it('shows only the selected workflow error while other workflow state stays hidden', () => {
    const suggestions = phaseSuggestions();
    const html = renderToStaticMarkup(
      createElement(ResearchGoalChooser, {
        suggestions: { discovery: suggestions.discovery },
        loading: { discovery: false, chaining: false, reporting: true },
        errors: { discovery: null, chaining: 'Chaining request failed.', reporting: null },
        selectedWorkflowId: 'chaining',
        onSelect: () => undefined,
        onRetry: () => undefined
      })
    );

    expect(html).not.toMatch(/aria-label="Discovery goal \d:/);
    expect(html).toContain('Could not load chaining goals');
    expect(html).toContain('Chaining request failed.');
    expect(html).not.toContain('research-goal-choice-loading');
  });

  it('renders memory record details in a bottom sheet', () => {
    const node: HoneycrispMemoryNodeSummary = {
      id: 'primitive_one',
      sessionIds: ['run_one'],
      workspaces: [{ id: 'workspace_one', name: 'Parser Research' }],
      subjectId: 'subject_parser',
      subjectName: 'Parser Research',
      type: 'primitive',
      title: 'Unchecked parser length',
      summary: 'The captured source multiplies a length before checking bounds.',
      body: 'Detailed parser analysis.',
      status: 'suspected',
      confidence: 0.8,
      assetIds: ['src/parser.c'],
      tags: ['parser'],
      attributes: {},
      evidenceRefs: [],
      createdAt: '2026-07-28T00:00:00.000Z',
      updatedAt: '2026-07-28T00:05:00.000Z',
      revision: 2,
      authors: [{ provider: 'anthropic', model: 'claude-sonnet-4-5' }]
    };
    const html = renderToStaticMarkup(
      createElement(MemoryDetailView, {
        node,
        nodeById: new Map([[node.id, node]]),
        relationships: []
      })
    );

    expect(html).not.toContain('bottom-sheet-panel');
    expect(html).toContain('Unchecked parser length');
    expect(html).toContain('Detailed parser analysis.');
    expect(html).toContain('Authored by');
    expect(html).toContain('claude-sonnet-4-5');
    expect(html).toContain('class="memory-type-label memory-type-primitive"');
    expect(html).toContain('class="memory-type-dot memory-type-primitive" aria-hidden="true"');
  });

});

function phaseSuggestions(): ResearchGoalSuggestionsByPhase {
  return {
    discovery: [
      'Research parser allocation boundaries for integer-overflow vulnerabilities.',
      'Explore archive extraction for path-confusion vulnerabilities.',
      'Examine workspace ownership for authorization vulnerabilities.',
      'Research metadata decoding for memory-safety vulnerabilities.'
    ],
    longshot: [
      'Hunt for a reportable high-impact trust-boundary failure in workspace imports.',
      'Pursue a critical cross-project isolation failure in repository attachment flows.',
      'Investigate a high-impact authorization composition flaw across ownership transitions.',
      'Search for a critical parser-to-execution chain in underexplored metadata handling.'
    ],
    chaining: [
      'Upgrade the parser primitive into a reportable chain with a triage-ready PoC.',
      'Develop the archive primitive into a reachable chain with a triage-ready PoC.',
      'Connect the ownership primitive to impact in a chain with a triage-ready PoC.',
      'Close the metadata primitive chain gaps and produce a triage-ready PoC.'
    ],
    reporting: [
      'Report the parser chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Document the archive chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Report the ownership chain with its bugs, impact, triage-ready PoC, and submission.zip.',
      'Document the metadata chain with its bugs, impact, triage-ready PoC, and submission.zip.'
    ]
  };
}

function phaseValues<T>(value: T): { discovery: T; longshot: T; chaining: T; reporting: T } {
  return { discovery: value, longshot: value, chaining: value, reporting: value };
}
