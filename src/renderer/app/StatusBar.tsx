import { memo } from 'react';
import type { JSX } from 'react';
import { Bell, Monitor, Settings } from 'lucide-react';
import type { HostEnvironment, RunDetail } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { ResearchMomentumLine } from '../features/momentum/ResearchMomentumLine';
import type { ResearchMomentum } from '../features/momentum/types';
import { hostEnvironmentLabel, type EnvironmentActivity } from '../view-models/environmentDisplay';

export const StatusBar = memo(function StatusBar({
  hostEnvironment,
  activity,
  detail,
  momentum,
  notificationCount,
  onOpenSettings
}: {
  hostEnvironment: HostEnvironment | null;
  activity: EnvironmentActivity;
  detail: RunDetail | null;
  momentum: ResearchMomentum;
  notificationCount: number;
  onOpenSettings: () => void;
}): JSX.Element {
  useDevRenderProbe('footer.statusBar', () => ({
    host: hostEnvironment?.platform ?? 'unknown',
    execution: 'host',
    momentum: momentum.state,
    notifications: notificationCount
  }));
  const osLabel = hostEnvironmentLabel(hostEnvironment);
  return (
    <footer className="status-bar">
      <div className="environment-switcher" aria-label="Environment target">
        <div className={`environment-pill ${activity.host ? 'is-active' : ''}`} title={`Host operating system: ${osLabel}`}>
          <Monitor size={14} />
          <span>{osLabel}</span>
        </div>
      </div>
      <ResearchMomentumLine detail={detail} momentum={momentum} />
      <div className="status-actions" aria-label="Application actions">
        <button type="button" className="status-icon-button" title="Settings" aria-label="Settings" onClick={onOpenSettings}>
          <Settings size={14} />
        </button>
        <button type="button" className="status-icon-button notification-button" title={`${notificationCount} unread notification${notificationCount === 1 ? '' : 's'}`}>
          <Bell size={15} />
          {notificationCount > 0 ? <span>{notificationCount}</span> : null}
        </button>
      </div>
    </footer>
  );
});
