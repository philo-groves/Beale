import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
      activeResearchProfileId: 'security-research',
      busy: false,
      onChangeChatView: () => undefined,
      onSetResearchProfile: async () => undefined
    }));

    expect(html).toContain('<legend>Chat View</legend>');
    expect(html).toMatch(/<input[^>]+checked=""[^>]+value="commentary"/);
    expect(html).toContain('<strong>Commentary</strong>');
    expect(html).toContain('value="traces"');
    expect(html).toContain('<strong>Traces</strong>');
    expect(html).toContain('<legend>Research Profile</legend>');
    expect(html).toContain('<strong>Cybersecurity</strong>');
    expect(html).toContain('<strong>Mathematics</strong>');
  });
});
