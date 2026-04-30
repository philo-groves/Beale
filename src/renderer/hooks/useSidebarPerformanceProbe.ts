import { useEffect, type RefObject } from 'react';
import { devInstrumentation, recordNextFrameTiming } from '../devInstrumentation';
import { sidebarToggleDetail, type SidebarToggleProfile } from './useResizableSidebar';

const SIDEBAR_TRANSITION_WINDOW_MS = 260;

export function useSidebarPerformanceProbe({
  appShellRef,
  profile
}: {
  appShellRef: RefObject<HTMLDivElement | null>;
  profile: SidebarToggleProfile | null;
}): void {
  useEffect(() => {
    if (!profile || !devInstrumentation.isEnabled()) return undefined;
    const shell = appShellRef.current;
    const detail = sidebarToggleDetail(profile);
    const commitElapsedMs = performance.now() - profile.startedAt;
    let transitionEndCount = 0;
    let transitionWindow: number | null = null;

    devInstrumentation.recordTiming('sidebar.toggle.stateCommit', commitElapsedMs, detail);
    recordNextFrameTiming('sidebar.toggle.commit.nextFrameLatency', profile.startedAt, detail);

    if (!shell) {
      devInstrumentation.recordEvent('sidebar.toggle.transitionUnavailable', detail);
      return undefined;
    }

    const stopTransitionProbe = (): void => {
      shell.removeEventListener('transitionend', handleTransitionEnd, true);
      if (transitionWindow !== null) {
        window.clearTimeout(transitionWindow);
        transitionWindow = null;
      }
    };

    const handleTransitionEnd = (event: TransitionEvent): void => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const targetName = sidebarTransitionTargetName(target);
      if (!targetName) return;
      const elapsedSinceToggleMs = performance.now() - profile.startedAt;
      if (elapsedSinceToggleMs > SIDEBAR_TRANSITION_WINDOW_MS) return;
      transitionEndCount += 1;
      devInstrumentation.recordTiming('sidebar.toggle.transitionEnd', elapsedSinceToggleMs, {
        ...detail,
        target: targetName,
        property: event.propertyName,
        elapsedMs: Math.round(event.elapsedTime * 1000)
      });
    };

    transitionWindow = window.setTimeout(() => {
      devInstrumentation.recordTiming('sidebar.toggle.transitionWindow', performance.now() - profile.startedAt, {
        ...detail,
        transitionEnds: transitionEndCount
      });
      stopTransitionProbe();
    }, SIDEBAR_TRANSITION_WINDOW_MS);

    shell.addEventListener('transitionend', handleTransitionEnd, true);
    return stopTransitionProbe;
  }, [appShellRef, profile]);
}

function sidebarTransitionTargetName(target: HTMLElement | null): string | null {
  if (!target) return null;
  if (target.classList.contains('app-shell')) return 'app-shell';
  if (target.classList.contains('sidebar')) return 'sidebar';
  if (target.classList.contains('workbench')) return 'workbench';
  if (target.classList.contains('status-bar')) return 'status-bar';
  if (target.classList.contains('sidebar-toggle-button')) return 'toggle-button';
  return null;
}
