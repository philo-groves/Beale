import { useCallback, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

export const DEFAULT_SIDEBAR_WIDTH = 292;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 420;

const RESIZING_BODY_CLASS = 'is-resizing-sidebar';

export function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
}

export function useResizableSidebar(): {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  beginSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const toggleSidebar = useCallback(() => setSidebarCollapsed((current) => !current), []);

  const beginSidebarResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = sidebarWidth;
      const target = event.currentTarget;
      target.setPointerCapture(pointerId);
      document.body.classList.add(RESIZING_BODY_CLASS);

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        setSidebarWidth(clampSidebarWidth(startWidth + moveEvent.clientX - startX));
      };
      const handlePointerUp = (): void => {
        document.body.classList.remove(RESIZING_BODY_CLASS);
        if (target.hasPointerCapture(pointerId)) {
          target.releasePointerCapture(pointerId);
        }
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
        window.removeEventListener('pointercancel', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
      window.addEventListener('pointercancel', handlePointerUp);
    },
    [sidebarWidth]
  );

  return {
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebar,
    beginSidebarResize
  };
}
