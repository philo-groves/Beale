import { Fragment, useEffect, useRef, useState } from 'react';
import type { CSSProperties, JSX } from 'react';
import { ChevronDown } from 'lucide-react';

export interface FloatingTextPickerOption {
  value: string;
  label: string;
  className?: string;
  group?: string;
  style?: CSSProperties;
}

export function FloatingTextPicker({
  className = '',
  value,
  options,
  disabled = false,
  title,
  ariaLabel,
  onChange
}: {
  className?: string;
  value: string;
  options: FloatingTextPickerOption[];
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  onChange: (value: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0] ?? null;

  useEffect(() => {
    if (!open) return undefined;

    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div
      className={`${className} floating-text-picker ${open ? 'is-open' : ''}`.trim()}
      ref={pickerRef}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        className={`floating-text-picker-trigger ${selectedOption?.className ?? ''}`.trim()}
        style={selectedOption?.style}
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(true);
        }}
      >
        <span className="floating-text-picker-label">{selectedOption?.label ?? ''}</span>
        <ChevronDown className="floating-text-picker-chevron" size={13} aria-hidden="true" />
      </button>
      {open ? (
        <div className="floating-text-picker-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <Fragment key={option.value}>
              {option.group && option.group !== options[index - 1]?.group ? (
                <span className="floating-text-picker-group" aria-hidden="true">{option.group}</span>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={option.value === selectedOption?.value}
                className={[option.className, option.value === selectedOption?.value ? 'is-selected' : ''].filter(Boolean).join(' ') || undefined}
                style={option.style}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}
