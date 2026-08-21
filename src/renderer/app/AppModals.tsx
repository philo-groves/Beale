import type { JSX } from 'react';
import type {
  NotificationRecord,
  ProfilingReport,
  ProfilingState
} from '@shared/types';
import { NotificationDetailModal } from '../features/notifications/Notifications';
import { ProfilingModal } from '../features/settings/ProfilingModal';

export function AppModals({
  activeNotification,
  busy,
  profilingOpen,
  profilingState,
  lastProfilingReport,
  onCloseNotification,
  onCloseProfiling,
  onFlushProfilingReport,
  onSteerNotification
}: {
  activeNotification: NotificationRecord | null;
  busy: boolean;
  profilingOpen: boolean;
  profilingState: ProfilingState | null;
  lastProfilingReport: ProfilingReport | null;
  onCloseNotification: () => void;
  onCloseProfiling: () => void;
  onFlushProfilingReport: () => void;
  onSteerNotification: (notification: NotificationRecord, instruction: string) => void;
}): JSX.Element {
  return (
    <>
      {profilingOpen ? (
        <ProfilingModal
          state={profilingState}
          report={lastProfilingReport}
          onClose={onCloseProfiling}
          onFlush={onFlushProfilingReport}
        />
      ) : null}
      {activeNotification ? (
        <NotificationDetailModal
          notification={activeNotification}
          busy={busy}
          onClose={onCloseNotification}
          onSteer={(instruction) => onSteerNotification(activeNotification, instruction)}
        />
      ) : null}
    </>
  );
}
