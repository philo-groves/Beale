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
import { resolvedTestResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('memory settings', () => {
  it('defines legacy descriptions and renders the active profile catalog read-only', () => {
    expect(Object.keys(DEFAULT_MEMORY_TYPE_DESCRIPTIONS)).toEqual([...MEMORY_NODE_TYPES]);
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.primitive).toContain('lowercase-hyphenated attributes.rootCauseKey');
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.chain).toContain('source, sink, and asset relationships are ideal');

    const resolved = resolvedTestResearchProfile();
    const html = renderToStaticMarkup(createElement(MemorySettingsView, { researchProfile: {
      id: 'profile_snapshot_test',
      workspaceId: 'workspace_test',
      profileId: resolved.profile.id,
      profileVersion: resolved.profile.version,
      profileHash: resolved.hash,
      source: resolved.source,
      sourcePath: null,
      profile: resolved.profile,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z'
    } }));

    for (const memoryType of resolved.profile.memory.types) {
      expect(html).toContain(`aria-label="${memoryType.name} memory definition"`);
      expect(html).toContain(memoryType.description);
    }
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Edit .honeycrisp/profile.json');
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
