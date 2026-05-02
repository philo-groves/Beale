import { useState } from 'react';
import type { JSX } from 'react';
import { ChevronRight, XCircle } from 'lucide-react';
import type { NotificationRecord } from '@shared/types';
import { Modal } from '../../app/Modal';
import { truncateText } from '../../lib/formatting';

export interface WorkspaceAlert {
  id: string;
  title: string;
  bodyMarkdown: string;
  severity?: 'info' | 'error';
}

export function NotificationStack({
  notifications,
  alerts = [],
  onOpen,
  onDismiss,
  onOpenAlert,
  onDismissAlert
}: {
  notifications: NotificationRecord[];
  alerts?: WorkspaceAlert[];
  onOpen: (notification: NotificationRecord) => void;
  onDismiss: (notificationId: string) => void;
  onOpenAlert?: (alert: WorkspaceAlert) => void;
  onDismissAlert?: (alertId: string) => void;
}): JSX.Element | null {
  if (notifications.length === 0 && alerts.length === 0) return null;
  return (
    <div className="notification-stack" aria-label="Notifications">
      {alerts.map((alert) => (
        <article className={`notification-toast notification-alert notification-alert-${alert.severity ?? 'info'}`} key={alert.id}>
          <button type="button" className="notification-toast-main" onClick={() => onOpenAlert?.(alert)}>
            <span className="notification-toast-title">{alert.title}</span>
            <span className="notification-toast-body">{alertPreviewText(alert.bodyMarkdown, 180)}</span>
          </button>
          <button
            type="button"
            className="notification-toast-close"
            title="Dismiss alert"
            aria-label="Dismiss alert"
            onClick={() => onDismissAlert?.(alert.id)}
          >
            <XCircle size={15} />
          </button>
        </article>
      ))}
      {notifications.map((notification) => (
        <article className="notification-toast" key={notification.id}>
          <button type="button" className="notification-toast-main" onClick={() => onOpen(notification)}>
            <span className="notification-toast-title">{notification.title}</span>
            <span className="notification-toast-body">{notificationPreviewText(notification.bodyMarkdown, 140)}</span>
          </button>
          <button
            type="button"
            className="notification-toast-close"
            title="Dismiss notification"
            aria-label="Dismiss notification"
            onClick={() => onDismiss(notification.id)}
          >
            <XCircle size={15} />
          </button>
        </article>
      ))}
    </div>
  );
}

export function NotificationDetailModal({
  notification,
  busy,
  onClose,
  onSteer
}: {
  notification: NotificationRecord;
  busy: boolean;
  onClose: () => void;
  onSteer: (instruction: string) => void;
}): JSX.Element {
  const [instruction, setInstruction] = useState('');
  const trimmedInstruction = instruction.trim();
  return (
    <Modal
      title={notification.title}
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary-button" disabled={busy || !trimmedInstruction} onClick={() => onSteer(trimmedInstruction)}>
            <ChevronRight size={15} />
            Steer
          </button>
        </>
      }
    >
      <div className="notification-detail">
        <pre>{notification.bodyMarkdown}</pre>
        <label>
          Steer
          <textarea
            rows={4}
            value={instruction}
            placeholder="Add direction for this research session"
            onChange={(event) => setInstruction(event.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

export function notificationPreviewText(markdown: string, maxLength: number): string {
  return truncateText(firstMarkdownSentence(markdown) || markdown.replace(/\s+/g, ' ').trim(), maxLength);
}

export function alertPreviewText(markdown: string, maxLength: number): string {
  return truncateText(markdown.replace(/\s+/g, ' ').trim(), maxLength);
}

function firstMarkdownSentence(markdown: string): string {
  const rawLines = markdown.split(/\r?\n/);
  const contentLines = rawLines.length > 1 && /^#{1,6}\s+/.test(rawLines[0]?.trim() ?? '') ? rawLines.slice(1) : rawLines;
  const lines = contentLines
    .map((line) => line.replace(/^#{1,6}\s+/, '').replace(/^[*\-\d.]+\s+/, '').trim())
    .filter(Boolean);
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).trim();
}
