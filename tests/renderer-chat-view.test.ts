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

  it('renders Commentary and Traces choices in General settings', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsView, {
      chatView: 'commentary',
      onChangeChatView: () => undefined,
    }));

    expect(html).toContain('<header class="settings-form-heading"><h2 id="chat-view-settings-heading">Chat View</h2>');
    expect(html).toContain('<fieldset class="settings-form-squircle chat-view-settings" aria-labelledby="chat-view-settings-heading">');
    expect(html.indexOf('settings-form-heading')).toBeLessThan(html.indexOf('settings-form-squircle'));
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="commentary"/);
    expect(html).toContain('<strong>Commentary</strong>');
    expect(html).toContain('value="traces"');
    expect(html).toContain('<strong>Traces</strong>');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const rootStyles = styles.match(/:root\s*\{([^}]*)\}/)?.[1] ?? '';
    const pageStyles = styles.match(/\.general-settings-page\s*\{([^}]*)\}/)?.[1] ?? '';
    const formStyles = styles.match(/\.settings-form\s*\{([^}]*)\}/)?.[1] ?? '';
    const formHeadingStyles = styles.match(/\.settings-form-heading\s*\{([^}]*)\}/)?.[1] ?? '';
    const headingStyles = styles.match(/\.settings-form-heading h2\s*\{([^}]*)\}/)?.[1] ?? '';
    const squircleStyles = styles.match(/\.settings-form-squircle\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionStyles = styles.match(/\.chat-view-option\s*\{([^}]*)\}/)?.[1] ?? '';
    const optionTitleStyles = styles.match(/\.chat-view-option strong\s*\{([^}]*)\}/)?.[1] ?? '';
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
});
