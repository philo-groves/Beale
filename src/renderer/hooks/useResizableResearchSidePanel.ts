import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject
} from 'react';

export const DEFAULT_RESEARCH_SIDE_PANEL_WIDTH = 360;
export const MIN_RESEARCH_SIDE_PANEL_WIDTH = 280;
export const MAX_RESEARCH_SIDE_PANEL_WIDTH = 620;
export const MIN_TRACE_PANEL_WIDTH = 360;
export const RESEARCH_SIDE_RESIZE_HANDLE_WIDTH = 6;

const RESIZING_BODY_CLASS = 'is-resizing-research-side';
const STORAGE_KEY = 'beale.researchSidePanelWidth';
const KEYBOARD_RESIZE_STEP = 16;

export function maxResearchSidePanelWidth(containerWidth: number): number {
  const availableWidth = containerWidth - MIN_TRACE_PANEL_WIDTH - RESEARCH_SIDE_RESIZE_HANDLE_WIDTH;
  return Math.max(
    MIN_RESEARCH_SIDE_PANEL_WIDTH,
    Math.min(MAX_RESEARCH_SIDE_PANEL_WIDTH, availableWidth)
  );
}

export function clampResearchSidePanelWidth(
  width: number,
  maximum = MAX_RESEARCH_SIDE_PANEL_WIDTH
): number {
  return Math.max(MIN_RESEARCH_SIDE_PANEL_WIDTH, Math.min(maximum, width));
}

export function researchSidePanelWidthAfterPointerMove(
  startWidth: number,
  startX: number,
  currentX: number,
  maximum = MAX_RESEARCH_SIDE_PANEL_WIDTH
): number {
  return clampResearchSidePanelWidth(startWidth + startX - currentX, maximum);
}

function storedResearchSidePanelWidth(): number {
  try {
    const storedWidth = Number.parseFloat(window.localStorage.getItem(STORAGE_KEY) ?? '');
    return Number.isFinite(storedWidth)
      ? clampResearchSidePanelWidth(storedWidth)
      : DEFAULT_RESEARCH_SIDE_PANEL_WIDTH;
  } catch {
    return DEFAULT_RESEARCH_SIDE_PANEL_WIDTH;
  }
}

export function useResizableResearchSidePanel(active: boolean): {
  containerRef: RefObject<HTMLDivElement | null>;
  panelWidth: number;
  maximumPanelWidth: number;
  beginResize: (event: ReactPointerEvent<HTMLDivElement>) => void;
  handleResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
} {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [panelWidth, setPanelWidth] = useState(storedResearchSidePanelWidth);
  const [maximumPanelWidth, setMaximumPanelWidth] = useState(MAX_RESEARCH_SIDE_PANEL_WIDTH);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);

  const maximumForContainer = useCallback((): number => {
    const containerWidth = containerRef.current?.getBoundingClientRect().width;
    return containerWidth && containerWidth > 0
      ? maxResearchSidePanelWidth(containerWidth)
      : MAX_RESEARCH_SIDE_PANEL_WIDTH;
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(panelWidth));
    } catch {
      // A renderer with unavailable storage can still resize for its current lifetime.
    }
  }, [panelWidth]);

  useEffect(() => {
    if (!active) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;

    const updateBounds = (): void => {
      const maximum = maxResearchSidePanelWidth(container.getBoundingClientRect().width);
      setMaximumPanelWidth(maximum);
      setPanelWidth((currentWidth) => clampResearchSidePanelWidth(currentWidth, maximum));
    };
    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(container);
    return () => observer.disconnect();
  }, [active]);

  useEffect(
    () => () => {
      activeResizeCleanupRef.current?.();
      document.body.classList.remove(RESIZING_BODY_CLASS);
    },
    []
  );

  const beginResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      event.preventDefault();
      activeResizeCleanupRef.current?.();

      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startWidth = panelWidth;
      const target = event.currentTarget;
      target.setPointerCapture(pointerId);
      document.body.classList.add(RESIZING_BODY_CLASS);

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const maximum = maximumForContainer();
        setMaximumPanelWidth(maximum);
        setPanelWidth(researchSidePanelWidthAfterPointerMove(startWidth, startX, moveEvent.clientX, maximum));
      };
      const cleanup = (): void => {
        document.body.classList.remove(RESIZING_BODY_CLASS);
        if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', cleanup);
        window.removeEventListener('pointercancel', cleanup);
        activeResizeCleanupRef.current = null;
      };

      activeResizeCleanupRef.current = cleanup;
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', cleanup);
      window.addEventListener('pointercancel', cleanup);
    },
    [maximumForContainer, panelWidth]
  );

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      const maximum = maximumForContainer();
      let nextWidth: number | null = null;
      if (event.key === 'ArrowLeft') nextWidth = panelWidth + KEYBOARD_RESIZE_STEP;
      if (event.key === 'ArrowRight') nextWidth = panelWidth - KEYBOARD_RESIZE_STEP;
      if (event.key === 'Home') nextWidth = MIN_RESEARCH_SIDE_PANEL_WIDTH;
      if (event.key === 'End') nextWidth = maximum;
      if (nextWidth === null) return;

      event.preventDefault();
      setMaximumPanelWidth(maximum);
      setPanelWidth(clampResearchSidePanelWidth(nextWidth, maximum));
    },
    [maximumForContainer, panelWidth]
  );

  return {
    containerRef,
    panelWidth,
    maximumPanelWidth,
    beginResize,
    handleResizeKeyDown
  };
}
