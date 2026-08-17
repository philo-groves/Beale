import type {
  HoneycrispReportSummary,
  ProviderSettings,
  ResearchModelEffortLevel,
  ResearchModelSelection,
  ResearchProviderModelCatalog,
  RunRecord
} from '@shared/types';

export function reportSessionDefaultModelSelection(
  providerSettings: ProviderSettings | null,
  catalogs: readonly ResearchProviderModelCatalog[]
): ResearchModelSelection | null {
  const provider = catalogs.find((catalog) => (
    catalog.providerId === providerSettings?.defaultProviderId && catalog.models.length > 0
  )) ?? catalogs.find((catalog) => catalog.models.length > 0);
  if (!provider) return null;
  const defaults = providerSettings?.modelDefaults[provider.providerId];
  const model = provider.models.find((candidate) => candidate.id === defaults?.largeModel)
    ?? provider.models[0];
  if (!model) return null;
  const preferredEffort = defaults?.reasoningEffort ?? 'high';
  const reasoningEffort: ResearchModelEffortLevel = model.effortLevels.includes(preferredEffort)
    ? preferredEffort
    : model.effortLevels.includes('high')
      ? 'high'
      : model.effortLevels[0] ?? 'off';
  return { provider: provider.providerId, model: model.id, reasoningEffort };
}

export function isReportResourceRun(run: Pick<RunRecord, 'budget'>): boolean {
  const resourceContext = run.budget.resourceContext;
  return Boolean(
    resourceContext &&
    typeof resourceContext === 'object' &&
    'kind' in resourceContext &&
    resourceContext.kind === 'report'
  );
}

export function reportCatalogGroups(reports: readonly HoneycrispReportSummary[]): {
  complete: HoneycrispReportSummary[];
  stale: HoneycrispReportSummary[];
} {
  const complete: HoneycrispReportSummary[] = [];
  const stale: HoneycrispReportSummary[] = [];
  for (const report of reports) (report.status === 'stale' ? stale : complete).push(report);
  const newestFirst = (left: HoneycrispReportSummary, right: HoneycrispReportSummary): number =>
    right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id);
  complete.sort(newestFirst);
  stale.sort(newestFirst);
  return { complete, stale };
}

export function reportsForReportingScope(
  reports: readonly HoneycrispReportSummary[],
  workspaceId: string | null
): HoneycrispReportSummary[] {
  return workspaceId ? reports.filter((report) => report.workspaceId === workspaceId) : [...reports];
}

export interface ReportMarkdownBlock {
  id: string;
  content: string;
  startLine: number;
  endLine: number;
}

export type ReportEditScope = 'selection' | 'report';

export interface ReportBlockSelection {
  blockIds: string[];
  anchorIndex: number;
}

export function joinReportBlockSelection({
  blockIds,
  selectedBlockIds,
  anchorIndex,
  blockIndex,
  shiftKey,
  toggleKey
}: {
  blockIds: readonly string[];
  selectedBlockIds: readonly string[];
  anchorIndex: number | null;
  blockIndex: number;
  shiftKey: boolean;
  toggleKey: boolean;
}): ReportBlockSelection {
  const selected = new Set(selectedBlockIds);
  const blockId = blockIds[blockIndex];
  if (!blockId) return { blockIds: [...selectedBlockIds], anchorIndex: anchorIndex ?? 0 };

  if (shiftKey && anchorIndex !== null) {
    const rangeStart = Math.min(anchorIndex, blockIndex);
    const rangeEnd = Math.max(anchorIndex, blockIndex);
    for (let index = rangeStart; index <= rangeEnd; index += 1) {
      const rangeBlockId = blockIds[index];
      if (rangeBlockId) selected.add(rangeBlockId);
    }
    return { blockIds: blockIds.filter((id) => selected.has(id)), anchorIndex };
  }

  if (toggleKey) {
    if (selected.has(blockId)) selected.delete(blockId);
    else selected.add(blockId);
    return { blockIds: blockIds.filter((id) => selected.has(id)), anchorIndex: blockIndex };
  }

  return { blockIds: [blockId], anchorIndex: blockIndex };
}

export function reportMarkdownBlocks(content: string): ReportMarkdownBlock[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReportMarkdownBlock[] = [];
  let start = 0;
  let fenced = false;
  const push = (endExclusive: number): void => {
    const block = lines.slice(start, endExclusive).join('\n').trim();
    if (block) {
      blocks.push({
        id: `report-block-${blocks.length + 1}`,
        content: block,
        startLine: start + 1,
        endLine: endExclusive
      });
    }
  };
  for (let index = 0; index <= lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (index < lines.length && (fenced || line.trim())) continue;
    push(index);
    start = index + 1;
  }
  return blocks;
}

export function reportChangeInstruction(
  selection: Pick<ReportMarkdownBlock, 'content' | 'startLine' | 'endLine'> | readonly Pick<ReportMarkdownBlock, 'content' | 'startLine' | 'endLine'>[],
  request: string,
  editScope: ReportEditScope = 'selection'
): string {
  const normalizedRequest = request.trim();
  if (!normalizedRequest) return '';
  const blocks = Array.isArray(selection) ? selection : [selection];
  if (blocks.length === 0) return '';
  const ranges = blocks.map((block) => `${block.startLine}-${block.endLine}`).join(', ');
  const excerpts = blocks.map((block) => [
    `Report lines ${block.startLine}-${block.endLine}:`,
    '```markdown',
    block.content,
    '```'
  ].join('\n')).join('\n\n');
  const scopeInstruction = editScope === 'report'
    ? 'Editable scope: anywhere in the report. Use the highlighted sections as context and make any report-wide edits needed to satisfy the request.'
    : 'Editable scope: only the highlighted sections. Do not change report content outside these line ranges.';
  return [
    `Highlighted report lines: ${ranges}.`,
    scopeInstruction,
    excerpts,
    `Requested change: ${normalizedRequest}`
  ].join('\n\n');
}
