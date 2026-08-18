import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
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
import { MemoryTypeSettingsView, ProfileSettingsView } from '../src/renderer/features/settings/SettingsModal';
import { resolvedTestResearchProfile, testResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('memory settings', () => {
  it('renders profile views with Overview selected before the memory-type tabs', () => {
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
    expect(html.match(/profile-settings-tab-row(?: profile-settings-view-tab-row)? research-side-view-tabs research-side-view-tabs-scrollable/gu)).toHaveLength(2);
    const profileTabsIndex = html.indexOf('aria-label="Research profiles"');
    const profileViewsIndex = html.indexOf('aria-label="Security profile views"');
    const profileDescriptionIndex = html.indexOf(resolved.profile.description);
    expect(html).toContain('aria-label="Research profiles"');
    expect(html).toContain('class="research-side-view-tab provider-settings-tab profile-settings-tab active"');
    expect(html).toContain('<span>Security</span></button>');
    expect(html).toContain('<span>Mathematics</span></button>');
    expect(html).toContain('aria-label="Security profile views"');
    expect(html).toContain('<span>Overview</span></button>');
    expect(html).toContain('<span>Finding</span></button>');
    expect(html).toContain('class="profile-overview-view"');
    expect(html).toContain('<h2 id="profile-basic-details-heading">Security</h2>');
    expect(html).toContain('aria-label="Profile Name" value="Security"');
    expect(html).toContain(`aria-label="Profile Description">${resolved.profile.description}</textarea>`);
    expect(html).not.toContain('aria-label="Finding memory definition"');
    expect(html).not.toContain('class="profile-memory-type-view"');
    expect(html).toContain(`aria-label="${resolved.profile.name} session heat colors"`);
    expect(html).toContain('>Cream</button>');
    expect(html).toContain('>Midnight</button>');
    expect(profileTabsIndex).toBeLessThan(profileDescriptionIndex);
    expect(profileTabsIndex).toBeLessThan(profileViewsIndex);
    expect(profileViewsIndex).toBeLessThan(profileDescriptionIndex);
    expect(html).not.toContain('Resolved from');
    expect(html).not.toContain('Bundled Cybersecurity profile');

    const styles = readFileSync(new URL('../src/renderer/styles.css', import.meta.url), 'utf8');
    const viewTabRowStyles = styles.match(/\.profile-settings-view-tab-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const tabButtonStyles = styles.match(/\.profile-settings-tab \.research-side-view-tab-activate\s*\{([^}]*)\}/)?.[1] ?? '';
    const descriptionRowStyles =
      styles.match(/\.profile-basic-details-form \.profile-basic-details-description-row\s*\{([^}]*)\}/)?.[1] ?? '';
    const profilePageStyles = styles.match(/\.profile-settings-page\s*\{([^}]*)\}/)?.[1] ?? '';
    const profileFormStyles = styles.match(/\.general-settings-page \.settings-form,\s*\.profile-settings-page \.settings-form\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(viewTabRowStyles).toContain('padding-inline: 0');
    expect(tabButtonStyles).toContain('padding: 0 9px');
    expect(descriptionRowStyles).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(profilePageStyles).toContain('--settings-view-font-size: 14px');
    expect(profilePageStyles).toContain('--profile-settings-font-size: var(--settings-view-font-size)');
    expect(profileFormStyles).toContain('font-size: var(--settings-view-font-size)');
  });

  it('renders memory types as details, possible states, and session heat forms', () => {
    const profile = testResearchProfile();
    const memoryType = profile.memory.types[0]!;
    const html = renderToStaticMarkup(createElement(MemoryTypeSettingsView, {
      id: 'memory-type-panel',
      labelledBy: 'memory-type-tab',
      profile,
      memoryType
    }));

    expect(html).toContain('<h2 id="profile-memory-details-heading">Finding</h2>');
    expect(html).toContain('aria-label="Memory Type Name" value="Finding"');
    expect(html).toContain(`aria-label="Memory Type Description">${memoryType.description}</textarea>`);
    expect(html).toMatch(/aria-label="Immutable Memory Type ID"[^>]*disabled=""[^>]*value="finding"/u);
    expect(html).toContain('<h2 id="profile-memory-states-heading">Possible States</h2>');
    expect(html).toContain('>Draft</strong><small>Not established.</small>');
    expect(html).toContain('>Confirmed</strong><small>Evidence-backed.</small>');
    expect(html).toContain('aria-label="Allow Draft" checked=""');
    expect(html).toContain('aria-label="Allow Confirmed" checked=""');
    expect(html).toContain('<h2 id="profile-memory-heat-heading">Session Heat</h2>');
    expect(html.match(/class="profile-memory-heat-preview"/gu)).toHaveLength(4);
    expect(html.match(/heat trigger states: Any State/gu)).toHaveLength(4);
    expect(html.match(/<span>Any State<\/span>/gu)).toHaveLength(8);
    expect(html).toContain('aria-label="Low heat trigger states: Any State" aria-disabled="true" tabindex="-1"');
    expect(html).toContain('aria-label="High heat trigger states: Any State" aria-disabled="false"');
    expect(html).toMatch(/data-heat-level="high"[\s\S]*?class="profile-memory-heat-state-picker"[\s\S]*?aria-label="Enable High session heat"/u);
    expect(html).toContain('aria-label="Enable High session heat" checked=""');
    expect(html).toContain('aria-label="Enable Low session heat"');
    expect(html).not.toContain('type="color"');
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
