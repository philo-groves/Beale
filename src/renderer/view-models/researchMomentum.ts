import type { RunDetail, TraceEventRecord } from '@shared/types';
import type { ResearchMomentum, ResearchMomentumState } from '../features/momentum/types';
import { stateClass, traceLabel } from '../lib/formatting';
import {
  traceCategoryForEvent,
  traceEventOutcome,
  tracePayloadPrimitive
} from '../traceClassification';
import { isIgnoredHeatState, type SessionHeat } from './sessionHeat';
import { traceEventSummary, trimTraceLabelPeriod } from './traceContent';

const RESEARCH_MOMENTUM_WINDOW_MS = 90_000;
const RESEARCH_MOMENTUM_RECENT_LIMIT = 18;

export function researchMomentumForDetail(detail: RunDetail | null, heat: SessionHeat): ResearchMomentum {
  if (!detail) return momentumState('idle', 'No research session is selected.');
  if (detail.run.status === 'queued') return momentumState('waiting', 'The research session is queued.');
  if (detail.run.status !== 'active') return momentumState('idle', `The research session is ${traceLabel(detail.run.status)}.`);

  const recent = recentMomentumTraceEvents(detail.traceEvents);
  const latest = recent.at(-1) ?? null;
  if (recent.length === 0) return momentumState('waiting', 'Waiting for the first trace event.');

  const waitingEvents = recent.filter(isMomentumWaitingEvent);
  if (waitingEvents.length > 0 && latest && isMomentumWaitingEvent(latest)) {
    return momentumState('waiting', momentumReasonFromEvent('Waiting on setup or approval', latest), waitingEvents);
  }

  const failureEvents = recent.filter(isMomentumFailureEvent);
  if (isMomentumStuck(recent, failureEvents)) {
    return momentumState('stuck', momentumStuckReason(recent, failureEvents), failureEvents);
  }

  if (hasMomentumHotLead(detail, heat, recent)) {
    const supporting = recent.filter((event) => isMomentumVerifyingEvent(event) || isMomentumBuildingEvent(event) || traceCategoryForEvent(event) === 'evidence');
    return momentumState('hot', `Evidence-backed ${traceLabel(heat)} lead is active.`, supporting.length > 0 ? supporting : recent.slice(-3));
  }

  const verifyingEvents = recent.filter(isMomentumVerifyingEvent);
  if (verifyingEvents.length > 0) {
    return momentumState('verifying', momentumReasonFromEvent('Verifying evidence', verifyingEvents.at(-1) ?? latest), verifyingEvents);
  }

  const buildingEvents = recent.filter(isMomentumBuildingEvent);
  if (buildingEvents.length > 0) {
    return momentumState('building', momentumReasonFromEvent('Building hypotheses or experiments', buildingEvents.at(-1) ?? latest), buildingEvents);
  }

  const exploringEvents = recent.filter(isMomentumExploringEvent);
  if (exploringEvents.length > 0) {
    return momentumState('exploring', momentumReasonFromEvent('Exploring target surface', exploringEvents.at(-1) ?? latest), exploringEvents);
  }

  return momentumState('exploring', momentumReasonFromEvent('Active session is producing trace events', latest), recent.slice(-3));
}

function recentMomentumTraceEvents(events: TraceEventRecord[]): TraceEventRecord[] {
  const now = Date.now();
  const recent = events.filter((event) => {
    const created = Date.parse(event.createdAt);
    return Number.isFinite(created) && now - created >= 0 && now - created <= RESEARCH_MOMENTUM_WINDOW_MS;
  });
  return recent.length > 0 ? recent : events.slice(-RESEARCH_MOMENTUM_RECENT_LIMIT);
}

function momentumState(state: ResearchMomentumState, reason: string, events: TraceEventRecord[] = []): ResearchMomentum {
  return {
    state,
    reason,
    since: events[0]?.createdAt ?? null,
    supportingTraceEventIds: events.map((event) => event.id)
  };
}

function momentumReasonFromEvent(prefix: string, event: TraceEventRecord | null): string {
  if (!event) return `${prefix}.`;
  return `${prefix}: ${trimTraceLabelPeriod(traceEventSummary(event, traceCategoryForEvent(event)))}.`;
}

function isMomentumWaitingEvent(event: TraceEventRecord): boolean {
  const text = momentumEventText(event);
  return /\b(waiting|approval|approve|authenticate|credential|authorization|permission|not configured|configure|blocked by|requires setup|user input)\b/.test(text);
}

function isMomentumFailureEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'failure_recovery' || traceEventOutcome(event) === 'failure') return true;
  return /\b(retry|unavailable|unsupported|missing|no local source|not found|blocked)\b/.test(momentumOperationalText(event));
}

function isMomentumStuck(recent: TraceEventRecord[], failureEvents: TraceEventRecord[]): boolean {
  if (failureEvents.length >= 3) return true;
  const latest = recent.at(-1);
  if (failureEvents.length >= 2 && latest && isMomentumFailureEvent(latest)) return true;
  const sourceUnavailableCount = recent.filter((event) => /\b(source unavailable|no local source|materialize source|clone failed)\b/.test(momentumOperationalText(event))).length;
  return sourceUnavailableCount >= 2;
}

function momentumStuckReason(recent: TraceEventRecord[], failureEvents: TraceEventRecord[]): string {
  const sourceUnavailableCount = recent.filter((event) => /\b(source unavailable|no local source|materialize source|clone failed)\b/.test(momentumOperationalText(event))).length;
  if (sourceUnavailableCount >= 2) return 'Repeated source availability blockers detected.';
  const latestFailure = failureEvents.at(-1) ?? recent.at(-1) ?? null;
  return momentumReasonFromEvent('Repeated errors detected', latestFailure);
}

function hasMomentumHotLead(detail: RunDetail, heat: SessionHeat, recent: TraceEventRecord[]): boolean {
  if (heat !== 'high' && heat !== 'critical') return false;
  const recentProgress = recent.some((event) => isMomentumVerifyingEvent(event) || isMomentumBuildingEvent(event) || traceCategoryForEvent(event) === 'evidence');
  if (recentProgress) return true;

  return (
    detail.findings.some((finding) => !isIgnoredHeatState(finding.state) && isMomentumRecentIso(finding.updatedAt)) ||
    detail.hypotheses.some((hypothesis) => {
      const state = stateClass(hypothesis.state);
      return (state === 'reproduced' || state === 'promoted' || state === 'verified') && isMomentumRecentIso(hypothesis.updatedAt);
    })
  );
}

function isMomentumVerifyingEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'verifier') return true;
  const text = momentumEventText(event);
  return (
    category === 'vm_execution' ||
    /\b(verifier|verify|verified|repro|reproduction|debugger|poc|proof|crash|sanitizer|exploit|execute|test|assert)\b/.test(text)
  );
}

function isMomentumBuildingEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'hypotheses' || category === 'evidence') return true;
  return /\b(hypothesis|finding|artifact|experiment|prepare|construct|build|created|promote|chain)\b/.test(momentumEventText(event));
}

function isMomentumExploringEvent(event: TraceEventRecord): boolean {
  const category = traceCategoryForEvent(event);
  if (category === 'code_navigation' || category === 'tools') return true;
  return /\b(search|inspect|read|list|grep|repository|source|import|clone|map|enumerate)\b/.test(momentumEventText(event));
}

function isMomentumRecentIso(value: string): boolean {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const age = Date.now() - timestamp;
  return age >= 0 && age <= RESEARCH_MOMENTUM_WINDOW_MS;
}

function momentumEventText(event: TraceEventRecord): string {
  let payload = '';
  try {
    payload = JSON.stringify(event.payload);
  } catch {
    payload = '';
  }
  return `${event.source}\n${event.type}\n${event.summary}\n${payload}`.toLowerCase();
}

function momentumOperationalText(event: TraceEventRecord): string {
  return [
    event.source,
    event.type,
    event.summary,
    tracePayloadPrimitive(event.payload, 'status'),
    tracePayloadPrimitive(event.payload, 'error'),
    tracePayloadPrimitive(event.payload, 'reason'),
    tracePayloadPrimitive(event.payload, 'message'),
    tracePayloadPrimitive(event.payload, 'blockedIssue'),
    tracePayloadPrimitive(event.payload, 'sourceAcquisitionHint')
  ]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .toLowerCase();
}
