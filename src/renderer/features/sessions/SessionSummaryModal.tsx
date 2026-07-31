import type { JSX } from 'react';
import type { RunDetail } from '@shared/types';
import { displaySessionTitle } from '../../../shared/sessionTitle';
import { BottomSheet } from '../../app/Modal';
import { sessionConfigPills } from '../../view-models/sessionHeader';
import { traceLabel } from '../../lib/formatting';

export function SessionSummaryModal({ detail, onClose }: { detail: RunDetail; onClose: () => void }): JSX.Element {
  const configPills = sessionConfigPills(detail);

  return (
    <BottomSheet title="Session Summary" wide onClose={onClose}>
      <div className="research-prompt-detail">
        <div className="research-prompt-title">
          <span>Session</span>
          <strong>{displaySessionTitle(detail.run.title, detail.run.promptMarkdown)}</strong>
          <div className="session-summary-pills" aria-label="Session configuration">
            {configPills.map((pill) => (
              <span className="session-summary-pill" title={pill.tooltip} aria-label={pill.tooltip} key={pill.tooltip}>
                {pill.label}
              </span>
            ))}
          </div>
        </div>
        {detail.run.finalDisposition ? (
          <section className="session-final-disposition" aria-label="Final disposition">
            <span className="research-prompt-section-label">Final disposition</span>
            <strong>{traceLabel(detail.run.finalDisposition.outcome)}</strong>
            <p>{detail.run.finalDisposition.summary}</p>
            <span className="session-final-disposition-state">
              {detail.run.finalDisposition.externalStateRequired ? 'External state required' : 'No external state required'}
            </span>
            {detail.run.finalDisposition.blockerDependencies.length > 0 ? (
              <ul>
                {detail.run.finalDisposition.blockerDependencies.map((dependency, index) => (
                  <li key={`${dependency.kind}:${index}`}>
                    <strong>{traceLabel(dependency.kind)}</strong>
                    <span>{dependency.description}</span>
                    <small>Required: {dependency.requiredState}</small>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        <span className="research-prompt-section-label">Original research prompt</span>
        <pre>{detail.run.promptMarkdown || 'No prompt recorded.'}</pre>
      </div>
    </BottomSheet>
  );
}
