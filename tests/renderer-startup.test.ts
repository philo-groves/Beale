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
    expect(html).toContain('Starting Beale');
  });

  it('shows progress while registry and workspace restoration are pending', () => {
    const registryHtml = renderToStaticMarkup(createElement(WorkspaceStartupView, {
      phase: 'registry',
      onAddWorkspace: () => undefined
    }));
    const workspaceHtml = renderToStaticMarkup(createElement(WorkspaceStartupView, {
      phase: 'workspace',
      onAddWorkspace: () => undefined
    }));
    const readyHtml = renderToStaticMarkup(createElement(WorkspaceStartupView, {
      phase: 'ready',
      onAddWorkspace: () => undefined
    }));

    expect(registryHtml).toContain('Loading workspaces');
    expect(registryHtml).toContain('aria-busy="true"');
    expect(workspaceHtml).toContain('Opening your last workspace');
    expect(readyHtml).toContain('Add Workspace');
    expect(readyHtml).toContain('aria-busy="false"');
  });

  it('waits for a renderer frame and registry state before restoring a workspace', () => {
    const runtime = readFileSync(
      new URL('../src/renderer/hooks/useWorkspaceRuntime.ts', import.meta.url),
      'utf8'
    );
    const main = readFileSync(new URL('../src/main/index.ts', import.meta.url), 'utf8');
    const registryLoad = runtime.indexOf('ipc.getWorkspaceRegistry.initial');
    const restore = runtime.indexOf('ipc.restoreLastWorkspace.initial');

    expect(runtime).toContain("useState<WorkspaceStartupPhase>('shell')");
    expect(runtime).toContain('const startupFrame = window.requestAnimationFrame');
    expect(runtime).toContain('await nextRendererFrame();');
    expect(registryLoad).toBeGreaterThan(0);
    expect(restore).toBeGreaterThan(registryLoad);
    expect(runtime).not.toContain('ipc.getSnapshot.initial');
    expect(runtime).not.toContain('.getOpenAiStatus()');
    expect(main).toContain('IPC_CHANNELS.restoreLastWorkspace');
    expect(main).not.toMatch(/createWindow\(\);\s*setImmediate\(\(\) => \{\s*workspaceService\.openLastWorkspaceIfAvailable/u);
  });
});
