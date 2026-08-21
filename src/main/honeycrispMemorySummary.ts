import { getHoneycrispMemorySummary as queryHoneycrispMemorySummary } from './honeycrispCliClient';
import type { HoneycrispMemorySummary, ResearchProfileSnapshot } from '@shared/types';

export interface HoneycrispMemorySummaryOptions {
  databasePath: string;
  artifactDirectoryPath: string;
  sessionId?: string;
  workspaceId: string;
  subjectId: string | null;
  researchProfile?: ResearchProfileSnapshot | null;
  includeForeignCatalogs?: boolean;
  sourceRevision?: string | null;
  environmentFingerprint?: string | null;
  assetIds?: string[];
}

/** @deprecated Use the typed Honeycrisp client directly. */
export function getHoneycrispMemorySummary(options: HoneycrispMemorySummaryOptions): HoneycrispMemorySummary {
  return queryHoneycrispMemorySummary({
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    workspaceId: options.workspaceId,
    subjectId: options.subjectId,
    ...(options.researchProfile !== undefined ? { researchProfile: options.researchProfile } : {}),
    ...(options.includeForeignCatalogs === true ? { includeForeignCatalogs: true } : {}),
    ...(options.sourceRevision !== undefined ? { sourceRevision: options.sourceRevision } : {}),
    ...(options.environmentFingerprint !== undefined ? { environmentFingerprint: options.environmentFingerprint } : {}),
    ...(options.assetIds ? { assetIds: options.assetIds } : {})
  }, {
    databasePath: options.databasePath,
    artifactDirectoryPath: options.artifactDirectoryPath
  });
}
