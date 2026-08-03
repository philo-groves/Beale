import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import { XCircle } from 'lucide-react';
import { useDevRenderProbe } from '../devInstrumentation';

const BOTTOM_SHEET_ANIMATION_MS = 180;

export interface DialogSurfaceProps {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  wide?: boolean;
  className?: string;
}

export function Modal(props: DialogSurfaceProps): JSX.Element {
  return <DialogSurface {...props} presentation="modal" />;
}

export function BottomSheet({ onClose, ...props }: DialogSurfaceProps): JSX.Element {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (closeTimeoutRef.current !== null) window.clearTimeout(closeTimeoutRef.current);
  }, []);

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose();
      return;
    }
    closingRef.current = true;
    setClosing(true);
    closeTimeoutRef.current = window.setTimeout(onClose, BOTTOM_SHEET_ANIMATION_MS);
  }, [onClose]);

  return (
    <DialogSurface
      {...props}
      presentation="bottom-sheet"
      closing={closing}
      dismissOnBackdrop
      onClose={requestClose}
    />
  );
}

function DialogSurface({
  title,
  children,
  footer,
  onClose,
  closeDisabled = false,
  wide = false,
  className = '',
  presentation,
  closing = false,
  dismissOnBackdrop = false
}: DialogSurfaceProps & {
  presentation: 'modal' | 'bottom-sheet';
  closing?: boolean;
  dismissOnBackdrop?: boolean;
}): JSX.Element {
  const titleId = useId();
  const isBottomSheet = presentation === 'bottom-sheet';
  useDevRenderProbe('modal', () => ({ title, wide: Boolean(wide), presentation }));
  const backdropClassName = ['modal-backdrop', isBottomSheet ? 'bottom-sheet-backdrop' : ''].filter(Boolean).join(' ');
  const panelClassName = [
    'modal-panel',
    isBottomSheet ? 'bottom-sheet-panel' : '',
    closing ? 'bottom-sheet-closing' : '',
    wide ? 'wide-modal' : '',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={backdropClassName}
      role="presentation"
      onClick={dismissOnBackdrop ? (event) => {
        if (event.target === event.currentTarget) onClose();
      } : undefined}
    >
      <section className={panelClassName} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" title="Close" aria-label={`Close ${title}`} disabled={closeDisabled} onClick={onClose}>
            <XCircle size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>
  );
}
