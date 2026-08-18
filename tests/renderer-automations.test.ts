import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AutomationSummary, WorkspaceRegistryEntry } from '@shared/types';
import { AutomationsWorkspace } from '../src/renderer/features/automations/AutomationsWorkspace';
import { researchSettingsInput } from '../src/renderer/features/sessions/StartRunForm';
import { defaultRunInput } from '../src/renderer/view-models/runSettings';

const workspace: WorkspaceRegistryEntry = {
  id: 'registry_workspace_one',
  workspacePath: 'C:\\workspaces\\parser',
  workspaceId: 'workspace_one',
  workspaceName: 'Parser',
  researchProfileId: 'security-research',
  scopeOwner: 'Parser',
  descriptionMarkdown: '',
  rulesMarkdown: '',
  expiresAt: null,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
  lastOpenedAt: '2026-08-17T12:00:00.000Z',
  runCount: 2,
  lastRunAt: '2026-08-17T12:00:00.000Z'
};

const activeAutomation: AutomationSummary = {
  runId: 'run_active',
  workspaceId: workspace.workspaceId,
  workspaceName: workspace.workspaceName,
  title: 'Daily parser review',
  promptPreview: 'Review parser boundary changes.',
  enabled: true,
  schedule: { type: 'daily', interval: 1 },
  maxMinutes: 45,
  maxAttempts: 3,
  maxCostUsd: 8,
  settings: {
    ...defaultRunInput,
    provider: 'openai-codex',
    promptMarkdown: 'Review parser boundary changes.',
    workflowId: 'discovery',
    model: 'gpt-5.6-sol',
    budget: {
      ...defaultRunInput.budget,
      maxMinutes: 45,
      maxAttempts: 3,
      maxCostUsd: 8,
      repeatSchedule: { type: 'daily', interval: 1 }
    }
  },
  researchProfile: null,
  sessionStatus: 'completed',
  createdAt: '2026-08-16T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z'
};

const inactiveAutomation: AutomationSummary = {
  ...activeAutomation,
  runId: 'run_inactive',
  title: 'Weekly regression review',
  enabled: false,
  schedule: { type: 'weekly', interval: 1 },
  settings: {
    ...activeAutomation.settings,
    budget: {
      ...activeAutomation.settings.budget,
      repeatSchedule: { type: 'weekly', interval: 1 }
    }
  }
};

function render(selectedAutomation: AutomationSummary | null = null, loading = false): string {
  return renderToStaticMarkup(createElement(AutomationsWorkspace, {
    automations: [activeAutomation, inactiveAutomation],
    workspaces: [workspace],
    selectedWorkspaceId: null,
    selectedAutomation,
    openAiStatus: null,
    defaultProviderId: null,
    providerModelDefaults: {},
    researchProviderStatuses: [],
    providerModelCatalog: [{
      providerId: 'openai-codex',
      providerName: 'OpenAI',
      models: [{
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6 Sol',
        reasoning: true,
        effortLevels: ['low', 'medium', 'high', 'xhigh'],
        contextWindow: 400_000,
        maxTokens: 128_000
      }]
    }],
    loading,
    error: null,
    onScopeChange: () => undefined,
    onSelectAutomation: () => undefined,
    onSaveAutomation: async () => activeAutomation
  }));
}

describe('automation workspace', () => {
  it('uses the shared centered regular-weight loading state', () => {
    const html = render(null, true);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('class="centered-loading-state"');
    expect(html).toContain('class="centered-loading-state-spinner"');
    expect(html).toContain('<span>Loading automations…</span>');
    expect(html).not.toContain('<strong>Loading automations');
  });

  it('keeps New Research defaults uninflated and preserves stored automation choices when inflated', () => {
    const defaults = researchSettingsInput(undefined, 'discovery', null);
    const dangerDefaults = researchSettingsInput(undefined, 'discovery', null, 'danger');
    const inflated = researchSettingsInput(activeAutomation.settings, 'longshot', null);

    expect(defaults.promptMarkdown).toBe('');
    expect(defaults.model).toBe('');
    expect(defaults.shellSafetyMode).toBe('auto_review');
    expect(dangerDefaults.shellSafetyMode).toBe('danger');
    expect(defaults.budget.repeatSchedule).toEqual({ type: 'none' });
    expect(inflated).toMatchObject({
      provider: 'openai-codex',
      workflowId: 'discovery',
      model: 'gpt-5.6-sol',
      promptMarkdown: 'Review parser boundary changes.',
      budget: { repeatSchedule: { type: 'daily', interval: 1 } }
    });
  });

  it('renders All Automations and workspace scope tabs with status lists', () => {
    const html = render();

    expect(html).toContain('All Automations');
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('>Parser</span>');
    expect(html).toContain('<h2>1 Active</h2>');
    expect(html).toContain('<h2>1 Inactive</h2>');
    expect(html).toContain('Daily parser review');
    expect(html).toContain('Weekly regression review');
    expect(html).toContain('Daily');
    expect(html).toContain('Weekly');
  });

  it('opens a property and schedule editor for the selected automation', () => {
    const html = render(activeAutomation);
    const settingsSource = readFileSync(new URL('../src/renderer/features/sessions/StartRunForm.tsx', import.meta.url), 'utf8');

    expect(html).toContain('class="automations-workspace-content has-editor"');
    expect(html).toContain('Edit automation');
    expect(html).toContain('>Name</span>');
    expect(html).toContain('>Active</span>');
    expect(html).toContain('class="research-settings-form"');
    expect(html).toContain('Review parser boundary changes.');
    expect(html).toContain('aria-label="Shell safety mode"');
    expect(html).toContain('aria-label="Research workflow"');
    expect(html).toContain('aria-label="Repeat schedule"');
    expect(html).toContain('aria-label="Lead model settings"');
    expect(html).toContain('<span class="model-selection-picker-model">5.6 Sol</span>');
    const leadModelTrigger = html.match(/<button[^>]*aria-label="Lead model settings"[^>]*>/)?.[0] ?? '';
    expect(leadModelTrigger).not.toContain('disabled');
    expect(html).toContain('Challenge Rounds');
    expect(html).toContain('>Mode</span>');
    expect(html).toContain('>Intensity</span>');
    expect(html).not.toContain('aria-label="Research suggestions"');
    expect(html).not.toContain('Add Context');
    expect(html).toContain('>Save changes</button>');
    expect(settingsSource).toContain("export function ResearchSettingsForm({");
    expect(settingsSource).toContain("disabled={disableNoRepeat && type === 'none'}");
  });

  it('uses divider rows rather than cards', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.automation-section-items\s*\{[^}]*border-top:\s*1px solid var\(--panel-border\);[^}]*border-bottom:\s*1px solid var\(--panel-border\);/s);
    expect(styles).toMatch(/\.automation-row\s*\{[^}]*border:\s*0;[^}]*border-radius:\s*0;[^}]*background:\s*transparent;/s);
    expect(styles).not.toContain('.automation-card');
  });

  it('uses the automation field background for native collaboration dropdowns', () => {
    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');

    expect(styles).toMatch(/\.automation-editor \.collaboration-inline-control > select\s*\{[^}]*background-color:\s*var\(--panel\);/s);
  });

  it('moves Automations out of AppModals and into main navigation', () => {
    const appSource = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');
    const modalSource = readFileSync(new URL('../src/renderer/app/AppModals.tsx', import.meta.url), 'utf8');
    const sidebarSource = readFileSync(new URL('../src/renderer/features/workspaces/WorkspaceSidebar.tsx', import.meta.url), 'utf8');

    expect(appSource).toContain('<AutomationsWorkspace');
    expect(appSource).toContain('!newResearchOpen && !automationsOpen && !reportsOpen');
    expect(appSource).toContain('!newResearchOpen && !automationsOpen && !(settingsOpen');
    expect(appSource).toContain('setAutomationScopeWorkspaceId(snapshot?.workspace.workspaceId ?? null);');
    expect(appSource).toContain("? { primary: 'Automations', secondary: selectedAutomation?.title ?? automationScopeName, icon: 'automations' }");
    expect(modalSource).not.toContain('AutomationsModal');
    expect(sidebarSource).toContain("sidebar-utility-button${automationsActive ? ' active' : ''}");
    expect(existsSync(new URL('../src/renderer/features/plugins/AutomationsModal.tsx', import.meta.url))).toBe(false);
  });

  it('exposes workspace-independent list and update contracts with retained inactive schedules', () => {
    const types = readFileSync(new URL('../src/shared/types.ts', import.meta.url), 'utf8');
    const service = readFileSync(new URL('../src/main/workspaceService.ts', import.meta.url), 'utf8');
    const database = readFileSync(new URL('../src/main/database.ts', import.meta.url), 'utf8');

    expect(types).toContain('listAutomations(): Promise<AutomationSummary[]>;');
    expect(types).toContain('updateAutomation(input: AutomationUpdateInput): Promise<AutomationSummary>;');
    expect(service).toContain('public async listAutomations(): Promise<AutomationSummary[]>');
    expect(service).toContain('public updateAutomation(input: AutomationUpdateInput): AutomationSummary');
    expect(service).toContain("repeatSchedule: input.enabled ? schedule : { type: 'none' }");
    expect(service).toContain('automationSchedule: schedule');
    expect(service).toContain('runtime.db.updateRunModelSelection');
    expect(service).toContain('runtime.db.updateRunPrompt');
    expect(database).toContain('nextBudget.automationSchedule = schedule;');
  });
});
