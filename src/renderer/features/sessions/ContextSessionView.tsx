import { useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { Braces, Database, ListChecks, RefreshCw, Users, Wrench } from 'lucide-react';
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
  const request = useMemo(() => readRecord(payload.request), [payload]);
  const workspaceContext = useMemo(() => readRecord(payload.workspaceContext), [payload]);
  const memoryContext = useMemo(() => readRecordArray(payload.memoryContext), [payload]);
  const availableTools = useMemo(() => readRecordArray(payload.availableTools), [payload]);
  const collaborationTools = useMemo(() => readRecordArray(payload.collaborationTools), [payload]);
  const requestLabel = firstString(request ?? {}, ['prompt']) ?? 'None';
  const findingNodes = honeycrispMemory?.nodes.filter((node) => node.type === 'finding') ?? [];
  const injectedReferenceCount = memoryContext.reduce((count, node) => count + arrayLength(node.evidence), 0);
  const injectedRelationshipCount = memoryContext.reduce((count, node) => count + arrayLength(node.relationships), 0);

  return (
    <div className="context-session-workspace" aria-label="Context view">
      <div className="context-session-scroll">
        <div className="context-session-summary-grid" aria-label="Context summary">
          <SummaryTile
            icon={<Database size={17} />}
            label="Workspace DB"
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
            icon={<ListChecks size={17} />}
            label="Selected Skills"
            value={formatCount(selectedSkills.length)}
            detail={selectedSkills[0] ? firstString(selectedSkills[0], ['description', 'id']) ?? 'Configured' : 'None'}
          />
          <SummaryTile
            icon={<Wrench size={17} />}
            label="Available Tools"
            value={formatCount(availableTools.length)}
            detail={availableTools[0] ? firstString(availableTools[0], ['name']) ?? 'Configured' : 'None'}
          />
          <SummaryTile
            icon={<Users size={17} />}
            label="Collaboration"
            value={formatCount(collaborationTools.length)}
            detail={collaborationTools.length > 0 ? 'Subagent tools' : 'None'}
          />
          <SummaryTile
            icon={<Database size={17} />}
            label="Injected Memory"
            value={formatCount(memoryContext.length)}
            detail={memoryContext[0] ? firstString(memoryContext[0], ['title', 'id']) ?? 'Selected' : 'None'}
          />
          <SummaryTile
            icon={<ListChecks size={17} />}
            label="References"
            value={`${formatCount(injectedReferenceCount)} injected refs`}
            detail={`${formatCount(injectedRelationshipCount)} injected relationships`}
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
                ['Request', truncateText(requestLabel, 140)],
                ['Read', state?.readAt ? formatSessionDateTime(state.readAt) : 'Pending'],
                ['Payload Hash', latestEvent?.payloadHash ?? 'None']
              ]}
            />
          </section>

          <section className="context-session-section" aria-label="Research request">
            <SectionHeader icon={<Braces size={16} />} title="Research Request" />
            <ObjectPreview value={request} emptyLabel="No research request" />
          </section>

          <section className="context-session-section" aria-label="Workspace context">
            <SectionHeader icon={<Braces size={16} />} title="Workspace Context" />
            <ObjectPreview value={workspaceContext} emptyLabel="No workspace context" />
          </section>

          <section className="context-session-section" aria-label="Selected skills">
            <SectionHeader icon={<ListChecks size={16} />} title="Selected Skills" />
            <RecordList records={selectedSkills} emptyLabel="No selected skills" primaryKeys={['name', 'id']} secondaryKeys={['purpose', 'summary', 'description']} />
          </section>

          <section className="context-session-section" aria-label="Injected memory">
            <SectionHeader icon={<Database size={16} />} title="Injected Memory" />
            <RecordList
              records={memoryContext.map(memoryContextListRecord)}
              emptyLabel="No memory selected for this request"
              primaryKeys={['title', 'id']}
              secondaryKeys={['detail', 'summary']}
            />
          </section>

          <section className="context-session-section" aria-label="Honeycrisp findings">
            <SectionHeader icon={<Database size={16} />} title="Honeycrisp Findings" status={honeycrispMemory?.source ?? 'none'} />
            <RecordList
              records={findingNodes.map((node) => ({
                id: node.id,
                title: node.title,
                detail: node.summary || node.body,
                status: node.status
              }))}
              emptyLabel="No Honeycrisp findings"
              primaryKeys={['title', 'id']}
              secondaryKeys={['detail', 'status']}
            />
          </section>

          <section className="context-session-section" aria-label="Honeycrisp knowledge relationships">
            <SectionHeader icon={<ListChecks size={16} />} title="Knowledge Relationships" />
            <RecordList
              records={(honeycrispMemory?.edges ?? []).map((edge) => ({
                id: `${edge.fromId}:${edge.relation}:${edge.toId}`,
                relation: edge.relation,
                from: edge.fromId,
                to: edge.toId,
                note: edge.note
              }))}
              emptyLabel="No knowledge relationships"
              primaryKeys={['relation', 'id']}
              secondaryKeys={['note', 'from', 'to']}
            />
          </section>

          <section className="context-session-section" aria-label="Available tools">
            <SectionHeader icon={<Wrench size={16} />} title="Available Tools" />
            <RecordList
              records={availableTools}
              emptyLabel="No model tools"
              primaryKeys={['name']}
              secondaryKeys={['description', 'sideEffects']}
            />
          </section>

          <section className="context-session-section" aria-label="Collaboration tools">
            <SectionHeader icon={<Users size={16} />} title="Collaboration" />
            <RecordList
              records={collaborationTools}
              emptyLabel="No collaboration tools"
              primaryKeys={['name']}
              secondaryKeys={['description']}
            />
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

function memoryContextListRecord(record: Record<string, unknown>): Record<string, unknown> {
  const evidenceCount = Array.isArray(record.evidence) ? record.evidence.length : 0;
  const relationshipCount = Array.isArray(record.relationships) ? record.relationships.length : 0;
  const identity = [
    stringValue(record.tier),
    stringValue(record.type),
    stringValue(record.status)
  ].filter((value): value is string => Boolean(value));
  const summary = firstString(record, ['summary', 'body']) ?? 'No summary';
  return {
    ...record,
    detail: `${identity.join(' / ') || 'memory'} · ${summary} · ${formatCount(evidenceCount)} refs · ${formatCount(relationshipCount)} relationships`
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
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
