import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const WORKSPACE_DESCRIPTION_FILE = 'AGENTS.md';

export function readWorkspaceDescription(workspacePath: string): string {
  try {
    return readFileSync(join(workspacePath, WORKSPACE_DESCRIPTION_FILE), 'utf8');
  } catch {
    return '';
  }
}

export function writeWorkspaceDescription(workspacePath: string, descriptionMarkdown: string): void {
  writeFileSync(join(workspacePath, WORKSPACE_DESCRIPTION_FILE), descriptionMarkdown, 'utf8');
}

export function migrateWorkspaceDescription(workspacePath: string, legacyDescriptionMarkdown: string): boolean {
  const descriptionPath = join(workspacePath, WORKSPACE_DESCRIPTION_FILE);
  if (existsSync(descriptionPath) || !legacyDescriptionMarkdown.trim()) return false;
  writeFileSync(descriptionPath, legacyDescriptionMarkdown, 'utf8');
  return true;
}
