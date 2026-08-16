import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InitialAppShell } from '../src/renderer/app/InitialAppShell';
import { WorkspaceStartupView } from '../src/renderer/features/workspaces/WorkspaceStartupView';

describe('renderer startup', () => {
  it('ships a lightweight no-workspace shell before loading the workbench bundle', () => {
    const source = readFileSync(new URL('../src/renderer/main.tsx', import.meta.url), 'utf8');
    const html = renderToStaticMarkup(createElement(InitialAppShell));

    expect(source).toContain("lazy(() => import('./App')");
    expect(source).toContain('fallback={<InitialAppShell />}');
    expect(source).toContain('window.requestAnimationFrame(() => setWorkbenchReady(true))');
    expect(source).toContain('if (!workbenchReady) return <InitialAppShell />;');
    expect(source).toContain("import './startup.css';");
    expect(source).not.toContain("import './styles.css';");
    expect(html).toContain('No Workspace Selected');
    expect(html).toContain('Choose a known workspace');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('Starting Beale');
    expect(html).not.toContain('role="status"');
  });

  it('shows the ready no-workspace view without startup loading copy', () => {
    const html = renderToStaticMarkup(createElement(WorkspaceStartupView, {
      onAddWorkspace: () => undefined
    }));

    expect(html).toContain('No Workspace Selected');
    expect(html).toContain('Choose a known workspace');
    expect(html).toContain('Add Workspace');
    expect(html).toContain('aria-busy="false"');
    expect(html).not.toContain('Loading workspaces');
    expect(html).not.toContain('Opening your last workspace');
    expect(html).not.toContain('role="status"');
  });

  it('loads registry state without restoring or snapshot-loading a workspace', () => {
    const runtime = readFileSync(
      new URL('../src/renderer/hooks/useWorkspaceRuntime.ts', import.meta.url),
      'utf8'
    );
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const registryLoad = runtime.indexOf('ipc.getWorkspaceRegistry.initial');

    expect(runtime).toContain("useState<WorkspaceStartupPhase>('shell')");
    expect(runtime).toContain('const startupFrame = window.requestAnimationFrame');
    expect(registryLoad).toBeGreaterThan(0);
    expect(runtime).not.toContain("'workspace'");
    expect(runtime).not.toContain('nextRendererFrame');
    expect(runtime).not.toContain('restoreLastWorkspace');
    expect(runtime).not.toContain('ipc.getSnapshot.initial');
    expect(runtime).not.toContain('.getOpenAiStatus()');
    expect(main).toContain('IPC_CHANNELS.restoreLastWorkspace');
    expect(main).not.toMatch(/createWindow\(\);\s*setImmediate\(\(\) => \{\s*workspaceService\.openLastWorkspaceIfAvailable/u);
  });
});
