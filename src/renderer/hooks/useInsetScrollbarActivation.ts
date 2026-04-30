import { useEffect } from 'react';

export const INSET_SCROLLBAR_ACTIVE_MS = 900;

export const INSET_SCROLLBAR_SELECTOR = [
  '.sidebar',
  '.inspector-sidebar',
  '.main-trace-list',
  '.main-hypothesis-list',
  '.main-finding-list',
  '.modal-body',
  '.session-history-list',
  '.trace-inspector-payload pre',
  '.center-column',
  '.tracker-panel',
  '.timeline',
  '.notification-detail pre'
].join(', ');

export function useInsetScrollbarActivation(activeMs = INSET_SCROLLBAR_ACTIVE_MS): void {
  useEffect(() => {
    const timers = new Map<Element, number>();

    const handleScroll = (event: Event): void => {
      if (!(event.target instanceof Element) || !event.target.matches(INSET_SCROLLBAR_SELECTOR)) {
        return;
      }

      const target = event.target;
      target.classList.add('scrollbar-active');
      const existingTimer = timers.get(target);
      if (existingTimer !== undefined) {
        window.clearTimeout(existingTimer);
      }
      timers.set(
        target,
        window.setTimeout(() => {
          target.classList.remove('scrollbar-active');
          timers.delete(target);
        }, activeMs)
      );
    };

    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, [activeMs]);
}
