import { useEffect, useMemo, useRef, useState } from 'react';
import type { JSX } from 'react';
import { CircleAlert, FileArchive, FileText, LoaderCircle } from 'lucide-react';
import type {
  ApprovalRecord,
  HoneycrispReportDocument,
  HoneycrispReportSummary,
  PolicyReviewDecision,
  ResearchModelSelection,
  ResearchProviderModelCatalog,
  RunDetail,
  ShellSafetyMode,
  SteeringAction,
  WorkspaceRegistryEntry
} from '@shared/types';
import { CenteredLoadingState } from '../../app/CenteredLoadingState';
import { traceLabel } from '../../lib/formatting';
import {
  joinReportBlockSelection,
  reportCatalogGroups,
  reportChangeInstruction,
  reportMarkdownBlocks,
  type ReportEditScope
} from '../../view-models/reports';
import type { TraceDisplayEvent } from '../../view-models/traceDisplay';
import { CommentaryView } from '../commentary/CommentaryView';
import { renderTraceProseText } from '../traces/traceMarkup';

export function ReportsIndex({
  reports,
  workspaces,
  selectedWorkspaceId,
  loading,
  error,
  onScopeChange,
  onOpenReport
}: {
  reports: readonly HoneycrispReportSummary[];
  workspaces: readonly WorkspaceRegistryEntry[];
  selectedWorkspaceId: string | null;
  loading: boolean;
  error: string | null;
  onScopeChange: (workspaceId: string | null) => void;
  onOpenReport: (report: HoneycrispReportSummary) => void;
}): JSX.Element {
  const groups = useMemo(() => reportCatalogGroups(reports), [reports]);
  const scopeTabs = [
    { id: null, key: 'all', label: 'All Reports' },
    ...workspaces
      .filter((workspace) => workspace.workspaceId.length > 0)
      .map((workspace) => ({ id: workspace.workspaceId, key: workspace.id, label: workspace.workspaceName }))
  ];
  return (
    <section className="reports-index" aria-label="Reporting">
      <div className="reports-index-tabs research-side-view-tabs research-side-view-tabs-scrollable" role="tablist" aria-label="Report workspace scope">
        {scopeTabs.map((scope) => {
          const selected = selectedWorkspaceId === scope.id;
          return (
            <div className={`research-side-view-tab provider-settings-tab reports-index-tab ${selected ? 'active' : ''}`.trim()} key={scope.key}>
              <button
                type="button"
                className="research-side-view-tab-activate"
                role="tab"
                aria-selected={selected}
                aria-controls="reports-index-panel"
                onClick={() => onScopeChange(scope.id)}
              >
                <span>{scope.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      <div id="reports-index-panel" role="tabpanel">
        {loading ? (
          <CenteredLoadingState label="Loading reports…" />
        ) : error ? (
          <div className="reports-index-empty is-error" role="alert">
            <CircleAlert size={20} aria-hidden="true" />
            <strong>Reports could not be loaded</strong>
            <span>{error}</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="reports-index-empty">
            <FileText size={20} aria-hidden="true" />
            <strong>No reports yet</strong>
            <span>Reports created by agents during research sessions will appear here.</span>
          </div>
        ) : (
          <div className="reports-index-list">
            {groups.complete.length > 0 ? (
              <ReportsIndexSection reports={groups.complete} label="Complete" onOpenReport={onOpenReport} />
            ) : null}
            {groups.stale.length > 0 ? (
              <ReportsIndexSection reports={groups.stale} label="Stale" onOpenReport={onOpenReport} />
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function ReportsIndexSection({ reports, label, onOpenReport }: {
  reports: readonly HoneycrispReportSummary[];
  label: 'Complete' | 'Stale';
  onOpenReport: (report: HoneycrispReportSummary) => void;
}): JSX.Element {
  return (
    <section className="reports-index-section" aria-label={`${reports.length} ${label} reports`}>
      <h2>{reports.length} {label}</h2>
      <div className="reports-index-section-items">
        {reports.map((report) => (
          <button
            type="button"
            className="reports-index-row"
            onClick={() => onOpenReport(report)}
            key={`${report.workspaceId}:${report.id}`}
          >
            <span className="reports-index-row-copy">
              <strong>{report.title}</strong>
              <span>{report.summary || 'No summary available.'}</span>
              <small className="reports-index-row-workspace">{report.workspaceName}</small>
            </span>
            <span className={`reports-index-status status-${report.status}`}>{traceLabel(report.status)}</span>
            <span className="reports-index-revision">Update {report.revision}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ReportSessionWorkspace({
  report,
  document,
  loading,
  error,
  detail,
  events,
  providerModelCatalog,
  initialModelSelection,
  responseSuggestionsEnabled = true,
  selectedRunId,
  shellApproval,
  shellApprovalBusy,
  busy,
  onInitialInstruction,
  onShellApprovalDecision,
  onSessionAction,
  onReportChange,
  onOpenSubmissionPacket,
  onSteerInstruction
}: {
  report: HoneycrispReportSummary;
  document: HoneycrispReportDocument | null;
  loading: boolean;
  error: string | null;
  detail: RunDetail | null;
  events: TraceDisplayEvent[];
  providerModelCatalog: ResearchProviderModelCatalog[];
  initialModelSelection: ResearchModelSelection | null;
  responseSuggestionsEnabled?: boolean;
  selectedRunId: string | null;
  shellApproval: ApprovalRecord | null;
  shellApprovalBusy: boolean;
  busy: boolean;
  onInitialInstruction: (
    instruction: string,
    modelSelection: ResearchModelSelection,
    shellSafetyMode: ShellSafetyMode
  ) => void;
  onShellApprovalDecision: (decision: PolicyReviewDecision) => void;
  onSessionAction: (action: SteeringAction) => void;
  onReportChange: (instruction: string) => Promise<void>;
  onOpenSubmissionPacket: () => Promise<void>;
  onSteerInstruction: (runId: string, instruction: string, modelSelection: ResearchModelSelection) => void;
}): JSX.Element {
  return (
    <div className="report-session-grid">
      <div className="report-session-chat">
        <CommentaryView
          key={report.id}
          busy={busy}
          detail={detail}
          events={events}
          providerModelCatalog={providerModelCatalog}
          initialModelSelection={initialModelSelection ?? undefined}
          selectedRunId={selectedRunId}
          initialSuggestion={selectedRunId ? undefined : 'Review this report.'}
          responseSuggestionsEnabled={responseSuggestionsEnabled}
          showBackToMain={false}
          searchHighlightQuery=""
          shellApproval={shellApproval}
          shellApprovalBusy={shellApprovalBusy}
          onBackToMain={() => undefined}
          onInitialInstruction={onInitialInstruction}
          onShellApprovalDecision={onShellApprovalDecision}
          onSessionAction={onSessionAction}
          onSteerInstruction={onSteerInstruction}
        />
      </div>
      <EditableReport
        report={report}
        document={document}
        loading={loading}
        error={error}
        onChange={onReportChange}
        onOpenSubmissionPacket={onOpenSubmissionPacket}
      />
    </div>
  );
}

export function EditableReport({ report, document, loading, error, onChange, onOpenSubmissionPacket }: {
  report: HoneycrispReportSummary;
  document: HoneycrispReportDocument | null;
  loading: boolean;
  error: string | null;
  onChange: (instruction: string) => Promise<void>;
  onOpenSubmissionPacket: () => Promise<void>;
}): JSX.Element {
  const blocks = useMemo(() => reportMarkdownBlocks(document?.content ?? ''), [document?.content]);
  const blockIds = useMemo(() => blocks.map((block) => block.id), [blocks]);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [selectionAnchorIndex, setSelectionAnchorIndex] = useState<number | null>(null);
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [editScope, setEditScope] = useState<ReportEditScope>('selection');
  const [changeRequest, setChangeRequest] = useState('');
  const [changePending, setChangePending] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [packetOpening, setPacketOpening] = useState(false);
  const [packetError, setPacketError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (editingBlockId) editorRef.current?.focus();
  }, [editingBlockId]);
  useEffect(() => {
    setEditingBlockId(null);
    setSelectedBlockIds([]);
    setSelectionAnchorIndex(null);
    setEditScope('selection');
    setChangeRequest('');
    setChangePending(false);
    setChangeError(null);
    setPacketOpening(false);
    setPacketError(null);
  }, [document?.content, report.id]);

  const selectBlock = (blockIndex: number, shiftKey: boolean, toggleKey: boolean): void => {
    const selection = joinReportBlockSelection({
      blockIds,
      selectedBlockIds,
      anchorIndex: selectionAnchorIndex,
      blockIndex,
      shiftKey,
      toggleKey
    });
    const clickedBlockId = blockIds[blockIndex] ?? null;
    setSelectedBlockIds(selection.blockIds);
    setSelectionAnchorIndex(selection.anchorIndex);
    setEditingBlockId(clickedBlockId && selection.blockIds.includes(clickedBlockId)
      ? clickedBlockId
      : selection.blockIds.at(-1) ?? null);
    if (!shiftKey && !toggleKey) {
      setChangeRequest('');
      setEditScope('selection');
    }
    setChangeError(null);
  };

  return (
    <section className="report-session-document" aria-label={`Report: ${report.title}`}>
      <div className="report-session-document-scroll">
        <header className="report-session-document-header">
          <h1>{report.title}</h1>
          {report.summary ? <p>{report.summary}</p> : null}
          <div className="report-session-meta"><span>{traceLabel(report.status)}</span><span>Update {report.revision}</span></div>
          {report.submissionPacket ? (
            <div className="report-submission-packet">
              <FileArchive size={19} aria-hidden="true" />
              <div className="report-submission-packet-copy">
                <strong>{report.submissionPacket.filename}</strong>
                <span>{formatFileSize(report.submissionPacket.sizeBytes)}</span>
                <code>{report.submissionPacket.contentHash}</code>
              </div>
              <button type="button" disabled={packetOpening} onClick={async () => {
                setPacketOpening(true);
                setPacketError(null);
                try {
                  await onOpenSubmissionPacket();
                } catch (caught: unknown) {
                  setPacketError(caught instanceof Error ? caught.message : String(caught));
                } finally {
                  setPacketOpening(false);
                }
              }}>{packetOpening ? 'Opening…' : 'Open packet'}</button>
              {packetError ? <p role="alert">{packetError}</p> : null}
            </div>
          ) : null}
        </header>
        {loading && !document ? (
          <div className="report-session-state"><LoaderCircle className="runbook-view-spinner" size={18} /> Loading report.</div>
        ) : error ? (
          <div className="report-session-state is-error"><CircleAlert size={18} /> {error}</div>
        ) : document ? (
          <article className="report-session-content" aria-label="Editable report content">
            <p className="report-session-edit-hint">Select a section. Shift-click joins a range; Ctrl-click adds or removes sections.</p>
            {blocks.map((block, blockIndex) => {
              const editing = editingBlockId === block.id;
              const selected = selectedBlockIds.includes(block.id);
              return (
                <section className={`report-editable-block${selected ? ' is-selected' : ''}${editing ? ' is-editing' : ''}`} key={block.id}>
                  <div
                    className="report-editable-block-content"
                    role="button"
                    tabIndex={0}
                    aria-label={`Highlight report lines ${block.startLine} through ${block.endLine}`}
                    aria-pressed={selected}
                    aria-expanded={editing}
                    onClick={(event) => selectBlock(blockIndex, event.shiftKey, event.ctrlKey || event.metaKey)}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      selectBlock(blockIndex, event.shiftKey, event.ctrlKey || event.metaKey);
                    }}
                  >
                    {renderTraceProseText(block.content, 'agent_output')}
                  </div>
                  {editing ? (
                    <div className="report-inline-change">
                      <textarea
                        ref={editorRef}
                        value={changeRequest}
                        placeholder="Describe the change…"
                        rows={3}
                        disabled={changePending}
                        onChange={(event) => setChangeRequest(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            setEditingBlockId(null);
                            setSelectedBlockIds([]);
                          }
                        }}
                      />
                      <fieldset className="report-inline-edit-scope" disabled={changePending}>
                        <legend>Editable</legend>
                        <div className="report-inline-edit-scope-options">
                          <label>
                            <input
                              type="radio"
                              name={`report-edit-scope-${report.id}`}
                              value="selection"
                              checked={editScope === 'selection'}
                              onChange={() => setEditScope('selection')}
                            />
                            <span>Only the highlighted section</span>
                          </label>
                          <label>
                            <input
                              type="radio"
                              name={`report-edit-scope-${report.id}`}
                              value="report"
                              checked={editScope === 'report'}
                              onChange={() => setEditScope('report')}
                            />
                            <span>Anywhere in the report</span>
                          </label>
                        </div>
                      </fieldset>
                      {changeError ? <p className="report-inline-change-error" role="alert">{changeError}</p> : null}
                      <div className="report-inline-change-actions">
                        <button type="button" disabled={changePending} onClick={() => {
                          setEditingBlockId(null);
                          setSelectedBlockIds([]);
                        }}>Cancel</button>
                        <button
                          type="button"
                          className="primary"
                          disabled={changePending || !changeRequest.trim()}
                          onClick={async () => {
                            const selectedBlocks = blocks.filter((candidate) => selectedBlockIds.includes(candidate.id));
                            const instruction = reportChangeInstruction(selectedBlocks, changeRequest, editScope);
                            if (!instruction) return;
                            setChangePending(true);
                            setChangeError(null);
                            try {
                              await onChange(instruction);
                              setEditingBlockId(null);
                              setSelectedBlockIds([]);
                              setChangeRequest('');
                            } catch (caught: unknown) {
                              setChangeError(caught instanceof Error ? caught.message : String(caught));
                            } finally {
                              setChangePending(false);
                            }
                          }}
                        >
                          {changePending ? 'Changing…' : 'Change'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </section>
              );
            })}
          </article>
        ) : (
          <div className="report-session-state">This report has no content.</div>
        )}
      </div>
    </section>
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_048_576) return `${(sizeBytes / 1_024).toFixed(1)} KB`;
  return `${(sizeBytes / 1_048_576).toFixed(1)} MB`;
}
