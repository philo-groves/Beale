import { useState } from 'react';
import type { JSX } from 'react';
import type { FindingRecord, HypothesisRecord, RunDetail, TraceEventRecord } from '@shared/types';
import { Modal } from '../../app/Modal';
import { formatPriorityPill, formatSessionStart, traceLabel } from '../../lib/formatting';
import { stringRecordValue, toolNameFromSummary, traceCategoryForEvent, tracePayloadPrimitive, tracePayloadRecord } from '../../traceClassification';
import { compactTracePath, isProseTraceEvent, lineRangePart, pythonTraceScript, traceEventDetailText, traceEventSummary } from '../../view-models/traceContent';
import { CwePill } from '../research/CwePill';
import { highlightJsonCode, highlightPythonCode, renderTraceProseText } from './traceMarkup';
import { traceCategoryIcon, traceCategoryLabel, traceTypeLabel } from './traceVisuals';

export function TraceDetailModal({
  detail,
  event,
  finding,
  hypothesis,
  onClose
}: {
  detail: RunDetail | null;
  event: TraceEventRecord;
  finding: FindingRecord | null;
  hypothesis: HypothesisRecord | null;
  onClose: () => void;
}): JSX.Element {
  const category = traceCategoryForEvent(event);
  const payload = JSON.stringify(event.payload, null, 2);

  return (
    <Modal
      title={traceEventSummary(event, category)}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modal-footer-leading" onClick={() => void copyTextToClipboard(event.id)}>
            Copy Trace ID
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div className="trace-detail">
        <div className="trace-inspector-summary trace-detail-summary">
          <span className={`trace-filter-icon category-${category}`}>{traceCategoryIcon(category)}</span>
          <div>
            <strong>{traceCategoryLabel(category)}</strong>
            <p>{event.summary}</p>
          </div>
        </div>
        {finding ? <FindingInspectorContext finding={finding} hypothesis={hypothesis} /> : null}
        {!finding && hypothesis ? <HypothesisInspectorContext hypothesis={hypothesis} /> : null}
        <TraceTypedDetail detail={detail} event={event} />
        <div className="trace-inspector-grid">
          <div>
            <span>Time</span>
            <strong>{formatSessionStart(new Date(event.createdAt))}</strong>
          </div>
          <div>
            <span>Event</span>
            <strong>{event.sequence}</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>{traceLabel(event.source)}</strong>
          </div>
          <div>
            <span>Type</span>
            <strong>{traceTypeLabel(event.type)}</strong>
          </div>
          <div>
            <span>Model Visible</span>
            <strong>{event.modelVisible ? 'Yes' : 'No'}</strong>
          </div>
          <div>
            <span>Sensitivity</span>
            <strong>{traceLabel(event.sensitivity)}</strong>
          </div>
        </div>
        <div className="trace-inspector-links">
          <span>References</span>
          <InspectorReference label="id" value={event.id} />
          {event.attemptId ? <InspectorReference label="attempt" value={event.attemptId} /> : null}
          {event.vmContextId ? <InspectorReference label="vm" value={event.vmContextId} /> : null}
          {event.artifactId ? <InspectorReference label="artifact" value={event.artifactId} /> : null}
          {event.toolCallId ? <InspectorReference label="tool" value={event.toolCallId} /> : null}
          {event.approvalId ? <InspectorReference label="approval" value={event.approvalId} /> : null}
        </div>
        <details className="trace-inspector-payload">
          <summary>Payload JSON</summary>
          <pre>
            {payload === '{}' ? (
              'No payload recorded.'
            ) : (
              <code className="syntax-code language-json">{highlightJsonCode(payload)}</code>
            )}
          </pre>
        </details>
      </div>
    </Modal>
  );
}

function TraceTypedDetail({ detail, event }: { detail: RunDetail | null; event: TraceEventRecord }): JSX.Element | null {
  const category = traceCategoryForEvent(event);
  const toolName = tracePayloadPrimitive(event.payload, 'toolName') ?? toolNameFromSummary(event.summary);
  if (toolName === 'python' || /^Host python|^Guest python/i.test(event.summary)) return <PythonTraceDetail detail={detail} event={event} />;
  if (category === 'code_navigation') return <CodeNavigationTraceDetail event={event} />;

  const detailText = traceEventDetailText(event, category, detail);
  if (!detailText) return null;
  const prose = isProseTraceEvent(event, category, detail);
  return (
    <section className="trace-detail-section" aria-label="Trace content">
      <span>Content</span>
      <div className={prose ? 'trace-detail-prose' : 'trace-detail-compact'}>{prose ? renderTraceProseText(detailText, category) : <code>{detailText}</code>}</div>
    </section>
  );
}

function PythonTraceDetail({ detail, event }: { detail: RunDetail | null; event: TraceEventRecord }): JSX.Element {
  const args = tracePayloadRecord(event.payload, 'arguments');
  const scriptDetail = pythonTraceScript(event, detail);
  const task = scriptDetail?.task || (args ? stringRecordValue(args, 'task') : tracePayloadPrimitive(event.payload, 'task'));
  const script = scriptDetail?.script ?? '';
  const status = tracePayloadPrimitive(event.payload, 'status');
  const stdout = tracePayloadPrimitive(event.payload, 'stdoutSummary');
  const stderr = tracePayloadPrimitive(event.payload, 'stderrSummary');

  return (
    <section className="trace-detail-section" aria-label="Python trace detail">
      <span>Python</span>
      {task ? <p>{task}</p> : null}
      <div className="trace-detail-facts">
        {status ? <span>Status {traceLabel(status)}</span> : null}
        {tracePayloadPrimitive(event.payload, 'exitCode') ? <span>Exit {tracePayloadPrimitive(event.payload, 'exitCode')}</span> : null}
        {tracePayloadPrimitive(event.payload, 'durationMs') ? <span>{tracePayloadPrimitive(event.payload, 'durationMs')}ms</span> : null}
      </div>
      {script ? (
        <pre className="trace-detail-code">
          <code className="syntax-code language-python">{highlightPythonCode(script)}</code>
        </pre>
      ) : null}
      {stdout || stderr ? (
        <div className="trace-detail-output">
          {stdout ? (
            <div>
              <span>Stdout</span>
              <pre>{stdout}</pre>
            </div>
          ) : null}
          {stderr ? (
            <div>
              <span>Stderr</span>
              <pre>{stderr}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function CodeNavigationTraceDetail({ event }: { event: TraceEventRecord }): JSX.Element {
  const sourcePath = tracePayloadPrimitive(event.payload, 'sourcePath') ?? tracePayloadPrimitive(event.payload, 'path');
  const excerpt = tracePayloadPrimitive(event.payload, 'excerpt');
  const query = tracePayloadPrimitive(event.payload, 'query');
  const matches = tracePayloadPrimitive(event.payload, 'matches');

  return (
    <section className="trace-detail-section" aria-label="Code navigation trace detail">
      <span>Code Nav</span>
      <div className="trace-detail-facts">
        {sourcePath ? <span>{compactTracePath(sourcePath)}</span> : null}
        {query ? <span>Query {query}</span> : null}
        {matches ? <span>{matches} matches</span> : null}
        {lineRangePart(event.payload) ? <span>{lineRangePart(event.payload)}</span> : null}
      </div>
      {excerpt ? (
        <pre className="trace-detail-code">
          <code>{excerpt}</code>
        </pre>
      ) : (
        <div className="trace-detail-compact">
          <code>{traceEventDetailText(event, traceCategoryForEvent(event)) || 'No source excerpt recorded.'}</code>
        </div>
      )}
    </section>
  );
}

function FindingInspectorContext({ finding, hypothesis }: { finding: FindingRecord; hypothesis: HypothesisRecord | null }): JSX.Element {
  const affectedSurface =
    hypothesis?.component ??
    stringRecordValue(finding.affectedAssets, 'component') ??
    stringRecordValue(finding.affectedAssets, 'asset') ??
    stringRecordValue(finding.affectedAssets, 'path') ??
    stringRecordValue(finding.affectedAssets, 'service') ??
    'Unknown surface';

  return (
    <section className="trace-inspector-context" aria-label="Finding context">
      <div className="trace-inspector-context-header">
        <span>Finding</span>
        <div className="main-hypothesis-meta main-finding-meta" aria-label="Finding state, priority, and CWE">
          <span className="hypothesis-pill state-pill">{traceLabel(finding.state)}</span>
          <span className="hypothesis-pill priority-pill">{formatPriorityPill(finding.priorityScore)}</span>
          <CwePill mappings={finding.cweMappings} />
        </div>
      </div>
      <strong>{finding.title}</strong>
      <p>{finding.summaryMarkdown || 'No summary recorded.'}</p>
      <dl className="trace-inspector-context-facts">
        <div>
          <dt>Surface</dt>
          <dd>{affectedSurface}</dd>
        </div>
        <div>
          <dt>Impact</dt>
          <dd>{finding.impactMarkdown || 'Impact not yet assessed.'}</dd>
        </div>
      </dl>
    </section>
  );
}

function HypothesisInspectorContext({ hypothesis }: { hypothesis: HypothesisRecord }): JSX.Element {
  return (
    <section className="trace-inspector-context" aria-label="Hypothesis context">
      <div className="trace-inspector-context-header">
        <span>Hypothesis</span>
        <div className="main-hypothesis-meta" aria-label="Hypothesis state, priority, and CWE">
          <span className="hypothesis-pill state-pill">{traceLabel(hypothesis.state)}</span>
          <span className="hypothesis-pill priority-pill">{formatPriorityPill(hypothesis.priorityScore)}</span>
          <CwePill mappings={hypothesis.cweMappings} />
        </div>
      </div>
      <strong>{hypothesis.title}</strong>
      <p>{hypothesis.descriptionMarkdown || 'No description recorded.'}</p>
    </section>
  );
}

function InspectorReference({ label, value }: { label: string; value: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copyValue = (): void => {
    void copyTextToClipboard(value).then((success) => {
      if (!success) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="trace-inspector-reference">
      <span>{label}:</span>
      <button
        type="button"
        className="trace-inspector-reference-value"
        title={copied ? 'Copied' : `Copy ${label}`}
        aria-label={copied ? `Copied ${label}` : `Copy ${label}`}
        onClick={copyValue}
      >
        <code>{value}</code>
      </button>
    </div>
  );
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}
