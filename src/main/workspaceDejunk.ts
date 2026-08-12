import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { WorkspaceDejunkRunSummary, WorkspaceDejunkSummary } from '../shared/types';

const STATE_VERSION = 1;
const NEW_FILE_COUNT_LIMIT = 1_000;
const SUMMARY_CACHE_MS = 15_000;
const LARGE_RECLAIMABLE_BYTES = 256 * 1024 * 1024;
const LARGE_IPSW_EXTRACTION_BYTES = 128 * 1024 * 1024;
const STANDARD_RESEARCH_DIRECTORY = 'research';
const PROTECTED_TOP_LEVEL_NAMES = new Set([
  '.beale',
  '.git',
  'research'
]);
const STANDARD_PROJECT_FILE_NAMES = new Set([
  '.editorconfig',
  '.gitignore',
  '.gitattributes',
  'agents.md',
  'changelog.md',
  'license',
  'license.md',
  'package-lock.json',
  'package.json',
  'readme.md',
  'tsconfig.json'
]);
const RECLAIMABLE_DIRECTORY_NAMES = new Set([
  '.cache',
  '.gradle',
  '.pytest_cache',
  'build',
  'deriveddata',
  'dist',
  'node_modules',
  'out',
  'target'
]);
const RESEARCH_DIRECTORY_ALIASES: Record<string, ResearchDirectory> = {
  analysis: 'notes',
  evidence: 'evidence',
  findings: 'notes',
  notes: 'notes',
  poc: 'pocs',
  pocs: 'pocs',
  repro: 'pocs',
  reproductions: 'pocs',
  scripts: 'scripts',
  scratch: 'scratch'
};

type ResearchDirectory = 'notes' | 'pocs' | 'evidence' | 'scripts' | 'scratch';

interface WorkspaceDejunkState {
  version: 1;
  baselineAt: string;
  lastRun: WorkspaceDejunkRunSummary | null;
}

interface CachedSummary {
  cachedAt: number;
  baselineAt: string;
  summary: WorkspaceDejunkSummary;
}

const summaryCache = new Map<string, CachedSummary>();

export function getWorkspaceDejunkSummary(workspacePath: string): WorkspaceDejunkSummary {
  const root = resolve(workspacePath);
  const state = readOrInitializeState(root);
  const cached = summaryCache.get(root);
  if (cached && cached.baselineAt === state.baselineAt && Date.now() - cached.cachedAt < SUMMARY_CACHE_MS) {
    return cached.summary;
  }
  const counted = countNewWorkspaceFiles(root, Date.parse(state.baselineAt));
  const summary: WorkspaceDejunkSummary = {
    available: true,
    newFileCount: counted.count,
    newFileCountCapped: counted.capped,
    baselineAt: state.baselineAt,
    lastRun: state.lastRun
  };
  summaryCache.set(root, { cachedAt: Date.now(), baselineAt: state.baselineAt, summary });
  return summary;
}

export function runWorkspaceDejunk(workspacePath: string): WorkspaceDejunkSummary {
  const root = resolve(workspacePath);
  const state = readOrInitializeState(root);
  const startedAt = new Date().toISOString();
  let movedFileCount = 0;
  let deletedPathCount = 0;
  let reclaimedBytes = 0;
  try {
    movedFileCount = organizeLooseResearch(root);
    const deleted = deleteLargeReclaimableTrees(root);
    deletedPathCount = deleted.pathCount;
    reclaimedBytes = deleted.reclaimedBytes;
    const completedAt = new Date().toISOString();
    writeState(root, {
      version: STATE_VERSION,
      baselineAt: completedAt,
      lastRun: {
        status: 'completed',
        startedAt,
        completedAt,
        movedFileCount,
        deletedPathCount,
        reclaimedBytes,
        errorMessage: null
      }
    });
  } catch (error) {
    const completedAt = new Date().toISOString();
    writeState(root, {
      ...state,
      lastRun: {
        status: 'failed',
        startedAt,
        completedAt,
        movedFileCount,
        deletedPathCount,
        reclaimedBytes,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
    invalidateWorkspaceDejunkSummary(root);
    throw error;
  }
  invalidateWorkspaceDejunkSummary(root);
  return getWorkspaceDejunkSummary(root);
}

export function invalidateWorkspaceDejunkSummary(workspacePath: string): void {
  summaryCache.delete(resolve(workspacePath));
}

function statePath(workspacePath: string): string {
  return join(workspacePath, '.beale', 'dejunk.json');
}

function readOrInitializeState(workspacePath: string): WorkspaceDejunkState {
  const path = statePath(workspacePath);
  if (existsSync(path)) {
    try {
      const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkspaceDejunkState>;
      if (value.version === STATE_VERSION && typeof value.baselineAt === 'string' && Number.isFinite(Date.parse(value.baselineAt))) {
        return {
          version: STATE_VERSION,
          baselineAt: value.baselineAt,
          lastRun: normalizeLastRun(value.lastRun)
        };
      }
    } catch {
      // Replace malformed host metadata with a fresh baseline without touching workspace content.
    }
  }
  const state: WorkspaceDejunkState = {
    version: STATE_VERSION,
    baselineAt: new Date().toISOString(),
    lastRun: null
  };
  writeState(workspacePath, state);
  summaryCache.set(resolve(workspacePath), {
    cachedAt: Date.now(),
    baselineAt: state.baselineAt,
    summary: {
      available: true,
      newFileCount: 0,
      newFileCountCapped: false,
      baselineAt: state.baselineAt,
      lastRun: null
    }
  });
  return state;
}

function normalizeLastRun(value: unknown): WorkspaceDejunkRunSummary | null {
  if (!value || typeof value !== 'object') return null;
  const run = value as Partial<WorkspaceDejunkRunSummary>;
  if (run.status !== 'completed' && run.status !== 'failed') return null;
  if (typeof run.startedAt !== 'string' || typeof run.completedAt !== 'string') return null;
  return {
    status: run.status,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    movedFileCount: finiteCount(run.movedFileCount),
    deletedPathCount: finiteCount(run.deletedPathCount),
    reclaimedBytes: finiteCount(run.reclaimedBytes),
    errorMessage: typeof run.errorMessage === 'string' ? run.errorMessage : null
  };
}

function finiteCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function writeState(workspacePath: string, state: WorkspaceDejunkState): void {
  const path = statePath(workspacePath);
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporaryPath, path);
}

function countNewWorkspaceFiles(workspacePath: string, baselineMs: number): { count: number; capped: boolean } {
  if (existsSync(join(workspacePath, '.git'))) return { count: 0, capped: false };
  let count = 0;
  const stack = [workspacePath];
  while (stack.length > 0 && count < NEW_FILE_COUNT_LIMIT) {
    const directory = stack.pop();
    if (!directory) break;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (count >= NEW_FILE_COUNT_LIMIT) break;
      if (entry.name === '.beale' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      let stats;
      try {
        stats = lstatSync(path);
      } catch {
        continue;
      }
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        if (existsSync(join(path, '.git'))) continue;
        stack.push(path);
        continue;
      }
      if (!stats.isFile()) continue;
      const createdAt = stats.birthtimeMs > 0 ? stats.birthtimeMs : stats.ctimeMs;
      if (createdAt > baselineMs) count += 1;
    }
  }
  return { count, capped: count >= NEW_FILE_COUNT_LIMIT };
}

function organizeLooseResearch(workspacePath: string): number {
  if (existsSync(join(workspacePath, '.git'))) return 0;
  let movedFileCount = 0;
  const entries = readdirSync(workspacePath, { withFileTypes: true });
  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (PROTECTED_TOP_LEVEL_NAMES.has(lowerName)) continue;
    const source = join(workspacePath, entry.name);
    const stats = lstatSync(source);
    if (stats.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      if (containsGitMetadata(source)) continue;
      const destinationDirectory = RESEARCH_DIRECTORY_ALIASES[lowerName];
      if (!destinationDirectory) continue;
      const destination = join(workspacePath, STANDARD_RESEARCH_DIRECTORY, destinationDirectory);
      movedFileCount += mergeResearchTree(source, destination);
      continue;
    }
    if (!entry.isFile()) continue;
    const destinationDirectory = classifyLooseResearchFile(entry.name);
    if (!destinationDirectory) continue;
    const destinationRoot = join(workspacePath, STANDARD_RESEARCH_DIRECTORY, destinationDirectory);
    mkdirSync(destinationRoot, { recursive: true });
    renameSync(source, availableDestination(join(destinationRoot, entry.name)));
    movedFileCount += 1;
  }
  return movedFileCount;
}

function classifyLooseResearchFile(name: string): ResearchDirectory | null {
  const lowerName = name.toLowerCase();
  if (STANDARD_PROJECT_FILE_NAMES.has(lowerName)) return null;
  const extension = extname(lowerName);
  if (/\b(poc|proof[-_ ]?of[-_ ]?concept|exploit|repro|trigger|crash)\b/u.test(lowerName)) return 'pocs';
  if (['.crash', '.dmp', '.har', '.ips', '.log', '.pcap', '.pcapng', '.trace'].includes(extension)) return 'evidence';
  if (/\b(note|notes|finding|findings|research|analysis|triage|journal)\b/u.test(lowerName)
    && ['.md', '.rst', '.txt'].includes(extension)) return 'notes';
  if (/\b(analyze|analyse|dump|extract|fuzz|scan)\b/u.test(lowerName)
    && ['.js', '.mjs', '.ps1', '.py', '.rb', '.sh', '.ts'].includes(extension)) return 'scripts';
  if (/\b(scratch|temp|tmp)\b/u.test(lowerName) || ['.bak', '.temp', '.tmp'].includes(extension)) return 'scratch';
  return null;
}

function mergeResearchTree(source: string, destination: string): number {
  if (!existsSync(destination)) {
    mkdirSync(dirname(destination), { recursive: true });
    const count = countFiles(source);
    renameSync(source, destination);
    return count;
  }
  let moved = 0;
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const childSource = join(source, entry.name);
    const stats = lstatSync(childSource);
    if (stats.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      moved += mergeResearchTree(childSource, join(destination, entry.name));
    } else if (entry.isFile()) {
      renameSync(childSource, availableDestination(join(destination, entry.name)));
      moved += 1;
    }
  }
  if (readdirSync(source).length === 0) rmSync(source, { recursive: false, force: false });
  return moved;
}

function availableDestination(requestedPath: string): string {
  if (!existsSync(requestedPath)) return requestedPath;
  const extension = extname(requestedPath);
  const stem = requestedPath.slice(0, requestedPath.length - extension.length);
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to choose a unique Dejunk destination for ${basename(requestedPath)}`);
}

function deleteLargeReclaimableTrees(workspacePath: string): { pathCount: number; reclaimedBytes: number } {
  if (existsSync(join(workspacePath, '.git'))) return { pathCount: 0, reclaimedBytes: 0 };
  const candidates: Array<{ path: string; size: number }> = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === '.beale' || entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink() || existsSync(join(path, '.git'))) continue;
      if (directory === workspacePath && entry.name === STANDARD_RESEARCH_DIRECTORY) {
        visit(path);
        continue;
      }
      const reclaimableThreshold = reclaimableDirectoryThreshold(path);
      if (reclaimableThreshold !== null) {
        if (containsGitMetadata(path)) continue;
        const size = directorySize(path);
        if (size >= reclaimableThreshold) candidates.push({ path, size });
        continue;
      }
      visit(path);
    }
  };
  visit(workspacePath);
  let reclaimedBytes = 0;
  for (const candidate of candidates) {
    ensureWorkspaceChild(workspacePath, candidate.path);
    rmSync(candidate.path, { recursive: true, force: false });
    reclaimedBytes += candidate.size;
  }
  return { pathCount: candidates.length, reclaimedBytes };
}

function reclaimableDirectoryThreshold(path: string): number | null {
  const lowerName = basename(path).toLowerCase();
  if (RECLAIMABLE_DIRECTORY_NAMES.has(lowerName)) return LARGE_RECLAIMABLE_BYTES;
  const normalized = path.replace(/\\/gu, '/').toLowerCase();
  const namedIpswExtraction = normalized.includes('ipsw') && /(extract|unpack|payload|firmware|mount)/u.test(normalized);
  const hasIpswMarkers = existsSync(join(path, 'BuildManifest.plist'))
    && (existsSync(join(path, 'Payload')) || existsSync(join(path, 'Firmware')));
  return namedIpswExtraction || hasIpswMarkers ? LARGE_IPSW_EXTRACTION_BYTES : null;
}

function directorySize(root: string): number {
  let size = 0;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) stack.push(path);
      else if (stats.isFile()) size += stats.size;
    }
  }
  return size;
}

function countFiles(root: string): number {
  let count = 0;
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const stats = lstatSync(path);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) stack.push(path);
      else if (stats.isFile()) count += 1;
    }
  }
  return count;
}

function ensureWorkspaceChild(workspacePath: string, candidatePath: string): void {
  const child = relative(resolve(workspacePath), resolve(candidatePath));
  if (!child || child === '..' || child.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`Dejunk path escaped the workspace: ${candidatePath}`);
  }
}

function containsGitMetadata(root: string): boolean {
  const stack = [root];
  while (stack.length > 0) {
    const directory = stack.pop();
    if (!directory) break;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '.git') return true;
      if (!entry.isDirectory()) continue;
      const path = join(directory, entry.name);
      if (!lstatSync(path).isSymbolicLink()) stack.push(path);
    }
  }
  return false;
}
