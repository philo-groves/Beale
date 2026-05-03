import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import type { HostEnvironment, RunDetail, ZoomState } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { AppHeaderTitle } from './AppHeaderTitle';
import { copySelectedTextToClipboard, dispatchPasteSteeringText, editMenuShortcut, readClipboardText, viewMenuShortcut, zoomPercentLabel } from './menuActions';

type OpenMenu = 'file' | 'edit' | 'view' | 'window' | null;

export const TopBar = memo(function TopBar({
  sidebarCollapsed,
  platform,
  programName,
  activeRunDetail,
  profilingEnabled,
  onOpenResearchPrompt,
  onOpenProfiling,
  onAddProgram,
  onToggleSidebar
}: {
  sidebarCollapsed: boolean;
  platform: HostEnvironment['platform'];
  programName: string;
  activeRunDetail: RunDetail | null;
  profilingEnabled: boolean;
  onOpenResearchPrompt: (detail: RunDetail) => void;
  onOpenProfiling: () => void;
  onAddProgram: () => void;
  onToggleSidebar: () => void;
}): JSX.Element {
  useDevRenderProbe('topBar', () => ({ platform, sidebarCollapsed, profilingEnabled, programName, run: activeRunDetail?.run.id ?? 'none' }));
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const isMac = platform === 'darwin';
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [zoomState, setZoomState] = useState<ZoomState>(() => ({ level: 0, percent: 100 }));
  const menuRef = useRef<HTMLElement | null>(null);
  const copyShortcut = editMenuShortcut(platform, 'C');
  const pasteShortcut = editMenuShortcut(platform, 'V');
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
    window.addEventListener('keydown', handleZoomShortcut);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer);
      document.removeEventListener('keydown', closeFromEscape);
      window.removeEventListener('keydown', handleZoomShortcut);
    };
  }, [platform]);

  const preserveSelection = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
  }, []);

  const copySelected = useCallback(() => {
    setOpenMenu(null);
    void copySelectedTextToClipboard();
  }, []);

  const pasteSteering = useCallback(() => {
    setOpenMenu(null);
    void readClipboardText().then(dispatchPasteSteeringText);
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

  const addProgram = useCallback(() => {
    setOpenMenu(null);
    onAddProgram();
  }, [onAddProgram]);

  return (
    <header className={`top-bar ${isMac ? 'top-bar-darwin' : 'top-bar-custom-controls'} ${profilingEnabled ? 'profiling-enabled' : ''} ${openMenu ? 'menu-open' : ''}`}>
      {isMac ? <div className="mac-window-control-spacer" aria-hidden="true" /> : null}
      <nav className="window-menu" aria-label="Application menu" ref={menuRef}>
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
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={addProgram}>
                <span>New Research Program</span>
              </button>
            </div>
          ) : null}
        </div>
        <div className="window-menu-item">
          <button
            type="button"
            className={openMenu === 'edit' ? 'is-open' : undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === 'edit'}
            onMouseDown={preserveSelection}
            onClick={() => setOpenMenu((current) => (current === 'edit' ? null : 'edit'))}
          >
            Edit
          </button>
          {openMenu === 'edit' ? (
            <div className="window-menu-dropdown" role="menu" aria-label="Edit">
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={copySelected}>
                <span>Copy</span>
                <kbd>{copyShortcut}</kbd>
              </button>
              <button type="button" role="menuitem" onMouseDown={preserveSelection} onClick={pasteSteering}>
                <span>Paste Steering</span>
                <kbd>{pasteShortcut}</kbd>
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
      </nav>
      <AppHeaderTitle programName={programName} detail={activeRunDetail} onOpenResearchPrompt={onOpenResearchPrompt} />
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
