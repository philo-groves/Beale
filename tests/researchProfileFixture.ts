import { createHash } from 'node:crypto';
import { serializeResearchProfile } from '../src/shared/researchProfile';
import type { ResearchProfile, ResolvedResearchProfile } from '@shared/types';

export function testResearchProfile(version = '1.0.0', name = 'Security'): ResearchProfile {
  return {
    schemaVersion: 1,
    id: 'security-research',
    version,
    name,
    description: 'Test research profile.',
    agent: {
      role: 'You are a world-class security researcher with exceptional judgment.',
      posture: ['Be precise.'],
      style: ['Be concise.'],
      memoryInstructions: ['Save durable findings.'],
      runbookInstructions: ['Keep procedures reproducible.'],
      reportInstructions: ['Write evidence-backed reports for triagers.']
    },
    memory: {
      types: [{
        id: 'finding',
        name: 'Finding',
        pluralName: 'Findings',
        description: 'A durable finding.',
        lifecycle: 'active',
        creatable: true,
        order: 10,
        defaultStatus: 'draft',
        allowedStatuses: ['draft', 'confirmed'],
        sessionHeat: { confirmed: 'high' }
      }],
      statuses: [
        { id: 'draft', name: 'Draft', description: 'Not established.', order: 10, polarity: 'neutral' },
        { id: 'confirmed', name: 'Confirmed', description: 'Evidence-backed.', order: 20, terminal: true, polarity: 'positive' }
      ],
      evidenceKinds: [{ id: 'artifact', name: 'Artifact', description: 'A durable artifact.', allowsPath: true }],
      evidencePathBases: [{
        id: 'workspace',
        name: 'Workspace',
        description: 'Relative to the workspace.',
        pathFormat: 'relative'
      }],
      relations: [{ id: 'supports', name: 'Supports', description: 'Supports another finding.' }]
    },
    workflows: [
      {
        id: 'discovery',
        name: 'Discovery',
        description: 'Explore a bounded subject.',
        goalSuggestionCount: 4,
        goalSuggestionInstructions: ['Generate Discovery goals that explore a bounded subject without assuming a flaw exists.'],
        promptInstructions: ['Keep research open-ended.'],
        outputRequirements: ['Support conclusions with evidence.'],
        default: true
      },
      {
        id: 'chaining',
        name: 'Chaining',
        description: 'Develop recorded primitives into supported chains.',
        goalSuggestionCount: 4,
        goalSuggestionInstructions: ['Generate Chaining goals grounded in recorded primitives.'],
        promptInstructions: ['Investigate missing chain links without inventing evidence.'],
        outputRequirements: ['Support the resulting chain with evidence.']
      },
      {
        id: 'reporting',
        name: 'Reporting',
        description: 'Document supported conclusions and their limitations.',
        goalSuggestionCount: 4,
        goalSuggestionInstructions: ['Generate Reporting goals grounded in supported conclusions.'],
        promptInstructions: ['Preserve material evidence limitations.'],
        outputRequirements: ['Produce an evidence-backed report.']
      }
    ],
    collaboration: { protocolInstructions: [], recipes: [] },
    capabilities: {
      defaultToolFamilies: ['shell'],
      disabledToolFamilies: [],
      allowedSideEffects: ['none', 'read', 'write', 'process'],
      selectedSkillIds: [],
      disabledSkillIds: [],
      allowedMcpServerIds: [],
      memoryEnabled: true,
      runbooksEnabled: true,
      reportsEnabled: true,
      collaborationEnabled: true
    },
    workspace: {
      workspaceNoun: 'Research workspace',
      subjectNoun: 'Subject',
      boundaryNoun: 'Boundary',
      authorizationMode: 'required_for_live_network',
      boundaryInstructions: ['Respect the recorded boundary.'],
      materialKinds: ['repository']
    },
    modelJobs: {},
    presentation: {
      newResearchLabel: 'New research',
      memoryLabel: 'Memory',
      runbookLabel: 'Runbooks',
      sessionLabel: 'Session',
      sessionHeatPalette: {
        low: '#45b8d8',
        medium: '#4f87e8',
        high: '#7768e8',
        critical: '#b14ee8'
      }
    }
  };
}

export function resolvedTestResearchProfile(
  profile: ResearchProfile = testResearchProfile(),
  source: ResolvedResearchProfile['source'] = 'bundled-default',
  path?: string
): ResolvedResearchProfile {
  const hash = createHash('sha256')
    .update('honeycrisp:research-profile:v1\0')
    .update(serializeResearchProfile(profile))
    .digest('hex');
  return { profile, hash, source, ...(path ? { path } : {}) };
}

export function testResearchProfileCatalogEnvelope(profile: ResearchProfile = testResearchProfile()): Record<string, unknown> {
  return {
    catalogProtocolVersion: 1,
    supportedResearchProfileSchemaVersions: [1],
    ...resolvedTestResearchProfile(profile)
  };
}
