import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GeneralSettingsView } from '../src/renderer/features/settings/SettingsModal';
import {
  DEFAULT_PERMISSION_SETTINGS,
  PERMISSION_SETTINGS_STORAGE_KEY,
  normalizePermissionSettings,
  permissionModeOptions,
  readPermissionSettings,
  writePermissionSettings
} from '../src/renderer/view-models/permissionSettings';

describe('renderer debugging settings', () => {
  it('renders a Traces retention checkbox and keeps Commentary implicit', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsView, {
      tracesEnabled: true,
      dangerModeEnabled: false,
      defaultShellSafetyMode: 'auto_review',
      onChangeTracesEnabled: () => undefined,
      onChangeDangerModeEnabled: () => undefined,
      onChangeDefaultShellSafetyMode: () => undefined
    }));

    expect(html).toContain('<h2 id="debugging-settings-heading">Debugging</h2>');
    expect(html).toMatch(/<input[^>]+type="checkbox"[^>]+aria-label="Traces"[^>]+checked=""/u);
    expect(html).toContain('Retain detailed diagnostic events for querying and debugging. Commentary is always available.');
    expect(html).not.toContain('<strong>Commentary</strong>');
    expect(html).not.toContain('type="radio"');
    expect(html).toContain('<h2 id="permissions-settings-heading">Permissions</h2>');
  });

  it('removes the trace timeline, filters, detail modal, and view preference', () => {
    const mainWorkspace = readFileSync(new URL('../src/renderer/features/sessions/MainSessionWorkspace.tsx', import.meta.url), 'utf8');
    const appModals = readFileSync(new URL('../src/renderer/app/AppModals.tsx', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/renderer/App.tsx', import.meta.url), 'utf8');

    expect(mainWorkspace).not.toContain('TraceView');
    expect(appModals).not.toContain('TraceDetailModal');
    expect(appModals).not.toContain('TraceFilterModal');
    expect(app).not.toContain('useChatViewPreference');
    expect(existsSync(new URL('../src/renderer/features/traces/TraceView.tsx', import.meta.url))).toBe(false);
  });

  it('persists permissions and gates Danger Mode', () => {
    expect(DEFAULT_PERMISSION_SETTINGS).toEqual({
      dangerModeEnabled: false,
      defaultShellSafetyMode: 'auto_review'
    });
    expect(normalizePermissionSettings({
      dangerModeEnabled: false,
      defaultShellSafetyMode: 'danger'
    })).toEqual(DEFAULT_PERMISSION_SETTINGS);

    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };
    const enabledSettings = { dangerModeEnabled: true, defaultShellSafetyMode: 'danger' as const };
    writePermissionSettings(storage, enabledSettings);

    expect(values.has(PERMISSION_SETTINGS_STORAGE_KEY)).toBe(true);
    expect(readPermissionSettings(storage)).toEqual(enabledSettings);
    expect(permissionModeOptions(DEFAULT_PERMISSION_SETTINGS).map(({ value }) => value)).toEqual([
      'manual_approval',
      'auto_review'
    ]);
    expect(permissionModeOptions(enabledSettings).map(({ value }) => value)).toEqual([
      'manual_approval',
      'auto_review',
      'danger'
    ]);
  });
});
