import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { JSX, ReactNode } from 'react';

export function MainSideScrollRegion({
  children,
  className,
  listClassName,
  stickToEnd = false,
  updateKey
}: {
  children: ReactNode;
  className?: string;
  listClassName: string;
  stickToEnd?: boolean;
  updateKey: string;
}): JSX.Element {
  const regionRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const followEndRef = useRef(true);

  const updateScrollEdges = useCallback(() => {
    const region = regionRef.current;
    const list = listRef.current;
    if (!region || !list) return;

    const scrollableDistance = list.scrollHeight - list.clientHeight;
    const canScroll = scrollableDistance > 8;
    const showTopFade = canScroll && list.scrollTop > 8;
    const showBottomFade = canScroll && list.scrollTop < scrollableDistance - 8;

    region.classList.toggle('has-top-fade', showTopFade);
    region.classList.toggle('has-bottom-fade', showBottomFade);
  }, []);

  const scrollToEnd = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = Math.max(0, list.scrollHeight - list.clientHeight);
    updateScrollEdges();
  }, [updateScrollEdges]);

  const syncScrollState = useCallback(() => {
    if (stickToEnd && followEndRef.current) {
      scrollToEnd();
      return;
    }
    updateScrollEdges();
  }, [scrollToEnd, stickToEnd, updateScrollEdges]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(syncScrollState);
    return () => window.cancelAnimationFrame(frame);
  }, [syncScrollState, updateKey]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;

    const observer = new ResizeObserver(syncScrollState);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [syncScrollState, updateKey]);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (stickToEnd && list) {
      const distanceFromBottom = list.scrollHeight - list.clientHeight - list.scrollTop;
      followEndRef.current = distanceFromBottom <= 12;
    }
    updateScrollEdges();
  }, [stickToEnd, updateScrollEdges]);

  return (
    <div className={`main-side-scroll ${className ?? ''}`.trim()} ref={regionRef}>
      <div className={listClassName} ref={listRef} onScroll={handleScroll}>
        {children}
      </div>
    </div>
  );
}
