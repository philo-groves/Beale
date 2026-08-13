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
import { ProfileSettingsView } from '../src/renderer/features/settings/SettingsModal';
import { resolvedTestResearchProfile, testResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('memory settings', () => {
  it('renders profile and memory-type tabs with an expanded session-heat view', () => {
    expect(Object.keys(DEFAULT_MEMORY_TYPE_DESCRIPTIONS)).toEqual([...MEMORY_NODE_TYPES]);
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.primitive).toContain('lowercase-hyphenated attributes.rootCauseKey');
    expect(DEFAULT_MEMORY_TYPE_DESCRIPTIONS.chain).toContain('source, sink, and asset relationships are ideal');

    const resolved = resolvedTestResearchProfile();
    const mathematics = resolvedTestResearchProfile({
      ...testResearchProfile('1.0.0', 'Mathematics'),
      id: 'mathematics',
      description: 'Test mathematics profile.'
    });
    const html = renderToStaticMarkup(createElement(ProfileSettingsView, {
      researchProfiles: [resolved, mathematics],
      researchProfile: {
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
      },
      loading: false
    }));

    expect(html.match(/role="tablist"/gu)).toHaveLength(2);
    expect(html.match(/profile-settings-tab-row research-side-view-tabs research-side-view-tabs-scrollable/gu)).toHaveLength(2);
    const profileTabsIndex = html.indexOf('aria-label="Research profiles"');
    const profileDescriptionIndex = html.indexOf(resolved.profile.description);
    const memoryTabsIndex = html.indexOf('aria-label="Cybersecurity memory types"');
    expect(html).toContain('aria-label="Research profiles"');
    expect(html).toContain('class="research-side-view-tab provider-settings-tab profile-settings-tab active"');
    expect(html).toContain('<span>Cybersecurity</span></button>');
    expect(html).toContain('<span>Mathematics</span></button>');
    expect(html).toContain('aria-label="Cybersecurity memory types"');
    expect(html).toContain('<span>Finding</span></button>');
    expect(html).toContain('aria-label="Finding memory definition"');
    expect(html).toContain(resolved.profile.memory.types[0]!.description);
    expect(html).toContain('class="profile-memory-type-view"');
    expect(html).toContain('<h4>Session Heat</h4>');
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Finding confirmed session heat');
    expect(html).toContain('Profile default · High');
    expect(profileTabsIndex).toBeLessThan(profileDescriptionIndex);
    expect(profileDescriptionIndex).toBeLessThan(memoryTabsIndex);
    expect(html).not.toContain('Resolved from');
    expect(html).not.toContain('Bundled Cybersecurity profile');
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
