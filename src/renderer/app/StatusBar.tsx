import { memo } from 'react';
import type { JSX } from 'react';
import { Bell, Monitor, PanelRightClose, PanelRightOpen, Server, Settings } from 'lucide-react';
import type { ExecutorStatus, HostEnvironment, RunDetail, VmPreference } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { ResearchMomentumLine } from '../features/momentum/ResearchMomentumLine';
import type { ResearchMomentum } from '../features/momentum/types';
import { hostEnvironmentLabel, vmTargetStatus, type EnvironmentActivity } from '../view-models/environmentDisplay';

export const StatusBar = memo(function StatusBar({
  hostEnvironment,
  executor,
  vmPreference,
  activity,
  detail,
  momentum,
  notificationCount,
  inspectorOpen,
  onConfigureVm,
  onOpenSettings,
  onToggleInspector
}: {
  hostEnvironment: HostEnvironment | null;
  executor: ExecutorStatus | null;
  vmPreference: VmPreference;
  activity: EnvironmentActivity;
  detail: RunDetail | null;
  momentum: ResearchMomentum;
  notificationCount: number;
  inspectorOpen: boolean;
  onConfigureVm: () => void;
  onOpenSettings: () => void;
  onToggleInspector: () => void;
}): JSX.Element {
  useDevRenderProbe('footer.statusBar', () => ({
    host: hostEnvironment?.platform ?? 'unknown',
    vm: vmPreference.backendKind ?? 'none',
    momentum: momentum.state,
    notifications: notificationCount
  }));
  const osLabel = hostEnvironmentLabel(hostEnvironment);
  const vmTarget = vmTargetStatus(executor, vmPreference);
  const InspectorToggleIcon = inspectorOpen ? PanelRightClose : PanelRightOpen;

  return (
    <footer className="status-bar">
      <div className="environment-switcher" aria-label="Environment target">
        <div className={`environment-pill ${activity.host ? 'is-active' : ''}`} title={`Host operating system: ${osLabel}`}>
          <Monitor size={14} />
          <span>{osLabel}</span>
        </div>
        <div className={`environment-pill environment-vm-pill ${vmTarget.configured ? 'is-configured' : 'is-unconfigured'}`} title={vmTarget.title}>
          <Server size={14} />
          <span>{vmTarget.label}</span>
          {vmTarget.showConfigure ? (
            <button type="button" className="environment-configure" onClick={onConfigureVm}>
              Configure
            </button>
          ) : null}
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
        <button
          type="button"
          className="status-icon-button"
          title={inspectorOpen ? 'Hide evidence pane' : 'Show evidence pane'}
          aria-label={inspectorOpen ? 'Hide evidence pane' : 'Show evidence pane'}
          aria-pressed={inspectorOpen}
          onClick={onToggleInspector}
        >
          <InspectorToggleIcon size={14} />
        </button>
      </div>
    </footer>
  );
});
