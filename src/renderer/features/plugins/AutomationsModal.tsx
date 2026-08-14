import type { JSX } from 'react';
import { CalendarClock, ExternalLink, Trash2 } from 'lucide-react';
import type { RunRow, WorkspaceSnapshot } from '@shared/types';
import { normalizeRepeatSchedule, repeatScheduleLabel } from '../../../shared/repeatSchedule';
import { Modal } from '../../app/Modal';

interface RepeatAutomation {
  runId: string;
  title: string;
  scheduleLabel: string;
  status: string;
  createdAt: string;
  promptPreview: string;
}

export function AutomationsModal({
  snapshot,
  busy,
  onCancelRepeat,
  onClose,
  onOpenSession
}: {
  snapshot: WorkspaceSnapshot | null;
  busy: boolean;
  onCancelRepeat: (runId: string) => void;
  onClose: () => void;
  onOpenSession: (runId: string) => void;
}): JSX.Element {
  const automations = (snapshot?.runs ?? [])
    .map(repeatAutomationFromRun)
    .filter((automation): automation is RepeatAutomation => automation !== null);

  return (
    <Modal title="Automations" className="start-run-dialog automations-dialog" wide onClose={onClose} closeDisabled={busy}>
      <div className="automations-body">
        {automations.length > 0 ? (
          <section className="automations-list" aria-label="Scheduled repeats">
            {automations.map((automation) => (
              <article className="automation-card" key={automation.runId}>
                <div className="automation-card-heading">
                  <div className="automation-card-title">
                    <CalendarClock size={16} aria-hidden="true" />
                    <div>
                      <strong>{automation.title}</strong>
                      <span>{automation.scheduleLabel}</span>
                    </div>
                  </div>
                  <div className="automation-actions">
                    <button type="button" disabled={busy} title="Open session" onClick={() => onOpenSession(automation.runId)}>
                      <ExternalLink size={15} />
                      <span>Open</span>
                    </button>
                    <button type="button" disabled={busy} title="Cancel repeat" onClick={() => onCancelRepeat(automation.runId)}>
                      <Trash2 size={15} />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>
                <div className="automation-meta">
                  <span>{statusLabel(automation.status)}</span>
                  <span>Created {formatShortDate(automation.createdAt)}</span>
                </div>
                {automation.promptPreview ? <p>{automation.promptPreview}</p> : null}
              </article>
            ))}
          </section>
        ) : (
          <div className="automations-empty">
            <strong>No scheduled repeats</strong>
            <span>Repeat schedules added from New Research will appear here.</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function repeatAutomationFromRun(row: RunRow): RepeatAutomation | null {
  const schedule = normalizeRepeatSchedule(row.run.budget.repeatSchedule);
  if (schedule.type === 'none') return null;
  return {
    runId: row.run.id,
    title: row.run.title,
    scheduleLabel: repeatScheduleLabel(schedule),
    status: row.run.status,
    createdAt: row.run.createdAt,
    promptPreview: row.run.promptMarkdown.replace(/\s+/g, ' ').trim().slice(0, 220)
  };
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function statusLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}
