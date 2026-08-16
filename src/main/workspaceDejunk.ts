import { resolve } from 'node:path';
import type { WorkspaceDejunkSummary } from '../shared/types';
import { getHoneycrispMaintenanceSummary, runHoneycrispMaintenance } from './honeycrispCliClient';

const SUMMARY_CACHE_MS = 15_000;
const summaries = new Map<string, { cachedAt: number; summary: WorkspaceDejunkSummary }>();

export function getWorkspaceDejunkSummary(workspacePath: string): WorkspaceDejunkSummary {
  const root = resolve(workspacePath);
  const cached = summaries.get(root);
  if (cached && Date.now() - cached.cachedAt < SUMMARY_CACHE_MS) return cached.summary;
  const summary = getHoneycrispMaintenanceSummary(root);
  summaries.set(root, { cachedAt: Date.now(), summary });
  return summary;
}

export function runWorkspaceDejunk(workspacePath: string): WorkspaceDejunkSummary {
  const root = resolve(workspacePath);
  const summary = runHoneycrispMaintenance(root);
  summaries.set(root, { cachedAt: Date.now(), summary });
  return summary;
}

export function invalidateWorkspaceDejunkSummary(workspacePath: string): void {
  summaries.delete(resolve(workspacePath));
}
