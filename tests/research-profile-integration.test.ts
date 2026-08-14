import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeResearchProfileCatalogEnvelope,
  ResearchProfileService,
  resolveHoneycrispProfileInvocation
} from '../src/main/researchProfileService';
import { WorkspaceDatabase } from '../src/main/database';
import { HoneycrispRunEngine, resolveBealeProfileCapabilityCeilings } from '../src/main/honeycrispRunEngine';
import { isResearchProfileMemoryStatusActive, WorkspaceService } from '../src/main/workspaceService';
import { migrateResearchProfile, serializeResearchProfile } from '../src/shared/researchProfile';
import type { ResearchProfile, ResearchProfileModelJob, ResolvedResearchProfile, StartRunInput } from '@shared/types';
import {
  resolvedTestResearchProfile,
  testResearchProfile,
  testResearchProfileCatalogEnvelope
} from './researchProfileFixture';

const directories: string[] = [];

afterEach(() => {
  delete process.env.BEALE_HONEYCRISP_COMMAND;
  delete process.env.BEALE_HONEYCRISP_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_CWD;
  delete process.env.BEALE_HONEYCRISP_ROOT;
  delete process.env.BEALE_HONEYCRISP_NODE_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PNPM_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROFILE_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROFILE_ARGS_JSON;
  delete process.env.BEALE_HONEYCRISP_PROFILE_CWD;
  delete process.env.BEALE_HONEYCRISP_PROFILE_ROOT;
  delete process.env.BEALE_HONEYCRISP_PROFILE_NODE_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROFILE_PNPM_COMMAND;
  delete process.env.BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON;
  delete process.env.BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON;
  delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('research profile host integration', () => {
  it('decodes an additive Honeycrisp catalog envelope and validates protocol, schema, and hash', () => {
    const envelope = { ...testResearchProfileCatalogEnvelope(), additiveField: { accepted: true } };
    const captured: { command?: string; args?: readonly string[] } = {};
    const service = new ResearchProfileService({
      resolveInvocation: () => ({
        command: 'honeycrisp-test',
        prefixArgs: ['cli.js'],
        cwd: 'C:\\honeycrisp',
        configuredBy: 'env_command',
        usesNodeRuntime: true
      }),
      runCommand: (command, args) => {
        captured.command = command;
        captured.args = args;
        return { status: 0, stdout: `runner banner\n${JSON.stringify(envelope)}`, stderr: '' };
      }
    });

    const resolved = service.resolve('C:\\workspace', 'security-research');
    expect(resolved.profile.name).toBe('Security Research');
    expect(captured).toEqual({
      command: 'honeycrisp-test',
      args: ['cli.js', 'profile', 'resolve', '--workspace-root', 'C:\\workspace', '--profile-id', 'security-research', '--json']
    });

    expect(() => decodeResearchProfileCatalogEnvelope({ ...envelope, catalogProtocolVersion: 2 })).toThrow(/catalog protocol/);
    expect(() => decodeResearchProfileCatalogEnvelope({
      ...envelope,
      supportedResearchProfileSchemaVersions: [2]
    })).toThrow(/schema version 1 support/);
    expect(() => decodeResearchProfileCatalogEnvelope({ ...envelope, hash: '0'.repeat(64) })).toThrow(/hash mismatch/);
  });

  it('migrates legacy local catalog profiles before validating the canonical hash', () => {
    const legacyProfile = testResearchProfile() as unknown as Record<string, unknown>;
    delete legacyProfile.schemaVersion;
    delete legacyProfile.modelJobs;
    const capabilities = legacyProfile.capabilities as Record<string, unknown>;
    delete capabilities.selectedSkillIds;
    delete capabilities.disabledSkillIds;
    delete capabilities.allowedMcpServerIds;
    const migratedProfile = migrateResearchProfile(legacyProfile).profile;
    const hash = createHash('sha256')
      .update('honeycrisp:research-profile:v1\0')
      .update(serializeResearchProfile(migratedProfile))
      .digest('hex');

    const decoded = decodeResearchProfileCatalogEnvelope({
      catalogProtocolVersion: 1,
      supportedResearchProfileSchemaVersions: [0],
      profile: legacyProfile,
      hash,
      source: 'explicit',
      path: 'C:\\workspace\\.beale\\profiles\\security.json'
    });

    expect(decoded.resolvedProfile).toMatchObject({
      hash,
      source: 'explicit',
      profile: {
        schemaVersion: 1,
        modelJobs: {},
        capabilities: {
          selectedSkillIds: [],
          disabledSkillIds: [],
          allowedMcpServerIds: []
        }
      }
    });
    expect(() => decodeResearchProfileCatalogEnvelope({
      catalogProtocolVersion: 1,
      supportedResearchProfileSchemaVersions: [0],
      profile: legacyProfile,
      hash: '0'.repeat(64),
      source: 'explicit'
    })).toThrow(/hash mismatch/);
  });

  it('resolves profile catalogs asynchronously in parallel and caches duplicate requests', async () => {
    const securityProfile = testResearchProfile();
    const mathematicsProfile: ResearchProfile = {
      ...testResearchProfile('1.0.0', 'Mathematics'),
      id: 'mathematics'
    };
    let calls = 0;
    let active = 0;
    let maxActive = 0;
    const service = new ResearchProfileService({
      resolveInvocation: () => ({
        command: 'honeycrisp-test',
        prefixArgs: ['cli.js'],
        cwd: 'C:\\honeycrisp',
        configuredBy: 'env_command',
        usesNodeRuntime: true
      }),
      runCommandAsync: async (_command, args) => {
        calls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
        active -= 1;
        const profileId = args[args.indexOf('--profile-id') + 1];
        const profile = profileId === 'mathematics' ? mathematicsProfile : securityProfile;
        return { status: 0, stdout: JSON.stringify(testResearchProfileCatalogEnvelope(profile)), stderr: '' };
      }
    });

    const [security, mathematics, duplicateSecurity] = await Promise.all([
      service.resolveAsync('C:\\workspace', 'security-research'),
      service.resolveAsync('C:\\workspace', 'mathematics'),
      service.resolveAsync('C:\\workspace', 'security-research')
    ]);

    expect([security.profile.id, mathematics.profile.id, duplicateSecurity.profile.id]).toEqual([
      'security-research',
      'mathematics',
      'security-research'
    ]);
    expect(calls).toBe(2);
    expect(maxActive).toBe(2);
    await service.resolveAsync('C:\\workspace', 'security-research');
    expect(calls).toBe(2);
  });

  it('derives active recommendation memory from the profile status catalog', () => {
    const base = generalResearchProfile();
    const profile: ResearchProfile = {
      ...base,
      memory: {
        ...base.memory,
        statuses: [
          { id: 'current', name: 'Current', description: 'Still useful.', order: 10, polarity: 'positive' },
          { id: 'complete', name: 'Complete', description: 'Finished.', order: 20, terminal: true, polarity: 'positive' },
          { id: 'archived', name: 'Archived', description: 'No longer active.', order: 30, terminal: true, polarity: 'neutral' },
          { id: 'discarded', name: 'Discarded', description: 'Invalidated.', order: 40, polarity: 'negative' }
        ],
        types: base.memory.types.map((type) => ({
          ...type,
          defaultStatus: 'current',
          allowedStatuses: ['current', 'complete', 'archived', 'discarded']
        }))
      }
    };

    expect(isResearchProfileMemoryStatusActive(profile, 'current')).toBe(true);
    expect(isResearchProfileMemoryStatusActive(profile, 'complete')).toBe(true);
    expect(isResearchProfileMemoryStatusActive(profile, 'archived')).toBe(false);
    expect(isResearchProfileMemoryStatusActive(profile, 'discarded')).toBe(false);
    expect(isResearchProfileMemoryStatusActive(profile, 'missing')).toBe(false);
  });

  it('keeps profile capabilities inside an explicit Beale-owned ceiling', () => {
    expect(resolveBealeProfileCapabilityCeilings({})).toEqual({
      toolFamilies: ['shell', 'repository-search', 'file-read'],
      sideEffects: ['none', 'read', 'write', 'process']
    });
    expect(resolveBealeProfileCapabilityCeilings({
      BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON: JSON.stringify([
        'repository-search',
        'file-read',
        'analysis'
      ]),
      BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON: JSON.stringify(['none', 'read'])
    })).toEqual({
      toolFamilies: ['repository-search', 'file-read', 'analysis'],
      sideEffects: ['none', 'read']
    });
    expect(() => resolveBealeProfileCapabilityCeilings({
      BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON: JSON.stringify(['unknown-family'])
    })).toThrow(/unsupported capability: unknown-family/);
    expect(() => resolveBealeProfileCapabilityCeilings({
      BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON: JSON.stringify(['network'])
    })).toThrow(/unsupported capability: network/);
  });

  it('keeps run-engine invocation overrides out of canonical profile resolution', () => {
    const unrelatedRoot = temporaryDirectory();
    process.env.BEALE_HONEYCRISP_COMMAND = 'run-only-wrapper';
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify(['run-only.mjs']);
    process.env.BEALE_HONEYCRISP_CWD = unrelatedRoot;
    process.env.BEALE_HONEYCRISP_ROOT = unrelatedRoot;
    process.env.BEALE_HONEYCRISP_NODE_COMMAND = 'run-only-node';
    process.env.BEALE_HONEYCRISP_PNPM_COMMAND = 'run-only-pnpm';

    const siblingRoot = resolve(process.cwd(), '..', 'honeycrisp');
    const siblingCli = join(siblingRoot, 'packages', 'cli', 'dist', 'cli.js');
    expect(existsSync(siblingCli)).toBe(true);

    const invocation = resolveHoneycrispProfileInvocation();
    expect(invocation).toMatchObject({
      prefixArgs: [siblingCli],
      cwd: siblingRoot,
      configuredBy: 'sibling_root',
      usesNodeRuntime: true
    });
    expect(invocation.command).not.toBe('run-only-wrapper');
    expect(invocation.command).not.toBe('run-only-node');
  });

  it('fails closed instead of using run-only invocation overrides when no canonical profile resolver is present', () => {
    const missingRoot = join(temporaryDirectory(), 'missing-honeycrisp');
    process.env.BEALE_HONEYCRISP_COMMAND = 'run-only-wrapper';
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify(['run-only.mjs']);
    process.env.BEALE_HONEYCRISP_CWD = temporaryDirectory();

    expect(() => resolveHoneycrispProfileInvocation({ defaultRoot: missingRoot }))
      .toThrow(/Canonical Honeycrisp profile resolution is unavailable/);
  });

  it('uses an explicitly configured versioned profile resolver without run-only arguments', () => {
    const missingRoot = join(temporaryDirectory(), 'missing-honeycrisp');
    const profileCwd = temporaryDirectory();
    process.env.BEALE_HONEYCRISP_COMMAND = 'run-only-wrapper';
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify(['run-only.mjs']);
    process.env.BEALE_HONEYCRISP_PROFILE_COMMAND = 'packaged-honeycrisp';
    process.env.BEALE_HONEYCRISP_PROFILE_ARGS_JSON = JSON.stringify(['--catalog-protocol', '1']);
    process.env.BEALE_HONEYCRISP_PROFILE_CWD = profileCwd;

    expect(resolveHoneycrispProfileInvocation({ defaultRoot: missingRoot })).toMatchObject({
      command: 'packaged-honeycrisp',
      prefixArgs: ['--catalog-protocol', '1'],
      cwd: profileCwd,
      configuredBy: 'env_command'
    });
  });

  it('uses a changed profile for new runs while continuations retain their original snapshot', async () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const invocationLog = join(root, 'invocations.jsonl');
    const fakeHoneycrisp = join(root, 'fake-honeycrisp.mjs');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(fakeHoneycrisp, fakeHoneycrispSource());
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, invocationLog]);

    const firstProfile = profileWithWorkflow('1.0.0', 'discovery');
    const secondProfileBase = profileWithWorkflow('2.0.0', 'analysis-pass');
    const secondProfile: ResearchProfile = {
      ...secondProfileBase,
      memory: {
        ...secondProfileBase.memory,
        types: secondProfileBase.memory.types.map((type) => ({
          ...type,
          description: 'A durable observation under the second catalog.'
        }))
      }
    };
    let currentProfile: ResolvedResearchProfile = resolvedTestResearchProfile(firstProfile);
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => currentProfile
    });

    try {
      const opened = service.createWorkspace(workspace);
      expect(opened.researchProfile).toMatchObject({ profileVersion: '1.0.0', profileHash: currentProfile.hash });

      const firstStarted = service.startRun(runInput('discovery'));
      const firstRunId = firstStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, firstRunId);
      const firstDetail = service.getRunDetail(firstRunId);
      const firstRun = firstDetail.run;
      const firstCatalogHash = firstDetail.honeycrispMemory?.activeCatalogHash;
      expect(firstRun.researchProfileSnapshotId).toBe(opened.researchProfile.id);
      expect(firstDetail.researchProfile?.profileVersion).toBe('1.0.0');
      expect(firstCatalogHash).toMatch(/^[a-f0-9]{64}$/u);

      currentProfile = resolvedTestResearchProfile(secondProfile, 'workspace-default', join(workspace, '.honeycrisp', 'profile.json'));
      const secondStarted = service.startRun(runInput('analysis-pass'));
      const secondRunId = secondStarted.runs.find((row) => row.run.id !== firstRunId)?.run.id ?? '';
      await waitForRun(service, secondRunId);
      const secondDetail = service.getRunDetail(secondRunId);
      const secondRun = secondDetail.run;
      expect(secondRun.researchProfileSnapshotId).not.toBe(firstRun.researchProfileSnapshotId);
      expect(secondDetail.researchProfile?.profileVersion).toBe('2.0.0');
      expect(secondDetail.honeycrispMemory?.activeCatalogHash).not.toBe(firstCatalogHash);
      expect(service.getRunDetail(firstRunId).honeycrispMemory?.activeCatalogHash).toBe(firstCatalogHash);
      expect(service.getSnapshot()?.researchProfile).toMatchObject({
        profileVersion: '2.0.0',
        profileHash: currentProfile.hash
      });

      const fixture = service.startRun({ ...runInput('analysis-pass'), runEngine: 'fixture' }, 'complete');
      const fixtureRun = fixture.runs.find((row) => row.run.id !== firstRunId && row.run.id !== secondRunId)?.run;
      expect(fixtureRun?.researchProfileSnapshotId).toBe(secondRun.researchProfileSnapshotId);

      service.steerRun({
        type: 'fork',
        runId: firstRunId,
        instruction: 'Fork under the parent research contract.'
      });
      const forkRunId = service.getSnapshot()?.runs.find((row) =>
        row.run.id !== firstRunId
        && row.run.id !== secondRunId
        && row.run.id !== fixtureRun?.id
      )?.run.id ?? '';
      await waitForRun(service, forkRunId);

      service.steerRun({ type: 'steer', runId: firstRunId, instruction: 'Continue with the original research contract.' });
      await waitForInvocationCount(invocationLog, 4);
      await waitForRun(service, firstRunId);

      const invocations = readInvocations(invocationLog);
      expect(invocations.map((invocation) => invocation.profileVersion)).toEqual(['1.0.0', '2.0.0', '1.0.0', '1.0.0']);
      expect(invocations.map((invocation) => invocation.workflow)).toEqual(['discovery', 'analysis-pass', 'discovery', 'discovery']);
      expect(service.getRunDetail(forkRunId).run.researchProfileSnapshotId).toBe(firstRun.researchProfileSnapshotId);
      expect(invocations[0]?.args).toEqual(expect.arrayContaining([
        '--resolved-research-profile',
        '--research-profile-hash',
        '--workflow',
        'discovery'
      ]));
      expect(invocations[0]?.args).toEqual(expect.arrayContaining([
        '--profile-tool-family-ceiling',
        'shell',
        '--profile-tool-family-ceiling',
        'repository-search',
        '--profile-tool-family-ceiling',
        'file-read',
        '--profile-side-effect-ceiling',
        'none',
        '--profile-side-effect-ceiling',
        'read',
        '--profile-side-effect-ceiling',
        'write',
        '--profile-side-effect-ceiling',
        'process'
      ]));
      expect(invocations[0]?.args).not.toContain('--tool-family');
      expect(invocations[0]?.args).toEqual(expect.arrayContaining(['--allowed-side-effect', 'network']));
      expect(invocations[0]?.args).not.toContain('--disable-tool-family');
      expect(invocations[0]?.args).toEqual(expect.arrayContaining([
        '--allow-mcp-server',
        'beale-introspection.beale'
      ]));
      expect(invocations[0]?.args).not.toContain('--skill');
      expect(invocations[0]?.args).not.toContain('--memory-type-descriptions');
      expect(invocations.every((invocation) => existsSync(invocation.profilePath))).toBe(true);

      const detail = service.getRunDetail(firstRunId);
      const launchEvents = detail.traceEvents.filter((event) => event.summary.startsWith('Honeycrisp host process launched'));
      expect(launchEvents).toHaveLength(2);
      const serializedLaunches = JSON.stringify(launchEvents);
      expect(serializedLaunches).not.toContain(resolvedTestResearchProfile(firstProfile).hash);
      expect(serializedLaunches).not.toContain(invocations[0]?.profilePath ?? 'missing-profile-path');
      expect(serializedLaunches).toContain('[profile-hash]');
      expect(serializedLaunches).toContain('[run-local-profile]');
    } finally {
      service.close();
    }
  });

  it('applies a non-security profile to recommendations and context without expanding host tool authority', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'profile-recommendation-test-token';
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const invocationLog = join(root, 'invocations.jsonl');
    const fakeHoneycrisp = join(root, 'fake-honeycrisp.mjs');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(fakeHoneycrisp, fakeHoneycrispSource());
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, invocationLog]);

    let currentProfile = resolvedTestResearchProfile(generalResearchProfile());
    const modelRequests: Record<string, unknown>[] = [];
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => currentProfile,
      researchSubjectResolver: () => ({ id: 'climate-model', name: 'Regional Climate Model' }),
      openAiFetch: async (_url, init) => {
        const request = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        modelRequests.push(request);
        const task = (request.metadata as Record<string, unknown> | undefined)?.beale_task;
        return task === 'research_goal_suggestions'
          ? modelGoalSuggestionResponse(request, [
              'Compare observed rainfall bias across the recorded regional datasets.',
              'Investigate how boundary conditions influence the recorded temperature projections.'
            ], 'resp_general_goals')
          : modelJsonResponse({
              promptMarkdown: '# Comparative literature study\n\nAnalyze the recorded material using the selected synthesis workflow. Compare competing explanations, distinguish observations from inference, preserve uncertainty, and produce the profile-required annotated synthesis with source references.'
            }, 'resp_general_prompt');
      }
    });

    try {
      service.createWorkspace(workspace);
      service.saveScope({
        workspaceName: 'Climate Literature Library',
        scopeOwner: 'Boundary Administrator',
        descriptionMarkdown: 'A collection of local literature and model outputs.',
        rulesMarkdown: 'Use the recorded collection only.',
        expiresAt: null,
        assets: []
      });

      expect(() => service.startRun(runInput('missing-workflow'))).toThrow(/not defined by profile general-research@1\.0\.0/);

      await expect(service.generateResearchGoalSuggestions({ phase: 'literature-synthesis' })).resolves.toEqual({
        phase: 'literature-synthesis',
        suggestions: [
          'Compare observed rainfall bias across the recorded regional datasets.',
          'Investigate how boundary conditions influence the recorded temperature projections.'
        ]
      });
      await expect(service.generateResearchPrompt({
        operation: 'generate',
        researchPhase: 'literature-synthesis',
        mode: 'literature-synthesis',
        attemptStrategy: 'iterative_research',
        model: 'session-model',
        reasoningEffort: 'medium',
        sandboxProfile: 'host'
      })).resolves.toMatchObject({ promptMarkdown: expect.stringContaining('Comparative literature study') });

      const goalRequest = modelRequests.find((request) =>
        (request.metadata as Record<string, unknown> | undefined)?.beale_task === 'research_goal_suggestions'
      );
      const promptRequest = modelRequests.find((request) =>
        (request.metadata as Record<string, unknown> | undefined)?.beale_task === 'research_prompt_recommendation'
      );
      expect(goalRequest).toMatchObject({ model: 'gpt-general-goals', reasoning: { effort: 'low' } });
      expect(promptRequest).toMatchObject({ model: 'gpt-general-prompts', reasoning: { effort: 'high' } });
      expect(String(goalRequest?.instructions)).toContain('You are an interdisciplinary literature researcher.');
      expect(String(goalRequest?.instructions)).toContain('Generate exactly 4 candidates');
      expect(String(goalRequest?.instructions)).toContain('Suggest questions that compare plausible explanations.');
      expect(String(promptRequest?.instructions)).toContain('Separate observations from inference.');
      expect(String(promptRequest?.instructions)).toContain('Produce an annotated synthesis.');
      expect(String(goalRequest?.instructions)).not.toContain('sourceCoverage');
      expect(String(promptRequest?.instructions)).not.toContain('sourceCoverage');
      if (!promptRequest) throw new Error('Expected a prompt recommendation request.');
      if (!goalRequest) throw new Error('Expected a goal suggestion request.');
      const goalPayload = modelRequestPayload(goalRequest);
      const promptPayload = modelRequestPayload(promptRequest);
      expect((goalPayload.coverageHints as Record<string, unknown>).sourceCoverage).toBeNull();
      expect((promptPayload.coverageHints as Record<string, unknown>).sourceCoverage).toBeNull();
      expect(promptPayload.researchProfile).toMatchObject({
        id: 'general-research',
        hash: currentProfile.hash,
        workflow: { id: 'literature-synthesis', goalSuggestionCount: 2 },
        vocabulary: {
          workspaceNoun: 'Library',
          subjectNoun: 'Topic',
          boundaryNoun: 'Collection boundary',
          authorizationMode: 'optional'
        }
      });
      expect(promptPayload.workspace).toMatchObject({
        researchSubject: { id: 'climate-model', name: 'Regional Climate Model' }
      });

      delete process.env.BEALE_OPENAI_ACCESS_TOKEN;
      const started = service.startRun(runInput('literature-synthesis'));
      const runId = started.runs[0]?.run.id ?? '';
      await waitForRun(service, runId);
      const invocation = readInvocations(invocationLog)[0];
      const launchArgs = invocation?.args ?? [];
      expect(invocation?.args).toEqual(expect.arrayContaining([
        '--profile-tool-family-ceiling',
        'shell',
        '--profile-tool-family-ceiling',
        'repository-search',
        '--profile-tool-family-ceiling',
        'file-read',
        '--profile-side-effect-ceiling',
        'none',
        '--profile-side-effect-ceiling',
        'read',
        '--profile-side-effect-ceiling',
        'write',
        '--profile-side-effect-ceiling',
        'process'
      ]));
      expect(invocation?.args).not.toContain('--tool-family');
      expect(invocation?.args).toEqual(expect.arrayContaining(['--allowed-side-effect', 'network']));
      expect(invocation?.args).not.toContain('--skill');
      expect(invocation?.args).toEqual(expect.arrayContaining([
        '--allow-mcp-server',
        'beale-introspection.beale'
      ]));
      expect(invocation?.args).not.toContain('profile-literature-skill');
      expect(invocation?.args).not.toContain('profile-library-mcp');
      expect(launchArgs).not.toContain('--title-model');
      expect(launchArgs).not.toContain('--title-effort');
      const shellReviewModels = JSON.parse(
        launchArgs[launchArgs.indexOf('--shell-review-models') + 1] ?? '{}'
      ) as Record<string, string>;
      expect(shellReviewModels['openai-codex']).toBe('gpt-5.6-luna');
      expect(shellReviewModels.anthropic).toBe('claude-haiku-4-5');
      expect(launchArgs[launchArgs.indexOf('--shell-review-effort') + 1]).toBe('medium');
      const workspaceContext = invocation?.workspaceContext as {
        authorization?: unknown;
        memoryContext?: { subjectId?: string; subjectName?: string };
        projectNotes?: string[];
      } | undefined;
      expect(workspaceContext?.authorization).toMatchObject({
        recorded: true,
        source: 'beale',
        scopeOwner: 'Boundary Administrator'
      });
      expect(workspaceContext?.memoryContext).toMatchObject({
        subjectId: 'climate-model',
        subjectName: 'Regional Climate Model'
      });
      expect(workspaceContext?.projectNotes).toEqual(expect.arrayContaining([
        expect.stringContaining('Library: Climate Literature Library'),
        expect.stringContaining('Topic: Regional Climate Model'),
        expect.stringContaining('Collection boundary instruction: Stay within the recorded collection.')
      ]));
      expect(JSON.stringify(workspaceContext?.projectNotes)).not.toMatch(/authorized security research|Authorization:/i);

      process.env.BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON = JSON.stringify([
        'repository-search',
        'file-read'
      ]);
      process.env.BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON = JSON.stringify(['none', 'read']);
      const configuredStarted = service.startRun(runInput('literature-synthesis'));
      const configuredRunId = configuredStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, configuredRunId);
      const configuredArgs = readInvocations(invocationLog)[1]?.args ?? [];
      expect(configuredArgs).toEqual(expect.arrayContaining([
        '--profile-tool-family-ceiling',
        'repository-search',
        '--profile-tool-family-ceiling',
        'file-read',
        '--profile-side-effect-ceiling',
        'none',
        '--profile-side-effect-ceiling',
        'read'
      ]));
      expect(configuredArgs).not.toContain('code');
      expect(configuredArgs).not.toContain('experiment');
      expect(configuredArgs).toEqual(expect.arrayContaining(['--allowed-side-effect', 'network']));
      delete process.env.BEALE_HONEYCRISP_PROFILE_TOOL_FAMILY_CEILING_JSON;
      delete process.env.BEALE_HONEYCRISP_PROFILE_SIDE_EFFECT_CEILING_JSON;

      const providerMismatchProfile = generalResearchProfile(undefined, 2, '1.1.0');
      currentProfile = resolvedTestResearchProfile({
        ...providerMismatchProfile,
        modelJobs: {
          ...providerMismatchProfile.modelJobs,
          sessionTitle: { provider: 'anthropic', model: 'claude-profile-title', effort: 'low' },
          shellReview: { provider: 'anthropic', model: 'claude-profile-review', effort: 'high' }
        }
      });
      const providerMismatchStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: 'xai'
      });
      const providerMismatchRunId = providerMismatchStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, providerMismatchRunId);
      const providerMismatchArgs = readInvocations(invocationLog)[2]?.args ?? [];
      expect(providerMismatchArgs[providerMismatchArgs.indexOf('--title-model') + 1]).toBe('grok-4.3');
      expect(providerMismatchArgs[providerMismatchArgs.indexOf('--title-effort') + 1]).toBe('medium');
      expect(JSON.parse(
        providerMismatchArgs[providerMismatchArgs.indexOf('--shell-review-models') + 1] ?? '{}'
      )).toMatchObject({ xai: 'grok-4.3', anthropic: 'claude-haiku-4-5' });
      expect(providerMismatchArgs[providerMismatchArgs.indexOf('--shell-review-effort') + 1]).toBe('medium');

      service.saveScope({
        workspaceName: 'Climate Literature Library',
        scopeOwner: 'Boundary Administrator',
        descriptionMarkdown: 'A collection of local literature and model outputs.',
        rulesMarkdown: 'Use only recorded research assets.',
        expiresAt: null,
        assets: [
          { direction: 'in_scope', kind: 'domain', value: 'data.example.test', sensitivity: 'public' },
          { direction: 'in_scope', kind: 'host', value: '192.0.2.15', sensitivity: 'public' },
          { direction: 'in_scope', kind: 'service', value: 'https://catalog.example.test/api', sensitivity: 'public' },
          { direction: 'in_scope', kind: 'repo', value: workspace, sensitivity: 'internal' },
          { direction: 'out_of_scope', kind: 'domain', value: 'excluded.example.test', sensitivity: 'public' }
        ]
      });
      const networkEnabledStarted = service.startRun(runInput('literature-synthesis'));
      const networkEnabledRunId = networkEnabledStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, networkEnabledRunId);
      const networkEnabledInvocation = readInvocations(invocationLog).find((candidate) => candidate.args.includes('network'));
      expect(networkEnabledInvocation?.args).toEqual(expect.arrayContaining(['--allowed-side-effect', 'network']));
      expect(networkEnabledInvocation?.workspaceContext.authorization).not.toHaveProperty('networkProfile');
      expect(networkEnabledInvocation?.workspaceContext.authorization).not.toHaveProperty('allowedNetworkDestinations');
      expect(networkEnabledInvocation?.args).not.toContain('--openai-trusted-access-cyber-risk-acknowledged');

      service.setProviderCyberPolicyRiskAcknowledged('openai-codex', true);
      const openAiStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: 'openai-codex'
      });
      const openAiRunId = openAiStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, openAiRunId);
      const openAiInvocation = readInvocations(invocationLog).filter((candidate) =>
        candidate.args[candidate.args.indexOf('--provider') + 1] === 'openai-codex'
      ).at(-1);
      expect(openAiInvocation?.args).toContain('--openai-trusted-access-cyber-risk-acknowledged');

      const unacknowledgedAnthropicStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: 'anthropic'
      });
      const unacknowledgedAnthropicRunId = unacknowledgedAnthropicStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, unacknowledgedAnthropicRunId);
      const unacknowledgedAnthropicInvocation = readInvocations(invocationLog).filter((candidate) =>
        candidate.args[candidate.args.indexOf('--provider') + 1] === 'anthropic'
      ).at(-1);
      expect(unacknowledgedAnthropicInvocation?.args).not.toContain('--anthropic-cvp-risk-acknowledged');

      service.setProviderCyberPolicyRiskAcknowledged('anthropic', true);
      const anthropicStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: 'anthropic'
      });
      const anthropicRunId = anthropicStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, anthropicRunId);
      const anthropicInvocation = readInvocations(invocationLog).filter((candidate) =>
        candidate.args[candidate.args.indexOf('--provider') + 1] === 'anthropic'
      ).at(-1);
      expect(anthropicInvocation?.args).toContain('--anthropic-cvp-risk-acknowledged');

      service.setProviderCyberPolicyRiskAcknowledged('xai', true);
      const xaiStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: 'xai'
      });
      const xaiRunId = xaiStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, xaiRunId);
      const xaiInvocation = readInvocations(invocationLog).filter((candidate) =>
        candidate.args[candidate.args.indexOf('--provider') + 1] === 'xai'
      ).at(-1);
      expect(xaiInvocation?.args).toContain('--xai-policy-risk-acknowledged');

      service.setDefaultProviderId('xai');
      service.setProviderModelDefaults('xai', {
        largeModel: 'grok-4.6',
        smallModel: 'grok-4.3',
        reasoningEffort: 'high'
      });
      const leadStarted = service.startRun({
        ...runInput('literature-synthesis'),
        provider: undefined,
        model: 'stale-client-model',
        reasoningEffort: 'minimal'
      });
      const leadRunId = leadStarted.runs[0]?.run.id ?? '';
      await waitForRun(service, leadRunId);
      const leadInvocation = readInvocations(invocationLog).filter((candidate) =>
        candidate.args[candidate.args.indexOf('--provider') + 1] === 'xai'
      ).at(-1);
      expect(leadInvocation?.args).toEqual(expect.arrayContaining([
        '--provider', 'xai',
        '--model', 'grok-4.6',
        '--effort', 'high'
      ]));
      service.setDefaultProviderId(null);

      process.env.BEALE_OPENAI_ACCESS_TOKEN = 'profile-recommendation-test-token';
      currentProfile = resolvedTestResearchProfile(generalResearchProfile({ provider: 'anthropic' }, 2, '2.0.0'));
      await expect(service.generateResearchGoalSuggestions({ phase: 'literature-synthesis' }))
        .resolves.toMatchObject({ phase: 'literature-synthesis' });
      currentProfile = resolvedTestResearchProfile(generalResearchProfile(undefined, 13, '3.0.0'));
      await expect(service.generateResearchGoalSuggestions({ phase: 'literature-synthesis' }))
        .rejects.toThrow(/host maximum of 12/);
    } finally {
      service.close();
    }
  });

  it('keeps memory-disabled recommendation jobs isolated from Honeycrisp memory storage and context', async () => {
    process.env.BEALE_OPENAI_ACCESS_TOKEN = 'memory-disabled-recommendation-test-token';
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const baseProfile = generalResearchProfile(undefined, 2, 'memory-disabled');
    const profile: ResearchProfile = {
      ...baseProfile,
      capabilities: {
        ...baseProfile.capabilities,
        memoryEnabled: false
      }
    };
    const modelRequests: Record<string, unknown>[] = [];
    const databasePath = join(root, 'memory.sqlite');
    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: databasePath,
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(profile),
      openAiFetch: async (_url, init) => {
        const request = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
        modelRequests.push(request);
        const task = (request.metadata as Record<string, unknown> | undefined)?.beale_task;
        return task === 'research_goal_suggestions'
          ? modelGoalSuggestionResponse(request, [
              'Compare the recorded methodology assumptions across the bounded collection.',
              'Investigate how sampling choices affect the recorded cross-study conclusions.'
            ], 'resp_memory_disabled_goals')
          : modelJsonResponse({
              promptMarkdown: '# Bounded synthesis\n\nCompare the available studies under the selected workflow, distinguish observations from inference, preserve uncertainty, and produce an annotated synthesis.'
            }, 'resp_memory_disabled_prompt');
      }
    });

    try {
      service.createWorkspace(workspace);
      service.startRun({ ...runInput('literature-synthesis'), runEngine: 'fixture' }, 'complete');

      // Any accidental recommendation-path memory read now fails on the deliberately incompatible table.
      const memoryDatabase = new DatabaseSync(databasePath);
      try {
        memoryDatabase.exec('CREATE TABLE memory_nodes (broken TEXT)');
      } finally {
        memoryDatabase.close();
      }

      await expect(service.generateResearchGoalSuggestions({ phase: 'literature-synthesis' }))
        .resolves.toMatchObject({ phase: 'literature-synthesis' });
      await expect(service.generateResearchPrompt({
        operation: 'generate',
        researchPhase: 'literature-synthesis',
        mode: 'literature-synthesis',
        attemptStrategy: 'iterative_research',
        model: 'session-model',
        reasoningEffort: 'medium',
        sandboxProfile: 'host'
      })).resolves.toMatchObject({ promptMarkdown: expect.stringContaining('Bounded synthesis') });

      expect(modelRequests).toHaveLength(2);
      for (const request of modelRequests) {
        expect(String(request.instructions)).not.toMatch(/Honeycrisp memory|recorded memories|active memory/i);
        const payload = modelRequestPayload(request);
        const coverageHints = payload.coverageHints as Record<string, unknown>;
        expect(coverageHints).not.toHaveProperty('activeMemoryNodes');
        expect(coverageHints).not.toHaveProperty('recentMemoryEvidenceRefs');
        expect((payload.researchProfile as { presentation?: Record<string, unknown> }).presentation)
          .not.toHaveProperty('memoryLabel');
        const previousResearch = payload.previousResearch as Record<string, unknown>[];
        expect(previousResearch.length).toBeGreaterThan(0);
        for (const previous of previousResearch) {
          expect(previous).not.toHaveProperty('memoryNodes');
          for (const contract of (previous.verifierContracts as Record<string, unknown>[])) {
            expect(contract).not.toHaveProperty('memoryNodeId');
          }
        }
      }
    } finally {
      service.close();
    }
  });

  it.each([
    {
      name: 'a missing capture profile',
      captureOptions: { omitResearchProfile: true },
      expectedError: /missing the research profile pinned to run/
    },
    {
      name: 'a capture profile with a corrupt snapshot hash',
      captureOptions: { corruptResearchProfileHash: true },
      expectedError: /research profile hash mismatch/
    },
    {
      name: 'a self-valid capture profile that differs from the pinned snapshot',
      captureOptions: {
        researchProfileOverride: {
          ...resolvedTestResearchProfile(profileWithWorkflow('9.0.0', 'discovery')),
          workflowId: 'discovery'
        }
      },
      expectedError: /does not match the profile and workflow pinned to run/
    },
    {
      name: 'a self-valid capture workflow that differs from the pinned workflow',
      captureOptions: {
        researchProfileOverride: {
          ...resolvedTestResearchProfile(testResearchProfile()),
          workflowId: 'chaining'
        }
      },
      expectedError: /does not match the profile and workflow pinned to run/
    }
  ])('rejects $name before importing capture artifacts', async ({ captureOptions, expectedError }) => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    const invocationLog = join(root, 'invocations.jsonl');
    const fakeHoneycrisp = join(root, 'fake-honeycrisp.mjs');
    mkdirSync(workspace, { recursive: true });
    writeFileSync(fakeHoneycrisp, fakeHoneycrispSource(captureOptions));
    process.env.BEALE_HONEYCRISP_COMMAND = process.execPath;
    process.env.BEALE_HONEYCRISP_ARGS_JSON = JSON.stringify([fakeHoneycrisp, invocationLog]);

    const service = new WorkspaceService(() => undefined, {
      workspaceRegistryDirectory: join(root, 'registry'),
      honeycrispDatabasePath: join(root, 'memory.sqlite'),
      honeycrispArtifactDirectory: join(root, 'artifacts'),
      researchProfileResolver: () => resolvedTestResearchProfile(testResearchProfile())
    });
    try {
      service.createWorkspace(workspace);
      const started = service.startRun(runInput('discovery'));
      const runId = started.runs[0]?.run.id ?? '';
      await waitForCondition(() => service.getRunDetail(runId).run.status === 'failed');

      const detail = service.getRunDetail(runId);
      const importFailure = detail.traceEvents.find((event) =>
        event.summary === 'Honeycrisp run completed but Beale could not import the capture.'
      );
      expect(String((importFailure?.payload as { error?: unknown } | undefined)?.error)).toMatch(expectedError);
      expect(detail.artifacts.some((artifact) => artifact.kind === 'honeycrisp_flow_capture')).toBe(false);
      expect(detail.traceEvents.some((event) =>
        event.summary === 'Honeycrisp flow capture preserved as a Beale artifact.'
      )).toBe(false);
      expect(detail.transcriptMessages.some((message) => message.source === 'honeycrisp')).toBe(false);
    } finally {
      service.close();
    }
  });

  it('blocks continuation of legacy runs without pinned research profile provenance', () => {
    const root = temporaryDirectory();
    const workspace = join(root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const database = new WorkspaceDatabase(join(root, 'memory.sqlite'), join(root, 'artifacts'), { workspacePath: workspace });
    database.initialize();
    const legacy = database.createRun({
      scopeVersionId: database.getActiveScope().id,
      title: 'Legacy research run',
      promptMarkdown: 'Legacy prompt.',
      shellSafetyMode: 'auto_review',
      mode: 'open_discovery',
      model: 'fixture-model',
      reasoningEffort: 'minimal',
      attemptStrategy: 'iterative_research',
      sandboxProfile: 'host',
      budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0, runEngine: 'honeycrisp' }
    });
    const engine = new HoneycrispRunEngine(database, workspace);
    try {
      expect(() => engine.extendRun(legacy.run.id, 'Continue.')).toThrow(/no pinned research profile snapshot/);
    } finally {
      engine.dispose();
      database.close();
    }
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'beale-profile-integration-'));
  directories.push(directory);
  return directory;
}

function profileWithWorkflow(version: string, workflowId: string): ResearchProfile {
  const base = testResearchProfile(version, `Profile ${version}`);
  return {
    ...base,
    workflows: [{
      ...base.workflows[0]!,
      id: workflowId,
      name: workflowId === 'discovery' ? 'Discovery' : 'Analysis Pass',
      default: true
    }],
    capabilities: {
      ...base.capabilities,
      defaultToolFamilies: ['shell', 'code'],
      disabledToolFamilies: ['analysis'],
      allowedSideEffects: ['read', 'write', 'network'],
      selectedSkillIds: ['profile-skill'],
      allowedMcpServerIds: ['local']
    }
  };
}

function generalResearchProfile(
  goalSuggestionsJob: ResearchProfileModelJob = {
    provider: 'openai-codex',
    model: 'gpt-general-goals',
    effort: 'low'
  },
  suggestionCount = 2,
  version = '1.0.0'
): ResearchProfile {
  const base = testResearchProfile(version, 'General Research');
  return {
    ...base,
    id: 'general-research',
    description: 'A general literature and evidence synthesis profile.',
    agent: {
      role: 'You are an interdisciplinary literature researcher.',
      posture: ['Compare plausible explanations before drawing conclusions.'],
      style: ['Use precise, neutral language.'],
      memoryInstructions: ['Retain durable observations and citations.'],
      runbookInstructions: ['Keep repeatable synthesis methods.']
    },
    workflows: [{
      id: 'literature-synthesis',
      name: 'Literature Synthesis',
      description: 'Compare recorded literature and evidence around a bounded topic.',
      goalSuggestionCount: suggestionCount,
      goalSuggestionInstructions: ['Suggest questions that compare plausible explanations.'],
      promptInstructions: ['Separate observations from inference.'],
      outputRequirements: ['Produce an annotated synthesis.'],
      default: true
    }],
    capabilities: {
      ...base.capabilities,
      selectedSkillIds: ['profile-literature-skill'],
      allowedMcpServerIds: ['profile-library-mcp']
    },
    workspace: {
      workspaceNoun: 'Library',
      subjectNoun: 'Topic',
      boundaryNoun: 'Collection boundary',
      authorizationMode: 'optional',
      boundaryInstructions: ['Stay within the recorded collection.'],
      materialKinds: ['literature', 'dataset']
    },
    modelJobs: {
      goalSuggestions: goalSuggestionsJob,
      promptGeneration: {
        provider: 'openai',
        model: 'gpt-general-prompts',
        effort: 'high'
      },
      sessionTitle: {
        provider: 'openai-codex',
        model: 'gpt-general-title',
        effort: 'low'
      },
      shellReview: {
        provider: 'openai-codex',
        model: 'gpt-general-shell-review',
        effort: 'high'
      }
    },
    presentation: {
      newResearchLabel: 'New Study',
      memoryLabel: 'Memory',
      runbookLabel: 'Runbooks',
      sessionLabel: 'Study Session'
    }
  };
}

function runInput(workflowId: string): StartRunInput {
  return {
    runEngine: 'honeycrisp',
    provider: 'openai-codex',
    shellSafetyMode: 'auto_review',
    goalEnabled: false,
    goalObjective: null,
    promptMarkdown: `Research using ${workflowId}.`,
    workflowId,
    mode: 'dynamic_research',
    attemptStrategy: 'iterative_research',
    model: 'fixture-model',
    reasoningEffort: 'minimal',
    sandboxProfile: 'host',
    budget: { maxMinutes: 5, maxAttempts: 1, maxCostUsd: 0 }
  };
}

interface FakeHoneycrispCaptureOptions {
  omitResearchProfile?: boolean;
  corruptResearchProfileHash?: boolean;
  researchProfileOverride?: ResolvedResearchProfile & { workflowId: string };
}

function fakeHoneycrispSource(options: FakeHoneycrispCaptureOptions = {}): string {
  const profileOverride = options.researchProfileOverride
    ? {
        schemaVersion: options.researchProfileOverride.profile.schemaVersion,
        id: options.researchProfileOverride.profile.id,
        version: options.researchProfileOverride.profile.version,
        hash: options.researchProfileOverride.hash,
        source: options.researchProfileOverride.source,
        ...(options.researchProfileOverride.path ? { path: options.researchProfileOverride.path } : {}),
        workflowId: options.researchProfileOverride.workflowId,
        snapshot: options.researchProfileOverride.profile
      }
    : null;
  return [
    "import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { dirname } from 'node:path';",
    'const [logPath, ...args] = process.argv.slice(2);',
    "const value = (flag) => args[args.indexOf(flag) + 1];",
    "const capturePath = value('--capture');",
    "const profilePath = value('--resolved-research-profile');",
    "const profileHash = value('--research-profile-hash');",
    "const workflow = value('--workflow');",
    "const workspaceContextPath = value('--workspace-context');",
    "const profile = JSON.parse(readFileSync(profilePath, 'utf8'));",
    "const workspaceContext = JSON.parse(readFileSync(workspaceContextPath, 'utf8'));",
    `const profileOverride = ${JSON.stringify(profileOverride)};`,
    `const omitResearchProfile = ${JSON.stringify(Boolean(options.omitResearchProfile))};`,
    `const corruptResearchProfileHash = ${JSON.stringify(Boolean(options.corruptResearchProfileHash))};`,
    'appendFileSync(logPath, JSON.stringify({ args, profilePath, profileHash, profileVersion: profile.version, workflow, workspaceContextPath, workspaceContext }) + "\\n");',
    'mkdirSync(dirname(capturePath), { recursive: true });',
    'const now = new Date().toISOString();',
    "const captureResearchProfile = profileOverride ?? { schemaVersion: profile.schemaVersion, id: profile.id, version: profile.version, hash: profileHash, source: 'bundled-default', workflowId: workflow, snapshot: profile };",
    "if (corruptResearchProfileHash) captureResearchProfile.hash = '0'.repeat(64);",
    "const capture = { schemaVersion: 5, capturedAt: now, request: { prompt: value('-p') }, ...(!omitResearchProfile ? { researchProfile: captureResearchProfile } : {}), agent: { id: 'agent_profile_fixture', status: 'complete', executorName: 'profile-fixture', startedAt: now, completedAt: now, outputText: 'Profile fixture complete.' }, eventTimeline: [] };",
    "writeFileSync(capturePath, JSON.stringify(capture) + '\\n');"
  ].join('\n');
}

interface LoggedInvocation {
  args: string[];
  profilePath: string;
  profileHash: string;
  profileVersion: string;
  workflow: string;
  workspaceContextPath: string;
  workspaceContext: Record<string, unknown>;
}

function readInvocations(path: string): LoggedInvocation[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LoggedInvocation);
}

function modelRequestPayload(request: Record<string, unknown>): Record<string, unknown> {
  const input = request.input as Array<{ content: Array<{ text: string }> }>;
  return JSON.parse(input[0]?.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function modelJsonResponse(value: unknown, id: string): Response {
  const event = (name: string, data: Record<string, unknown>) =>
    `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        event('response.output_text.done', { type: 'response.output_text.done', text: JSON.stringify(value) }) +
        event('response.completed', { type: 'response.completed', response: { id } })
      ));
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function modelGoalSuggestionResponse(
  request: Record<string, unknown>,
  suggestions: readonly string[],
  id: string
): Response {
  const payload = modelRequestPayload(request);
  const candidateCount = Number(payload.candidateCount);
  return modelJsonResponse({
    candidates: Array.from({ length: candidateCount }, (_, index) => ({
      goal: suggestions[index % suggestions.length],
      groundingRefs: ['workspace:scope'],
      rationale: 'The recorded collection makes this a bounded and discriminating research direction.',
      noveltyAxis: `candidate-${index + 1}`
    }))
  }, id);
}

async function waitForInvocationCount(path: string, count: number): Promise<void> {
  await waitForCondition(() => readInvocations(path).length >= count);
}

async function waitForRun(service: WorkspaceService, runId: string): Promise<void> {
  await waitForCondition(() => service.getRunDetail(runId).run.status === 'completed');
}

async function waitForCondition(check: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  expect(check()).toBe(true);
}
