import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { JSX, MouseEvent } from 'react';
import { ChevronDown, Code2, Minus, PanelBottomClose, PanelBottomOpen, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Square, X } from 'lucide-react';
import type { HostEnvironment, RunDetail, WorkspaceEditorCatalog, WorkspaceEditorId, WorkspaceEditorSummary, ZoomState } from '@shared/types';
import { useDevRenderProbe } from '../devInstrumentation';
import { AppHeaderTitle, StaticAppHeaderTitle } from './AppHeaderTitle';
import type { AppHeaderViewIcon } from './AppHeaderTitle';
import { viewMenuShortcut, zoomPercentLabel } from './menuActions';

type OpenMenu = 'file' | 'view' | 'window' | null;
const HEADER_MENU_GAP_PX = 8;

export function headerMenuInlineEnd(topBarLeft: number, menuRight: number): number {
  return Math.max(0, Math.ceil(menuRight - topBarLeft + HEADER_MENU_GAP_PX));
}

export function rightmostHeaderMenuControl(menuLeft: number, controlRights: readonly number[]): number {
  return Math.max(menuLeft, ...controlRights);
}

function WorkspaceEditorIcon({ editor, size = 16 }: { editor: WorkspaceEditorSummary; size?: number }): JSX.Element {
  return editor.iconDataUrl
    ? <img className="workspace-editor-icon" src={editor.iconDataUrl} alt="" width={size} height={size} aria-hidden="true" />
    : <Code2 size={size} aria-hidden="true" />;
}

export const TopBar = memo(function TopBar({
  sidebarCollapsed,
  rightSidenavAvailable,
  rightSidenavExpanded,
  contextualTitleVisible,
  staticContextTitle,
  platform,
  workspaceName,
  workspaceViewTitle,
  activeRunDetail,
  activeBreakoutRoomTitle,
  profilingEnabled,
  bottomPanelOpen,
  workspaceEditors,
  onOpenProfiling,
  onToggleBottomPanel,
  onOpenWorkspaceInEditor,
  onAddWorkspace,
  onToggleRightSidenav,
  onToggleSidebar
}: {
  sidebarCollapsed: boolean;
  rightSidenavAvailable: boolean;
  rightSidenavExpanded: boolean;
  contextualTitleVisible: boolean;
  staticContextTitle: { primary: string; secondary: string; icon: AppHeaderViewIcon } | null;
  platform: HostEnvironment['platform'];
  workspaceName: string;
  workspaceViewTitle?: string | null;
  activeRunDetail: RunDetail | null;
  activeBreakoutRoomTitle: string | null;
  profilingEnabled: boolean;
  bottomPanelOpen: boolean;
  workspaceEditors: WorkspaceEditorCatalog | null;
  onOpenProfiling: () => void;
  onToggleBottomPanel: () => void;
  onOpenWorkspaceInEditor: (editorId: WorkspaceEditorId) => void;
  onAddWorkspace: () => void;
  onToggleRightSidenav: () => void;
  onToggleSidebar: () => void;
}): JSX.Element {
  useDevRenderProbe('topBar', () => ({ platform, sidebarCollapsed, profilingEnabled, workspaceName, run: activeRunDetail?.run.id ?? 'none' }));
  const SidebarToggleIcon = sidebarCollapsed ? PanelLeftOpen : PanelLeftClose;
  const RightSidenavToggleIcon = rightSidenavExpanded ? PanelRightClose : PanelRightOpen;
  const BottomPanelToggleIcon = bottomPanelOpen ? PanelBottomClose : PanelBottomOpen;
  const isMac = platform === 'darwin';
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [zoomState, setZoomState] = useState<ZoomState>(() => ({ level: 0, percent: 100 }));
  const topBarRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLElement | null>(null);
  const editorMenuRef = useRef<HTMLDivElement | null>(null);
  const zoomOutShortcut = viewMenuShortcut(platform, 'zoom_out');
  const zoomInShortcut = viewMenuShortcut(platform, 'zoom_in');

  useLayoutEffect(() => {
    const topBar = topBarRef.current;
    const menu = menuRef.current;
    if (!topBar || !menu) return undefined;
    const menuControls = Array.from(menu.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
    const updateMenuEdge = (): void => {
      const menuRight = rightmostHeaderMenuControl(
        menu.getBoundingClientRect().left,
        menuControls.map((control) => control.getBoundingClientRect().right)
      );
      const menuEdge = headerMenuInlineEnd(topBar.getBoundingClientRect().left, menuRight);
      topBar.style.setProperty('--header-menu-inline-end', `${menuEdge}px`);
    };
    updateMenuEdge();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMenuEdge);
    observer?.observe(topBar);
    observer?.observe(menu);
    for (const control of menuControls) observer?.observe(control);
    window.addEventListener('resize', updateMenuEdge);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMenuEdge);
    };
  }, [platform]);

  useEffect(() => {
    const closeFromPointer = (event: PointerEvent): void => {
      if (menuRef.current?.contains(event.target as Node) || editorMenuRef.current?.contains(event.target as Node)) return;
      setOpenMenu(null);
      setEditorMenuOpen(false);
    };
    const closeFromEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenMenu(null);
        setEditorMenuOpen(false);
      }
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
    setEditorMenuOpen(false);
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

  const availableEditors = workspaceEditors?.editors ?? [];
  const defaultEditor = availableEditors.find((editor) => editor.id === workspaceEditors?.defaultEditorId) ?? availableEditors[0] ?? null;
  const openWorkspaceInEditor = useCallback((editorId: WorkspaceEditorId) => {
    setEditorMenuOpen(false);
    onOpenWorkspaceInEditor(editorId);
  }, [onOpenWorkspaceInEditor]);

  return (
    <header ref={topBarRef} className={`top-bar ${isMac ? 'top-bar-darwin' : 'top-bar-custom-controls'} ${profilingEnabled ? 'profiling-enabled' : ''} ${rightSidenavAvailable ? 'right-sidenav-available' : ''} ${defaultEditor ? 'editor-launch-available' : ''} ${openMenu || editorMenuOpen ? 'menu-open' : ''}`}>
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
            onClick={() => {
              setEditorMenuOpen(false);
              setOpenMenu((current) => (current === 'file' ? null : 'file'));
            }}
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
            onClick={() => {
              setEditorMenuOpen(false);
              setOpenMenu((current) => (current === 'window' ? null : 'window'));
            }}
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
          workspaceViewTitle={workspaceViewTitle}
          detail={activeRunDetail}
          breakoutRoomTitle={activeBreakoutRoomTitle}
        />
      ) : staticContextTitle ? (
        <StaticAppHeaderTitle primaryTitle={staticContextTitle.primary} secondaryTitle={staticContextTitle.secondary} icon={staticContextTitle.icon} />
      ) : null}
      {profilingEnabled || defaultEditor || rightSidenavAvailable || !isMac ? (
        <div className="window-controls" aria-label="Header controls">
          {profilingEnabled ? (
            <button type="button" className="window-debug-button" title="Open profiling overview" onClick={onOpenProfiling}>
              Debug
            </button>
          ) : null}
          {defaultEditor ? (
            <div className="workspace-editor-control" ref={editorMenuRef}>
              <button
                type="button"
                className="workspace-editor-open-button"
                title={`Open primary workspace directory in ${defaultEditor.name}`}
                aria-label={`Open primary workspace directory in ${defaultEditor.name}`}
                onClick={() => openWorkspaceInEditor(defaultEditor.id)}
              >
                <WorkspaceEditorIcon editor={defaultEditor} />
              </button>
              <button
                type="button"
                className="workspace-editor-menu-button"
                title="Choose editor"
                aria-label="Choose editor"
                aria-haspopup="menu"
                aria-expanded={editorMenuOpen}
                onClick={() => {
                  setOpenMenu(null);
                  setEditorMenuOpen((current) => !current);
                }}
              >
                <ChevronDown size={12} aria-hidden="true" />
              </button>
              {editorMenuOpen ? (
                <div className="workspace-editor-dropdown" role="menu" aria-label="Open workspace in editor">
                  {availableEditors.map((editor) => (
                    <button
                      type="button"
                      role="menuitem"
                      key={editor.id}
                      onMouseDown={preserveSelection}
                      onClick={() => openWorkspaceInEditor(editor.id)}
                    >
                      <WorkspaceEditorIcon editor={editor} />
                      <span>{editor.name}</span>
                      {editor.id === workspaceEditors?.defaultEditorId ? <span className="workspace-editor-default-label">Default</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {rightSidenavAvailable ? (
            <>
              <button
                type="button"
                className="window-control-button bottom-panel-toggle-button"
                title={bottomPanelOpen ? 'Hide bottom panel' : 'Show bottom panel'}
                aria-label={bottomPanelOpen ? 'Hide bottom panel' : 'Show bottom panel'}
                aria-pressed={bottomPanelOpen}
                onClick={onToggleBottomPanel}
              >
                <BottomPanelToggleIcon size={14} aria-hidden="true" />
              </button>
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
            </>
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
