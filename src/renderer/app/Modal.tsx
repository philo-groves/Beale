import type { JSX, ReactNode } from 'react';
import { XCircle } from 'lucide-react';
import { useDevRenderProbe } from '../devInstrumentation';

export function Modal({
  title,
  children,
  footer,
  onClose,
  wide = false,
  className = ''
}: {
  title: string;
  children: ReactNode;
  footer: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
}): JSX.Element {
  useDevRenderProbe('modal', () => ({ title, wide: Boolean(wide) }));
  const panelClassName = ['modal-panel', wide ? 'wide-modal' : '', className].filter(Boolean).join(' ');
  return (
    <div className="modal-backdrop" role="presentation">
      <section className={panelClassName} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" title="Close" onClick={onClose}>
            <XCircle size={16} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        <footer className="modal-footer">{footer}</footer>
      </section>
    </div>
  );
}
