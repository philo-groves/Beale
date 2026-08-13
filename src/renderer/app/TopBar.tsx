import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { Minus, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react';
import type { HostEnvironment, WorkspaceRegistryEntry, RunDetail, ZoomState } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { AppHeaderTitle, StaticAppHeaderTitle } from './AppHeaderTitle';
import { viewMenuShortcut, zoomPercentLabel } from './menuActions';

type OpenMenu = 'file' | 'view' | 'window' | null;

export const TopBar = memo(function TopBar({
  sidebarCollapsed,
  rightSidenavAvailable,
  rightSidenavExpanded,
  contextualTitleVisible,
  staticContextTitle,
  platform,
  workspaceName,
  activeWorkspace,
  activeRunDetail,
  profilingEnabled,
  onOpenSessionSummary,
  onOpenWorkspaceInfo,
  onOpenProfiling,
  onAddWorkspace,
  onToggleRightSidenav,
  onToggleSidebar
}: {
  sidebarCollapsed: boolean;
  rightSidenavAvailable: boolean;
  rightSidenavExpanded: boolean;
  contextualTitleVisible: boolean;
  staticContextTitle: { primary: string; secondary: string } | null;
  platform: HostEnvironment['platform'];
  workspaceName: string;
  activeWorkspace: WorkspaceRegistryEntry | null;
  activeRunDetail: RunDetail | null;
  profilingEnabled: boolean;
  onOpenSessionSummary: (detail: RunDetail) => void;
  onOpenWorkspaceInfo: (workspace: WorkspaceRegistryEntry) => void;
  onOpenProfiling: () => void;
  onAddWorkspace: () => void;
  onToggleRightSidenav: () => void;
  onToggleSidebar: () => void;
}): JSX.Element {
  useDevRenderProbe('topBar', () => ({ platform, sidebarCollapsed, profilingEnabled, workspaceName, run: activeRunDetail?.run.id ?? 'none' }));
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const RightSidenavToggleIcon = rightSidenavExpanded ? PanelRightClose : PanelRightOpen;
  const isMac = platform === 'darwin';
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [zoomState, setZoomState] = useState<ZoomState>(() => ({ level: 0, percent: 100 }));
  const menuRef = useRef<HTMLElement | null>(null);
  const zoomOutShortcut = viewMenuShortcut(platform, 'zoom_out');
  const zoomInShortcut = viewMenuShortcut(platform, 'zoom_in');

  useEffect(() => {
    const closeFromPointer = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const closeFromEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    const handleZoomShortcut = (event: KeyboardEvent): void => {
      if (!(platform === 'darwin' ? event.metaKey : event.ctrlKey) || event.altKey) return;
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        setZoomState(window.beale.zoomOut());
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        setZoomState(window.beale.zoomIn());
      }
    };

    document.addEventListener('pointerdown', closeFromPointer);
    document.addEventListener('keydown', closeFromEscape);
    if (platform !== 'darwin') window.addEventListener('keydown', handleZoomShortcut);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer);
      document.removeEventListener('keydown', closeFromEscape);
      if (platform !== 'darwin') window.removeEventListener('keydown', handleZoomShortcut);
    };
  }, [platform]);

  const preserveSelection = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const zoomOut = useCallback(() => {
    setOpenMenu(null);
    setZoomState(window.beale.zoomOut());
  }, []);

  const zoomIn = useCallback(() => {
    setOpenMenu(null);
    setZoomState(window.beale.zoomIn());
  }, []);

  const toggleViewMenu = useCallback(() => {
    setZoomState(window.beale.getZoomState());
    setOpenMenu((current) => (current === 'view' ? null : 'view'));
  }, []);

  const minimizeWindow = useCallback(() => {
    setOpenMenu(null);
    void window.beale.minimizeWindow();
  }, []);

  const maximizeWindow = useCallback(() => {
    setOpenMenu(null);
    void window.beale.toggleMaximizeWindow();
  }, []);

  const closeWindow = useCallback(() => {
    setOpenMenu(null);
    void window.beale.closeWindow();
  }, []);

  const addWorkspace = useCallback(() => {
    setOpenMenu(null);
    onAddWorkspace();
  }, [onAddWorkspace]);

  return (
    <header className={`top-bar ${isMac ? 'top-bar-darwin' : 'top-bar-custom-controls'} ${profilingEnabled ? 'profiling-enabled' : ''} ${rightSidenavAvailable ? 'right-sidenav-available' : ''} ${openMenu ? 'menu-open' : ''}`}>
      {isMac ? <div className="mac-window-control-spacer" aria-hidden="true" /> : null}
      <nav className="window-menu" aria-label={isMac ? 'Sidebar controls' : 'Application menu'} ref={menuRef}>
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
        {!isMac ? <>
        <div className="window-menu-item">
          <button
            type="button"
            className={openMenu === 'file' ? 'is-open' : undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'file'}
            onMouseDown={preserveSelection}
            onClick={() => setOpenMenu((current) => (current === 'file' ? null : 'file'))}
          >
            File
          </button>
          {openMenu === 'file' ? (
            <div className="window-menu-dropdown" role="menu" aria-label="File">
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={addWorkspace}>
                <span>New Research Workspace</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="window-menu-item">
          <button
            type="button"
            className={openMenu === 'view' ? 'is-open' : undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'view'}
            onMouseDown={preserveSelection}
            onClick={toggleViewMenu}
          >
            View
          </button>
          {openMenu === 'view' ? (
            <div className="window-menu-dropdown" role="menu" aria-label="View">
              <div className="window-menu-static-row" aria-hidden="true">
                <span>Zoom Level</span>
                <span>{zoomPercentLabel(zoomState.percent)}</span>
              </div>
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={zoomOut}>
                <span>Zoom Out</span>
                <kbd>{zoomOutShortcut}</kbd>
              </button>
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={zoomIn}>
                <span>Zoom In</span>
                <kbd>{zoomInShortcut}</kbd>
              </button>
            </div>
          ) : null}
        </div>
        <div className="window-menu-item">
          <button
            type="button"
            className={openMenu === 'window' ? 'is-open' : undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'window'}
            onMouseDown={preserveSelection}
            onClick={() => setOpenMenu((current) => (current === 'window' ? null : 'window'))}
          >
            Window
          </button>
          {openMenu === 'window' ? (
            <div className="window-menu-dropdown" role="menu" aria-label="Window">
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={minimizeWindow}>
                <span>Minimize</span>
              </button>
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={maximizeWindow}>
                <span>Maximize</span>
              </button>
              <button type="button" role="menuitem" className="danger" onMouseDown={preserveSelection} onClick={closeWindow}>
                <span>Close</span>
              </button>
            </div>
          ) : null}
        </div>
        </> : null}
      </nav>
      {contextualTitleVisible ? (
        <AppHeaderTitle
          workspaceName={workspaceName}
          activeWorkspace={activeWorkspace}
          detail={activeRunDetail}
          onOpenWorkspaceInfo={onOpenWorkspaceInfo}
          onOpenSessionSummary={onOpenSessionSummary}
        />
      ) : staticContextTitle ? (
        <StaticAppHeaderTitle primaryTitle={staticContextTitle.primary} secondaryTitle={staticContextTitle.secondary} />
      ) : null}
      {profilingEnabled || rightSidenavAvailable || !isMac ? (
        <div className="window-controls" aria-label="Header controls">
          {profilingEnabled ? (
            <button type="button" className="window-debug-button" title="Open profiling overview" onClick={onOpenProfiling}>
              Debug
            </button>
          ) : null}
          {rightSidenavAvailable ? (
            <button
              type="button"
              className="window-control-button right-sidenav-toggle-button"
              title={rightSidenavExpanded ? 'Show summary sidebar' : 'Show detailed sidebar'}
              aria-label={rightSidenavExpanded ? 'Show summary sidebar' : 'Show detailed sidebar'}
              aria-pressed={rightSidenavExpanded}
              onClick={onToggleRightSidenav}
            >
              <RightSidenavToggleIcon size={14} aria-hidden="true" />
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
