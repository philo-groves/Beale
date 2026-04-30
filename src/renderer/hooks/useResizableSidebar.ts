import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { devInstrumentation, recordNextFrameTiming } from '../devInstrumentation';

export const DEFAULT_SIDEBAR_WIDTH = 292;
export const MIN_SIDEBAR_WIDTH = 240;
export const MAX_SIDEBAR_WIDTH = 420;

const RESIZING_BODY_CLASS = 'is-resizing-sidebar';

export interface SidebarToggleProfile {
  sequence: number;
  startedAt: number;
  from: 'collapsed' | 'expanded';
  to: 'collapsed' | 'expanded';
  width: number;
}

export function clampSidebarWidth(width: number): number {
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, width));
}

export function useResizableSidebar(): {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarToggleProfile: SidebarToggleProfile | null;
  toggleSidebar: () => void;
  beginSidebarResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
} {
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarToggleProfile, setSidebarToggleProfile] = useState<SidebarToggleProfile | null>(null);
  const sidebarCollapsedRef = useRef(sidebarCollapsed);
  const toggleSequenceRef = useRef(0);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    const current = sidebarCollapsedRef.current;
    const next = !current;
    const profile: SidebarToggleProfile = {
      sequence: toggleSequenceRef.current + 1,
      startedAt: performance.now(),
      from: current ? 'collapsed' : 'expanded',
      to: next ? 'collapsed' : 'expanded',
      width: sidebarWidth
    };
    toggleSequenceRef.current = profile.sequence;
    sidebarCollapsedRef.current = next;
    setSidebarCollapsed(next);
    setSidebarToggleProfile(profile);
    devInstrumentation.recordEvent('sidebar.toggle.request', sidebarToggleDetail(profile));
    recordNextFrameTiming('sidebar.toggle.request.nextFrameLatency', profile.startedAt, sidebarToggleDetail(profile));
  }, [sidebarWidth]);

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
    sidebarToggleProfile,
    toggleSidebar,
    beginSidebarResize
  };
}

export function sidebarToggleDetail(profile: SidebarToggleProfile): Record<string, string | number> {
  return {
    sequence: profile.sequence,
    from: profile.from,
    to: profile.to,
    width: profile.width
  };
}
