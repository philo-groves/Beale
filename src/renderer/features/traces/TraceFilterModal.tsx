import type { JSX } from 'react';
import { Modal } from '../../app/Modal';
import type { TraceCategoryId } from '../../traceClassification';
import { ALL_TRACE_CATEGORY_IDS, TRACE_CATEGORY_OPTIONS, traceCategoryIcon } from './traceVisuals';

export function TraceFilterModal({
  visibleCategories,
  onChange,
  onClose
}: {
  visibleCategories: TraceCategoryId[];
  onChange: (categories: TraceCategoryId[]) => void;
  onClose: () => void;
}): JSX.Element {
  const visibleSet = new Set(visibleCategories);
  const updateCategory = (category: TraceCategoryId, visible: boolean): void => {
    if (visible) {
      onChange(ALL_TRACE_CATEGORY_IDS.filter((candidate) => candidate === category || visibleSet.has(candidate)));
      return;
    }
    onChange(visibleCategories.filter((candidate) => candidate !== category));
  };

  return (
    <Modal
      title="Trace Filters"
      wide
      onClose={onClose}
      footer={
        <>
          <button type="button" className="modal-footer-leading" onClick={() => onChange(ALL_TRACE_CATEGORY_IDS)}>
            Select All
          </button>
          <button type="button" onClick={() => onChange([])}>
            Clear
          </button>
          <button type="button" onClick={onClose}>
            Done
          </button>
        </>
      }
    >
      <div className="trace-filter-grid">
        {TRACE_CATEGORY_OPTIONS.map((option) => {
          const active = visibleSet.has(option.id);
          return (
            <button type="button" className={`trace-filter-option ${active ? 'active' : ''}`} key={option.id} aria-pressed={active} onClick={() => updateCategory(option.id, !active)}>
              <span className={`trace-filter-icon category-${option.id}`}>{traceCategoryIcon(option.id)}</span>
              <span>
                <strong>{option.label}</strong>
                <small>{option.description}</small>
              </span>
              <span className="trace-filter-state">{active ? 'Shown' : 'Hidden'}</span>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
