import { resolve } from 'node:path';
import type { WorkspaceDejunkSummary } from '../shared/types';
import {
  getHoneycrispMaintenanceSummary,
  getHoneycrispMaintenanceSummaryAsync,
  runHoneycrispMaintenance
} from './honeycrispCliClient';

const SUMMARY_CACHE_MS = 15_000;
const summaries = new Map<string, { cachedAt: number; summary: WorkspaceDejunkSummary }>();
const summaryRequests = new Map<string, Promise<WorkspaceDejunkSummary>>();

export function getWorkspaceDejunkSummary(workspacePath: string): WorkspaceDejunkSummary {
  const root = resolve(workspacePath);
  const cached = summaries.get(root);
  if (cached && Date.now() - cached.cachedAt < SUMMARY_CACHE_MS) return cached.summary;
  const summary = getHoneycrispMaintenanceSummary(root);
  summaries.set(root, { cachedAt: Date.now(), summary });
  return summary;
}

export async function getWorkspaceDejunkSummaryAsync(workspacePath: string): Promise<WorkspaceDejunkSummary> {
  const root = resolve(workspacePath);
  const cached = summaries.get(root);
  if (cached && Date.now() - cached.cachedAt < SUMMARY_CACHE_MS) return cached.summary;
  const active = summaryRequests.get(root);
  if (active) return await active;
  const request = getHoneycrispMaintenanceSummaryAsync(root).then((summary) => {
    summaries.set(root, { cachedAt: Date.now(), summary });
    return summary;
  });
  summaryRequests.set(root, request);
  try {
    return await request;
  } finally {
    summaryRequests.delete(root);
  }
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
