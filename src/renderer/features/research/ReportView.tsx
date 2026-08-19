import { FileText, CircleAlert, LoaderCircle } from 'lucide-react';
import type { JSX } from 'react';
import type { HoneycrispReportDocument, HoneycrispReportSummary } from '@shared/types';
import { traceLabel } from '../../lib/formatting';
import { ModelAuthors } from '../../app/ModelAuthors';
import { renderTraceProseText } from '../traces/traceMarkup';

export function ReportView({ report, document, loading, error }: {
  report: HoneycrispReportSummary;
  document: HoneycrispReportDocument | null;
  loading: boolean;
  error: string | null;
}): JSX.Element {
  return (
    <section className="main-trace-view runbook-view report-view" aria-label={`Report: ${report.title}`}>
      <div className="runbook-view-scroll">
        <header className="runbook-view-header">
          <span className="runbook-view-eyebrow"><FileText size={15} aria-hidden="true" /> Report</span>
          <h2>{report.title}</h2>
          <ModelAuthors authors={report.authors} />
          {report.summary ? <p>{report.summary}</p> : null}
          <div className="runbook-view-meta">
            <span>{traceLabel(report.status)}</span>
            <span>Update {report.revision}</span>
          </div>
        </header>
        {loading ? (
          <div className="runbook-view-state"><LoaderCircle className="runbook-view-spinner" size={18} aria-hidden="true" /> Loading report.</div>
        ) : error ? (
          <div className="runbook-view-state is-error"><CircleAlert size={18} aria-hidden="true" /> {error}</div>
        ) : document ? (
          <article className="report-markdown-content">{renderTraceProseText(document.content, 'agent_output')}</article>
        ) : (
          <div className="runbook-view-state">This report has no content.</div>
        )}
      </div>
    </section>
  );
}
