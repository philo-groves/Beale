import { memo } from 'react';
import type { JSX } from 'react';
import { Settings } from 'lucide-react';
import type { RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { isSessionUsageVisible, SessionUsageStatus } from '../features/momentum/SessionUsageStatus';

export const StatusBar = memo(function StatusBar({
  detail,
  onOpenSettings
}: {
  detail: RunDetail | null;
  onOpenSettings: () => void;
}): JSX.Element {
  useDevRenderProbe('footer.statusBar', () => ({
    hasSession: Boolean(detail)
  }));

  return (
    <footer className="status-bar" aria-label="Session usage and application settings">
      <button type="button" className="status-settings-button" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
        <Settings size={14} />
      </button>
      {isSessionUsageVisible(detail) ? <SessionUsageStatus detail={detail} /> : null}
    </footer>
  );
});
