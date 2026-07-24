import { readFileSync, statSync } from 'node:fs';
import type {
  HoneycrispRunbookCell,
  HoneycrispRunbookDocument,
  HoneycrispRunbookOutput
} from '@shared/types';

const MAX_RUNBOOK_BYTES = 8 * 1024 * 1024;
const MAX_RUNBOOK_CELLS = 1_000;

export function readHoneycrispRunbook(path: string, runbookId: string): HoneycrispRunbookDocument {
  if (statSync(path).size > MAX_RUNBOOK_BYTES) {
    throw new Error(`Runbook artifact is too large to display: ${runbookId}`);
  }
  return parseHoneycrispRunbook(readFileSync(path, 'utf8'), runbookId);
}

export function parseHoneycrispRunbook(source: string, runbookId: string): HoneycrispRunbookDocument {
  const notebook = requiredRecord(JSON.parse(source), 'runbook');
  if (notebook.nbformat !== 4) throw new Error('Runbook must use Jupyter nbformat 4');
  if (!Array.isArray(notebook.cells)) throw new Error('Runbook cells must be an array');
  if (notebook.cells.length > MAX_RUNBOOK_CELLS) throw new Error('Runbook contains too many cells to display');

  const metadata = optionalRecord(notebook.metadata);
  const notebookLanguage =
    optionalString(optionalRecord(metadata?.language_info)?.name) ??
    optionalString(optionalRecord(metadata?.kernelspec)?.language);

  return {
    runbookId,
    nbformat: 4,
    nbformatMinor: optionalInteger(notebook.nbformat_minor) ?? 0,
    language: notebookLanguage,
    cells: notebook.cells.map((cell, index) => parseCell(cell, index, notebookLanguage))
  };
}

function parseCell(value: unknown, index: number, notebookLanguage: string | null): HoneycrispRunbookCell {
  const cell = requiredRecord(value, `runbook cell ${index + 1}`);
  const cellType = cell.cell_type;
  if (cellType !== 'markdown' && cellType !== 'code' && cellType !== 'raw') {
    throw new Error(`Unsupported runbook cell type at cell ${index + 1}`);
  }
  const metadata = optionalRecord(cell.metadata);
  const vscodeMetadata = optionalRecord(metadata?.vscode);
  const language =
    optionalString(metadata?.language) ??
    optionalString(vscodeMetadata?.languageId) ??
    (cellType === 'code' ? notebookLanguage : null);

  return {
    id: optionalString(cell.id) ?? `cell-${index + 1}`,
    type: cellType,
    source: sourceText(cell.source),
    language,
    executionCount: optionalInteger(cell.execution_count),
    outputs: cellType === 'code' && Array.isArray(cell.outputs)
      ? cell.outputs.map((output) => parseOutput(output)).filter((output): output is HoneycrispRunbookOutput => output !== null)
      : []
  };
}

function parseOutput(value: unknown): HoneycrispRunbookOutput | null {
  const output = optionalRecord(value);
  if (!output) return null;
  if (output.output_type === 'stream') {
    return {
      kind: 'stream',
      text: sourceText(output.text),
      streamName: output.name === 'stderr' ? 'stderr' : 'stdout',
      mimeType: 'text/plain'
    };
  }
  if (output.output_type === 'error') {
    const traceback = Array.isArray(output.traceback)
      ? output.traceback.filter((line): line is string => typeof line === 'string').join('\n')
      : '';
    const fallback = [optionalString(output.ename), optionalString(output.evalue)].filter(Boolean).join(': ');
    return {
      kind: 'error',
      text: traceback || fallback || 'Execution failed',
      streamName: null,
      mimeType: 'text/plain'
    };
  }
  if (output.output_type !== 'display_data' && output.output_type !== 'execute_result') return null;
  const data = optionalRecord(output.data);
  if (!data) return null;
  for (const mimeType of ['text/markdown', 'text/plain', 'application/json']) {
    if (!(mimeType in data)) continue;
    return {
      kind: 'display',
      text: mimeType === 'application/json' ? jsonText(data[mimeType]) : sourceText(data[mimeType]),
      streamName: null,
      mimeType
    };
  }
  const mimeTypes = Object.keys(data);
  return {
    kind: 'display',
    text: mimeTypes.length > 0 ? `Output available as ${mimeTypes.join(', ')}` : 'Display output',
    streamName: null,
    mimeType: null
  };
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const record = optionalRecord(value);
  if (!record) throw new Error(`Invalid ${label}`);
  return record;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function sourceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((part): part is string => typeof part === 'string').join('');
  return '';
}

function jsonText(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
