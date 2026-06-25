import { useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Braces, CircleHelp, Database, FolderTree, ListChecks, RefreshCw, Wrench } from 'lucide-react';
import type { AgentContextState, HoneycrispMemorySummary } from '@shared/types';
import { formatSessionDateTime, stateClass, traceLabel, truncateText } from '../../lib/formatting';

const CONTEXT_REFRESH_INTERVAL_MS = 1000;

export function ContextSessionView({ honeycrispMemory, selectedRunId }: { honeycrispMemory: HoneycrispMemorySummary | null; selectedRunId: string }): JSX.Element {
  const [state, setState] = useState<AgentContextState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let disposed = false;
    let requestInFlight = false;

    async function refresh(): Promise<void> {
      if (requestInFlight) return;
      requestInFlight = true;
      setRefreshing(true);
      try {
        const nextState = await window.beale.getAgentContext(selectedRunId);
        if (!disposed) {
          setState(nextState);
          setError(null);
        }
      } catch (refreshError) {
        if (!disposed) {
          setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
        }
      } finally {
        requestInFlight = false;
        if (!disposed) setRefreshing(false);
      }
    }

    void refresh();
    const interval = window.setInterval(() => void refresh(), CONTEXT_REFRESH_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [selectedRunId]);

  const payload = state?.event?.payload ?? {};
  const status = error ? 'error' : state?.status ?? 'empty';
  const latestEvent = state?.event ?? null;
  const selectedSkills = useMemo(() => readRecordArray(payload.selectedSkills), [payload]);
  const openQuestions = useMemo(() => readStringArray(payload.openQuestions), [payload]);
  const candidateToolActions = useMemo(() => readRecordArray(payload.candidateToolActions), [payload]);
  const skippedToolActions = useMemo(() => readRecordArray(payload.skippedToolActions), [payload]);
  const activeGoal = useMemo(() => readRecord(payload.activeGoal), [payload]);
  const activeSubGoal = useMemo(() => readRecord(payload.activeSubGoal), [payload]);
  const toolPermissions = useMemo(() => readRecord(payload.toolPermissions), [payload]);
  const storage = useMemo(() => readRecord(payload.storage), [payload]);
  const activeGoalLabel = firstString(activeGoal ?? {}, ['objective', 'id']) ?? latestEvent?.goalId ?? 'None';
  const activeSubGoalLabel =
    firstString(activeSubGoal ?? {}, ['objective', 'id']) ??
    stringValue(payload.activeSubGoalId) ??
    latestEvent?.subGoalId ??
    'None';
  const findingRecords = honeycrispMemory?.records.findings ?? [];
  const proofAttempts = honeycrispMemory?.proof.attempts ?? [];

  return (
    <div className="context-session-workspace" aria-label="Context view">
      <div className="context-session-scroll">
        <div className="context-session-summary-grid" aria-label="Context summary">
          <SummaryTile
            icon={<Database size={17} />}
            label="SQLite Log"
            value={traceLabel(status)}
            detail={state?.databasePath ? truncateText(state.databasePath, 84) : 'Waiting for workspace'}
          />
          <SummaryTile
            icon={<Braces size={17} />}
            label="Latest Context"
            value={latestEvent ? `#${latestEvent.sequence}` : 'None'}
            detail={latestEvent ? formatSessionDateTime(latestEvent.timestamp) : 'No compiled event'}
          />
          <SummaryTile
            icon={<CircleHelp size={17} />}
            label="Open Questions"
            value={formatCount(openQuestions.length)}
            detail={openQuestions[0] ? truncateText(openQuestions[0], 84) : 'None'}
          />
          <SummaryTile
            icon={<Wrench size={17} />}
            label="Tool Actions"
            value={`${formatCount(candidateToolActions.length)} planned`}
            detail={`${formatCount(skippedToolActions.length)} skipped`}
          />
          <SummaryTile
            icon={<Database size={17} />}
            label="Findings"
            value={formatCount(findingRecords.length)}
            detail={findingRecords[0]?.title ? truncateText(findingRecords[0].title, 84) : 'None'}
          />
          <SummaryTile
            icon={<ListChecks size={17} />}
            label="Proof"
            value={`${formatCount(honeycrispMemory?.proof.obligationCount ?? 0)} obligations`}
            detail={`${formatCount(honeycrispMemory?.proof.attemptCount ?? 0)} attempts`}
          />
        </div>

        <div className="context-session-layout">
          <section className="context-session-section context-session-section-wide" aria-label="Compiled context event">
            <SectionHeader icon={<Braces size={16} />} title="Compiled Context" status={status} refreshing={refreshing} />
            {error || state?.lastError ? <p className="context-session-warning">{error ?? state?.lastError}</p> : null}
            <KeyValueRows
              rows={[
                ['Run', selectedRunId],
                ['Event', latestEvent?.eventId ?? 'None'],
                ['Goal', activeGoalLabel],
                ['Subgoal', activeSubGoalLabel],
                ['Read', state?.readAt ? formatSessionDateTime(state.readAt) : 'Pending'],
                ['Payload Hash', latestEvent?.payloadHash ?? 'None']
              ]}
            />
            <QuestionList questions={openQuestions} />
          </section>

          <section className="context-session-section" aria-label="Active goal">
            <SectionHeader icon={<Braces size={16} />} title="Active Goal" />
            <ObjectPreview value={activeGoal} emptyLabel="No active goal summary" />
          </section>

          <section className="context-session-section" aria-label="Active subgoal">
            <SectionHeader icon={<Braces size={16} />} title="Active Subgoal" />
            <ObjectPreview value={activeSubGoal} emptyLabel="No active subgoal summary" />
          </section>

          <section className="context-session-section" aria-label="Selected skills">
            <SectionHeader icon={<ListChecks size={16} />} title="Selected Skills" />
            <RecordList records={selectedSkills} emptyLabel="No selected skills" primaryKeys={['name', 'id']} secondaryKeys={['purpose', 'summary', 'description']} />
          </section>

          <section className="context-session-section" aria-label="Honeycrisp findings">
            <SectionHeader icon={<Database size={16} />} title="Honeycrisp Findings" status={honeycrispMemory?.source ?? 'none'} />
            <RecordList
              records={findingRecords.map((record) => ({
                id: record.id,
                title: record.title,
                detail: record.detail,
                status: record.status
              }))}
              emptyLabel="No Honeycrisp findings"
              primaryKeys={['title', 'id']}
              secondaryKeys={['detail', 'status']}
            />
          </section>

          <section className="context-session-section" aria-label="Honeycrisp proof state">
            <SectionHeader icon={<ListChecks size={16} />} title="Proof State" />
            <RecordList
              records={proofAttempts.map((attempt) => ({
                id: attempt.id,
                result: attempt.result ?? attempt.status,
                summary: attempt.summary,
                method: attempt.methodName || attempt.methodKind
              }))}
              emptyLabel="No proof attempts"
              primaryKeys={['summary', 'id']}
              secondaryKeys={['result', 'method']}
            />
          </section>

          <section className="context-session-section" aria-label="Tool permissions">
            <SectionHeader icon={<Wrench size={16} />} title="Tool State" />
            <ObjectPreview value={toolPermissions} emptyLabel="No tool permissions" />
            <RecordList records={candidateToolActions} emptyLabel="No candidate tool actions" primaryKeys={['toolName', 'name']} secondaryKeys={['reason', 'summary']} />
            {skippedToolActions.length > 0 ? (
              <RecordList records={skippedToolActions} emptyLabel="No skipped tool actions" primaryKeys={['toolName', 'name']} secondaryKeys={['reason', 'summary']} />
            ) : null}
          </section>

          <section className="context-session-section" aria-label="Storage layout">
            <SectionHeader icon={<FolderTree size={16} />} title="Storage" />
            <ObjectPreview value={storage} emptyLabel="No storage layout" />
          </section>

          <section className="context-session-section context-session-section-wide" aria-label="Raw context payload">
            <SectionHeader icon={<Database size={16} />} title="Raw Payload" />
            <pre className="context-session-raw">{JSON.stringify(payload, null, 2)}</pre>
          </section>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }): JSX.Element {
  return (
    <div className="context-session-summary-tile">
      <span className="context-session-summary-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="context-session-summary-copy">
        <span>{label}</span>
        <strong title={value}>{value}</strong>
        <small title={detail}>{detail}</small>
      </span>
    </div>
  );
}

function SectionHeader({
  icon,
  refreshing = false,
  status,
  title
}: {
  icon: ReactNode;
  refreshing?: boolean;
  status?: string;
  title: string;
}): JSX.Element {
  return (
    <div className="context-session-section-header">
      <span className="context-session-section-icon" aria-hidden="true">
        {icon}
      </span>
      <h3>{title}</h3>
      {refreshing ? (
        <span className="context-session-refresh" title="Refreshing">
          <RefreshCw size={14} />
        </span>
      ) : null}
      {status ? <span className={`context-session-status status-${stateClass(status)}`}>{traceLabel(status)}</span> : null}
    </div>
  );
}

function KeyValueRows({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="context-session-key-values">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd title={value}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function QuestionList({ questions }: { questions: string[] }): JSX.Element {
  if (questions.length === 0) {
    return <p className="context-session-empty">No open questions</p>;
  }
  return (
    <div className="context-session-list-block">
      <h4>Open Questions</h4>
      <ul>
        {questions.map((question, index) => (
          <li key={`${question}:${index}`}>{question}</li>
        ))}
      </ul>
    </div>
  );
}

function RecordList({
  emptyLabel,
  primaryKeys,
  records,
  secondaryKeys
}: {
  emptyLabel: string;
  primaryKeys: string[];
  records: Array<Record<string, unknown>>;
  secondaryKeys: string[];
}): JSX.Element {
  if (records.length === 0) {
    return <p className="context-session-empty">{emptyLabel}</p>;
  }
  return (
    <div className="context-session-list-block">
      <ul>
        {records.map((record, index) => {
          const primary = firstString(record, primaryKeys) ?? `Item ${index + 1}`;
          const secondary = firstString(record, secondaryKeys) ?? compactJson(record);
          return (
            <li key={`${primary}:${index}`}>
              <span title={primary}>{primary}</span>
              <small title={secondary}>{secondary}</small>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ObjectPreview({ emptyLabel, value }: { emptyLabel: string; value: Record<string, unknown> | null }): JSX.Element {
  if (!value || Object.keys(value).length === 0) {
    return <p className="context-session-empty">{emptyLabel}</p>;
  }
  return <pre className="context-session-object-preview">{JSON.stringify(value, null, 2)}</pre>;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(record[key]);
    if (value) return value;
  }
  return null;
}

function compactJson(value: unknown): string {
  try {
    return truncateText(JSON.stringify(value), 160);
  } catch {
    return String(value);
  }
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
