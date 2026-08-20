import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WorkspaceService } from '../src/main/workspaceService';
import { resolvedTestResearchProfile } from './researchProfileFixture';

const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('HackerOne workspace import', () => {
  it('uses the default provider model and persists reviewed rules separately from resource scope', async () => {
    const root = mkdtempSync(join(tmpdir(), 'beale-hackerone-import-'));
    createdDirectories.push(root);
    const workspacePath = join(root, 'workspace');
    mkdirSync(workspacePath, { recursive: true });
    const completionCalls: Array<{ provider: string; model: string; prompt: string }> = [];
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(),
      hackerOneFetch: async () => new Response(JSON.stringify({
        data: {
          team: {
            handle: 'example',
            name: 'Example Security',
            url: 'https://hackerone.com/example',
            policy: 'Stop immediately if customer data is encountered.',
            submission_state: 'open',
            structured_scopes: {
              total_count: 2,
              nodes: [{
                asset_type: 'URL',
                asset_identifier: 'api.example.test',
                instruction: 'Production API.',
                eligible_for_bounty: true,
                eligible_for_submission: true,
                max_severity: 'critical'
              }, {
                asset_type: 'SOURCE_CODE',
                asset_identifier: 'https://github.com/example/research-target',
                instruction: 'Public source repository.',
                eligible_for_bounty: true,
                eligible_for_submission: true,
                max_severity: 'high'
              }]
            }
          }
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
      providerTextCompletion: async (request) => {
        completionCalls.push(request);
        return JSON.stringify({
          workspaceName: 'Example Security',
          scopeOwner: 'Example Security',
          rules: [
            'Stop immediately if customer data is encountered.',
            'Report findings privately through HackerOne.'
          ]
        });
      }
    });

    try {
      service.setDefaultProviderId('xai');
      service.setProviderModelDefaults('xai', {
        largeModel: 'grok-4.6',
        smallModel: 'grok-4.3',
        reasoningEffort: 'high'
      });

      const imported = await service.lookupHackerOneScope('example');
      expect(completionCalls).toHaveLength(1);
      expect(completionCalls[0]).toMatchObject({ provider: 'xai', model: 'grok-4.6' });
      expect(completionCalls[0]?.prompt).toContain('"normalizedAssets"');
      expect(imported.rules).toEqual([
        'Stop immediately if customer data is encountered.',
        'Report findings privately through HackerOne.'
      ]);
      expect(imported.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({ direction: 'in_scope', kind: 'domain', value: 'api.example.test' }),
        expect.objectContaining({ direction: 'in_scope', kind: 'repo', value: 'https://github.com/example/research-target' })
      ]));

      const snapshot = service.createScopedWorkspace({
        workspacePath,
        researchKitId: 'hackerone',
        workspaceName: imported.workspaceName,
        researchSubjectName: imported.researchSubjectName,
        scopeOwner: imported.scopeOwner,
        descriptionMarkdown: imported.descriptionMarkdown,
        rules: imported.rules,
        expiresAt: imported.expiresAt,
        assets: [
          ...imported.assets.map((asset) => ({
            ...asset,
            attributes: {
              ...asset.attributes,
              ...(asset.kind === 'repo' ? { clonedDirectory: '/tmp/example-checkout' } : {})
            }
          })),
          {
            direction: 'in_scope',
            kind: 'documentation',
            value: 'https://docs.example.test/manual',
            sensitivity: 'public',
            attributes: { source: 'manual' }
          }
        ]
      });
      expect(snapshot.activeScope.rulesMarkdown).toBe('');
      expect(snapshot.workspace.researchKitId).toBe('hackerone');
      expect(snapshot.workspaceRules.map((rule) => rule.text)).toEqual(imported.rules);
      expect(snapshot.activeScope.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({ direction: 'in_scope', kind: 'domain', value: 'api.example.test' }),
        expect.objectContaining({ kind: 'documentation', value: 'https://docs.example.test/manual' })
      ]));

      const refreshed = await service.refreshResearchKit({ sourceIdentifier: 'example' });
      expect(refreshed).toMatchObject({
        researchKitId: 'hackerone',
        resourcesRefreshed: 2,
        rulesRefreshed: 2,
        guidanceRefreshed: true
      });
      expect(completionCalls).toHaveLength(2);
      expect(refreshed.snapshot.activeScope.assets).toEqual(expect.arrayContaining([
        expect.objectContaining({
          direction: 'in_scope',
          kind: 'repo',
          value: 'https://github.com/example/research-target',
          attributes: expect.objectContaining({
            clonedDirectory: '/tmp/example-checkout',
            researchKitId: 'hackerone',
            researchKitSourceUrl: 'https://hackerone.com/example',
            researchKitRefreshedAt: refreshed.refreshedAt
          })
        }),
        expect.objectContaining({ kind: 'documentation', value: 'https://docs.example.test/manual' })
      ]));
      expect(refreshed.snapshot.workspaceRules.map((rule) => rule.text)).toEqual(imported.rules);
    } finally {
      service.close();
    }
  }, 15_000);
});
