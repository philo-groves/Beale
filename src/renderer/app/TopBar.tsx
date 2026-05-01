import { memo, useCallback, useEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { Minus, PanelLeftClose, PanelLeftOpen, Square, X } from 'lucide-react';
import type { HostEnvironment } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { copySelectedTextToClipboard, dispatchPasteSteeringText, editMenuShortcut, readClipboardText } from './menuActions';

type OpenMenu = 'edit' | null;

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
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const copyShortcut = editMenuShortcut(platform, 'C');
  const pasteShortcut = editMenuShortcut(platform, 'V');

  useEffect(() => {
    if (!openMenu) return undefined;

    const closeFromPointer = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
    };
    const closeFromEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null);
    };

    document.addEventListener('pointerdown', closeFromPointer);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromPointer);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [openMenu]);

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
        <button type="button">File</button>
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
