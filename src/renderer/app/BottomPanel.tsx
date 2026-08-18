import { memo, useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { SquareTerminal, X } from 'lucide-react';
import '@xterm/xterm/css/xterm.css';

export const DEFAULT_BOTTOM_PANEL_OPEN = false;

export const BottomPanel = memo(function BottomPanel({
  open,
  workspacePath,
  onClose
}: {
  open: boolean;
  workspacePath: string | null;
  onClose: () => void;
}): JSX.Element {
  const terminalElementRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const terminalElement = terminalElementRef.current;
    if (!open || !workspacePath || !terminalElement) return undefined;
    const sessionId = crypto.randomUUID();
    let disposed = false;
    let started = false;
    let bufferedOutput = '';
    let terminal: import('@xterm/xterm').Terminal | null = null;
    let inputDisposable: { dispose(): void } | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;

    const removeDataListener = window.beale.onWorkspaceTerminalData((event) => {
      if (event.sessionId !== sessionId || disposed) return;
      if (terminal) terminal.write(event.data);
      else bufferedOutput = `${bufferedOutput}${event.data}`.slice(-1_048_576);
    });
    const removeExitListener = window.beale.onWorkspaceTerminalExit((event) => {
      if (event.sessionId !== sessionId || disposed) return;
      inputDisposable?.dispose();
      inputDisposable = null;
      terminal?.write(`\r\n\x1b[90m[Process exited with code ${event.exitCode}]\x1b[0m\r\n`);
    });

    void (async () => {
      try {
        const [{ Terminal }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit')
        ]);
        if (disposed) return;
        terminal = new Terminal({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
          fontSize: 13,
          lineHeight: 1.2,
          scrollback: 5_000,
          theme: {
            background: '#0d0d0d',
            foreground: '#f2f2f2',
            cursor: '#f2f2f2',
            selectionBackground: 'rgba(255, 255, 255, 0.22)'
          }
        });
        const fitAddon = new FitAddon();
        terminal.loadAddon(fitAddon);
        terminal.open(terminalElement);
        fitAddon.fit();
        if (bufferedOutput) {
          terminal.write(bufferedOutput);
          bufferedOutput = '';
        }
        inputDisposable = terminal.onData((data) => {
          void window.beale.writeWorkspaceTerminal(sessionId, data).catch((caught: unknown) => {
            terminal?.write(`\r\n\x1b[31m${caught instanceof Error ? caught.message : String(caught)}\x1b[0m\r\n`);
          });
        });
        const result = await window.beale.startWorkspaceTerminal(sessionId, terminal.cols, terminal.rows);
        started = true;
        if (disposed) {
          void window.beale.closeWorkspaceTerminal(sessionId);
          return;
        }
        terminalElement.title = `${result.shell} — ${result.cwd}`;
        terminal.focus();
        resizeObserver = new ResizeObserver(() => {
          if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            if (!terminal || disposed) return;
            fitAddon.fit();
            if (started) void window.beale.resizeWorkspaceTerminal(sessionId, terminal.cols, terminal.rows).catch(() => undefined);
          });
        });
        resizeObserver.observe(terminalElement);
      } catch (caught) {
        if (!disposed) {
          const message = caught instanceof Error ? caught.message : String(caught);
          terminal?.write(`\r\n\x1b[31mUnable to start terminal: ${message}\x1b[0m\r\n`);
        }
      }
    })();

    return () => {
      disposed = true;
      removeDataListener();
      removeExitListener();
      inputDisposable?.dispose();
      resizeObserver?.disconnect();
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      terminal?.dispose();
      void window.beale.closeWorkspaceTerminal(sessionId);
    };
  }, [open, workspacePath]);

  return (
    <section className="bottom-panel" aria-label="Bottom panel" aria-hidden={!open} inert={!open}>
      <div className="bottom-panel-surface">
        <header className="research-side-view-header bottom-panel-header">
          <div className="research-side-view-tabs" role="tablist" aria-label="Bottom panel views">
            <div className="research-side-view-tab bottom-panel-tab active">
              <button
                type="button"
                className="research-side-view-tab-activate"
                role="tab"
                id="bottom-panel-terminal-tab"
                aria-selected="true"
                aria-controls="bottom-panel-terminal-view"
              >
                <SquareTerminal size={15} aria-hidden="true" />
                <span>Terminal</span>
              </button>
              <button
                type="button"
                className="research-side-view-tab-close"
                aria-label="Close Terminal"
                title="Close Terminal"
                onClick={onClose}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          </div>
        </header>
        <div
          ref={terminalElementRef}
          className="bottom-panel-terminal"
          id="bottom-panel-terminal-view"
          role="tabpanel"
          aria-labelledby="bottom-panel-terminal-tab"
        />
      </div>
    </section>
  );
});
