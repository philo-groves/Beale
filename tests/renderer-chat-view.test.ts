import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GeneralSettingsView } from '../src/renderer/features/settings/SettingsModal';
import {
  CHAT_VIEW_STORAGE_KEY,
  DEFAULT_CHAT_VIEW,
  normalizeChatView,
  readChatViewPreference,
  writeChatViewPreference
} from '../src/renderer/view-models/chatView';
import {
  DEFAULT_PERMISSION_SETTINGS,
  PERMISSION_SETTINGS_STORAGE_KEY,
  normalizePermissionSettings,
  permissionModeOptions,
  readPermissionSettings,
  writePermissionSettings
} from '../src/renderer/view-models/permissionSettings';

describe('renderer Chat View preference', () => {
  it('defaults missing and invalid values to Commentary', () => {
    expect(DEFAULT_CHAT_VIEW).toBe('commentary');
    expect(normalizeChatView(null)).toBe('commentary');
    expect(normalizeChatView('events')).toBe('commentary');
  });

  it('restores and writes the Traces preference', () => {
    const values = new Map<string, string>([[CHAT_VIEW_STORAGE_KEY, 'traces']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    };

    expect(readChatViewPreference(storage)).toBe('traces');
    writeChatViewPreference(storage, 'commentary');
    expect(values.get(CHAT_VIEW_STORAGE_KEY)).toBe('commentary');
  });

  it('keeps storage failures from blocking the default view', () => {
    expect(readChatViewPreference({ getItem: () => { throw new Error('unavailable'); } })).toBe('commentary');
    expect(() => writeChatViewPreference({ setItem: () => { throw new Error('unavailable'); } }, 'traces')).not.toThrow();
  });

  it('renders Session View and Permissions forms in General settings', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsView, {
      chatView: 'commentary',
      dangerModeEnabled: false,
      defaultShellSafetyMode: 'auto_review',
      onChangeChatView: () => undefined,
      onChangeDangerModeEnabled: () => undefined,
      onChangeDefaultShellSafetyMode: () => undefined
    }));

    expect(html).toContain('<header class="settings-form-heading"><h2 id="chat-view-settings-heading">Session View</h2>');
    expect(html).toContain('<fieldset class="settings-form-squircle chat-view-settings" aria-labelledby="chat-view-settings-heading">');
    expect(html.indexOf('settings-form-heading')).toBeLessThan(html.indexOf('settings-form-squircle'));
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="commentary"/);
    expect(html).toContain('<strong>Commentary</strong>');
    expect(html).toContain('value="traces"');
    expect(html).toContain('<strong>Traces</strong>');
    expect(html).toContain('<h2 id="permissions-settings-heading">Permissions</h2>');
    expect(html).toContain('<strong>Enable Danger Mode</strong>');
    expect(html).toContain('aria-label="Enable Danger Mode" type="checkbox"');
    expect(html).toContain('<strong>Default Permissions</strong>');
    expect(html).toContain('<option value="auto_review" selected="">Auto-Review</option>');
    expect(html).not.toContain('<option value="danger">Danger Mode</option>');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const rootStyles = styles.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const pageStyles = styles.match(/\.general-settings-page\s*\{([^}]*)\}/)?.[1] ?? '';
    const formStyles = styles.match(/\.settings-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const formHeadingStyles = styles.match(/\.settings-form-heading\s*\{([^}]*)\}/)?.[1] ?? '';
    const headingStyles = styles.match(/\.settings-form-heading h2\s*\{([^}]*)\}/)?.[1] ?? '';
    const squircleStyles = styles.match(/\.settings-form-squircle\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionStyles = styles.match(/\.chat-view-option,\s*\.settings-form-control-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionTitleStyles = styles.match(/\.chat-view-option strong,\s*\.settings-form-control-row strong\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rootStyles).toContain('--session-content-max-width: 750px');
    expect(pageStyles).toContain('max-width: var(--session-content-max-width)');
    expect(pageStyles).toContain('margin-inline: auto');
    expect(formStyles).toContain('--settings-form-inline-padding: 14px');
    expect(formStyles).toContain('font-size: var(--steer-control-font-size, 13px)');
    expect(formStyles).toContain('font-weight: 400');
    expect(formHeadingStyles).toContain('padding: var(--settings-form-inline-padding)');
    expect(headingStyles).toContain('font-size: 2em');
    expect(headingStyles).toContain('font-weight: 400');
    expect(squircleStyles).toContain('corner-shape: squircle');
    expect(squircleStyles).toContain('background: var(--panel-raised)');
    expect(squircleStyles).toContain('padding: 3px var(--settings-form-inline-padding)');
    expect(optionStyles).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(optionStyles).toContain('padding: 10px 0');
    expect(optionTitleStyles).toContain('font-size: inherit');
    expect(optionTitleStyles).toContain('font-weight: 400');
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

    const enabledHtml = renderToStaticMarkup(createElement(GeneralSettingsView, {
      chatView: 'commentary',
      dangerModeEnabled: true,
      defaultShellSafetyMode: 'danger',
      onChangeChatView: () => undefined,
      onChangeDangerModeEnabled: () => undefined,
      onChangeDefaultShellSafetyMode: () => undefined
    }));
    expect(enabledHtml).toContain('<option value="danger" selected="">Danger Mode</option>');
  });
});
