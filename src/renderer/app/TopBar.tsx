import { memo } from 'react';
import type { JSX } from 'react';
import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import type { HostEnvironment } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';

export const TopBar = memo(function TopBar({
  sidebarCollapsed,
  platform,
  profilingEnabled,
  onOpenProfiling,
  onToggleSidebar
}: {
  sidebarCollapsed: boolean;
  platform: HostEnvironment['platform'];
  profilingEnabled: boolean;
  onOpenProfiling: () => void;
  onToggleSidebar: () => void;
}): JSX.Element {
  useDevRenderProbe('topBar', () => ({ platform, sidebarCollapsed, profilingEnabled }));
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const isMac = platform === 'darwin';

  return (
    <header className={`top-bar ${isMac ? 'top-bar-darwin' : 'top-bar-custom-controls'} ${profilingEnabled ? 'profiling-enabled' : ''}`}>
      {isMac ? <div className="mac-window-control-spacer" aria-hidden="true" /> : null}
      <nav className="window-menu" aria-label="Application menu">
        <button
          type="button"
          className="sidebar-toggle-button"
          title={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          aria-pressed={!sidebarCollapsed}
          onClick={onToggleSidebar}
        >
          <SidebarToggleIcon size={14} />
        </button>
        <button type="button">File</button>
        <button type="button">Edit</button>
        <button type="button">View</button>
        <button type="button">Window</button>
      </nav>
      {profilingEnabled || !isMac ? (
        <div className="window-controls" aria-label="Window controls">
          {profilingEnabled ? (
            <button type="button" className="window-debug-button" title="Open profiling overview" onClick={onOpenProfiling}>
              Debug
            </button>
          ) : null}
          {!isMac ? (
            <>
              <button type="button" className="window-control-button" title="Minimize" aria-label="Minimize" onClick={() => void window.beale.minimizeWindow()}>
                <Minus size={15} />
              </button>
              <button
                type="button"
                className="window-control-button"
                title="Maximize"
                aria-label="Maximize"
                onClick={() => void window.beale.toggleMaximizeWindow()}
              >
                <Square size={13} />
              </button>
              <button type="button" className="window-control-button window-control-close" title="Close" aria-label="Close" onClick={() => void window.beale.closeWindow()}>
                <X size={15} />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </header>
  );
});
