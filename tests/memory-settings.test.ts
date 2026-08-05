import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MEMORY_TYPE_DESCRIPTIONS,
  MEMORY_NODE_TYPES,
  type MemoryTypeDescriptions
} from '../src/shared/types';
import { WorkspaceRegistry } from '../src/main/workspaceRegistry';
import { MemorySettingsView } from '../src/renderer/features/settings/SettingsModal';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('memory settings', () => {
  it('defines and renders an editable description for every Honeycrisp memory type', () => {
    expect(Object.keys(DEFAULT_MEMORY_TYPE_DESCRIPTIONS)).toEqual([...MEMORY_NODE_TYPES]);
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.primitive).toContain('lowercase-hyphenated attributes.rootCauseKey');
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.chain).toContain('source, sink, and asset relationships are ideal');

    const html = renderToStaticMarkup(createElement(MemorySettingsView, {
      settings: { typeDescriptions: { ...DEFAULT_MEMORY_TYPE_DESCRIPTIONS } },
      busy: false,
      onSave: async () => undefined
    }));

    for (const type of MEMORY_NODE_TYPES) {
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      expect(html).toContain(`aria-label="${label} memory description"`);
      expect(html).toContain(DEFAULT_MEMORY_TYPE_DESCRIPTIONS[type]);
    }
  });

  it('persists normalized descriptions and restores them from the global registry', () => {
    const directory = temporaryDirectory();
    const registry = new WorkspaceRegistry(directory);
    const edited: MemoryTypeDescriptions = {
      ...DEFAULT_MEMORY_TYPE_DESCRIPTIONS,
      primitive: '  A proven root-cause flaw with evidence.  '
    };

    expect(registry.getMemorySettings().typeDescriptions).toEqual(DEFAULT_MEMORY_TYPE_DESCRIPTIONS);
    expect(registry.setMemoryTypeDescriptions(edited).typeDescriptions.primitive).toBe('A proven root-cause flaw with evidence.');
    registry.close();

    const reopened = new WorkspaceRegistry(directory);
    expect(reopened.getMemorySettings().typeDescriptions.primitive).toBe('A proven root-cause flaw with evidence.');
    expect(() => reopened.setMemoryTypeDescriptions({
      ...DEFAULT_MEMORY_TYPE_DESCRIPTIONS,
      chain: '   '
    })).toThrow('Memory type chain description cannot be empty.');
    reopened.close();
  });

  it('rejects descriptions whose JSON-escaped transport exceeds the Honeycrisp CLI limit', () => {
    const directory = temporaryDirectory();
    const registry = new WorkspaceRegistry(directory);
    const accepted = repeatedEscapedDescriptions(2_700);
    const rejected = repeatedEscapedDescriptions(3_999);

    expect(JSON.stringify(accepted).length).toBeLessThanOrEqual(64_000);
    expect(registry.setMemoryTypeDescriptions(accepted).typeDescriptions).toEqual(accepted);
    expect(JSON.stringify(rejected).length).toBeGreaterThan(64_000);
    expect(() => registry.setMemoryTypeDescriptions(rejected)).toThrow(
      'Memory type descriptions cannot exceed 64000 serialized JSON characters.'
    );
    registry.close();
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-memory-settings-'));
  createdDirectories.push(directory);
  return directory;
}

function repeatedEscapedDescriptions(length: number): MemoryTypeDescriptions {
  const description = `x${'\n'.repeat(length - 2)}x`;
  return Object.fromEntries(MEMORY_NODE_TYPES.map((type) => [type, description])) as MemoryTypeDescriptions;
}
