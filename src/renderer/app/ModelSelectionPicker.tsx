import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ProviderIcon } from './ProviderIcon';

export interface ModelSelectionPickerOption {
  value: string;
  label: string;
  disabled?: boolean;
}

type ModelSelectionSection = 'provider' | 'model' | 'effort';

interface ModelSelectionSectionDefinition {
  id: ModelSelectionSection;
  label: string;
  value: string;
  options: ModelSelectionPickerOption[];
  onSelect: (value: string) => void;
}

interface PickerPosition {
  left: number;
  bottom: number;
}

const MENU_WIDTH = 232;
const SUBMENU_WIDTH = 220;
const MENU_GAP = 6;
const VIEWPORT_INSET = 8;

export function ModelSelectionPicker({
  className = '',
  providerValue,
  modelValue,
  effortValue,
  providerOptions,
  modelOptions,
  effortOptions,
  disabled = false,
  title,
  ariaLabel,
  onSelectProvider,
  onSelectModel,
  onSelectEffort
}: {
  className?: string;
  providerValue: string;
  modelValue: string;
  effortValue: string;
  providerOptions: ModelSelectionPickerOption[];
  modelOptions: ModelSelectionPickerOption[];
  effortOptions: ModelSelectionPickerOption[];
  disabled?: boolean;
  title: string;
  ariaLabel: string;
  onSelectProvider: (value: string) => void;
  onSelectModel: (value: string) => void;
  onSelectEffort: (value: string) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<ModelSelectionSection | null>(null);
  const [menuPosition, setMenuPosition] = useState<PickerPosition | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const submenuRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Record<ModelSelectionSection, HTMLButtonElement | null>>({
    provider: null,
    model: null,
    effort: null
  });
  const sections: ModelSelectionSectionDefinition[] = [
    {
      id: 'provider',
      label: 'Provider',
      value: providerValue,
      options: providerOptions,
      onSelect: onSelectProvider
    },
    {
      id: 'model',
      label: 'Model',
      value: modelValue,
      options: modelOptions,
      onSelect: onSelectModel
    },
    {
      id: 'effort',
      label: 'Effort',
      value: effortValue,
      options: effortOptions,
      onSelect: onSelectEffort
    }
  ];
  const activeDefinition = sections.find((section) => section.id === activeSection) ?? null;
  const modelLabel = selectedLabel(modelOptions, modelValue);
  const effortLabel = selectedLabel(effortOptions, effortValue);

  const positionMenu = (): void => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const triggerBounds = trigger.getBoundingClientRect();
    const combinedWidth = MENU_WIDTH + MENU_GAP + SUBMENU_WIDTH;
    const maximumLeft = Math.max(VIEWPORT_INSET, window.innerWidth - combinedWidth - VIEWPORT_INSET);
    setMenuPosition({
      left: Math.min(Math.max(VIEWPORT_INSET, triggerBounds.right - MENU_WIDTH), maximumLeft),
      bottom: Math.max(VIEWPORT_INSET, window.innerHeight - triggerBounds.top + MENU_GAP)
    });
  };

  const closePicker = (returnFocus = false): void => {
    setOpen(false);
    setActiveSection(null);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const focusRow = (section: ModelSelectionSection): void => {
    window.requestAnimationFrame(() => rowRefs.current[section]?.focus());
  };

  const focusActiveOption = (): void => {
    window.requestAnimationFrame(() => {
      const options = Array.from(submenuRef.current?.querySelectorAll<HTMLButtonElement>('.model-selection-picker-option:not(:disabled)') ?? []);
      const selected = options.find((option) => option.getAttribute('aria-checked') === 'true');
      (selected ?? options[0])?.focus();
    });
  };

  const openPicker = (section: ModelSelectionSection | null = null, focusMenu = false): void => {
    positionMenu();
    setActiveSection(section);
    setOpen(true);
    if (focusMenu && section) focusRow(section);
  };

  useEffect(() => {
    if (!open) return undefined;

    const dismissOnOutsidePointer = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closePicker();
    };
    const dismissOnFocusChange = (event: FocusEvent): void => {
      const target = event.target as Node;
      if (pickerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closePicker();
    };
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closePicker(true);
    };

    document.addEventListener('pointerdown', dismissOnOutsidePointer);
    document.addEventListener('focusin', dismissOnFocusChange);
    document.addEventListener('keydown', dismissOnEscape);
    window.addEventListener('resize', positionMenu);
    return () => {
      document.removeEventListener('pointerdown', dismissOnOutsidePointer);
      document.removeEventListener('focusin', dismissOnFocusChange);
      document.removeEventListener('keydown', dismissOnEscape);
      window.removeEventListener('resize', positionMenu);
    };
  }, [open]);

  useEffect(() => {
    if (!disabled) return;
    setOpen(false);
    setActiveSection(null);
  }, [disabled]);

  const menu = open && menuPosition && typeof document !== 'undefined'
    ? createPortal(
        <div
          className="model-selection-picker-menu"
          ref={menuRef}
          role="menu"
          aria-label={ariaLabel}
          style={{ left: menuPosition.left, bottom: menuPosition.bottom }}
        >
          {sections.map((section, sectionIndex) => {
            const active = section.id === activeSection;
            return (
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={active}
                className={`model-selection-picker-row ${active ? 'is-active' : ''}`.trim()}
                tabIndex={active ? 0 : -1}
                ref={(node) => {
                  rowRefs.current[section.id] = node;
                }}
                key={section.id}
                onMouseEnter={() => setActiveSection(section.id)}
                onFocus={() => setActiveSection(section.id)}
                onClick={() => setActiveSection(section.id)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    const offset = event.key === 'ArrowDown' ? 1 : -1;
                    const nextSection = sections[(sectionIndex + offset + sections.length) % sections.length];
                    if (!nextSection) return;
                    setActiveSection(nextSection.id);
                    focusRow(nextSection.id);
                    return;
                  }
                  if (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setActiveSection(section.id);
                    focusActiveOption();
                    return;
                  }
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    setActiveSection(null);
                    triggerRef.current?.focus();
                  }
                }}
              >
                <span className="model-selection-picker-row-label">{section.label}</span>
                <span className="model-selection-picker-row-value">
                  <span className="model-selection-picker-row-selection">{selectedLabel(section.options, section.value)}</span>
                  <ChevronRight className="model-selection-picker-row-chevron" size={13} aria-hidden="true" />
                </span>
              </button>
            );
          })}
          {activeDefinition ? (
            <div
              className={`model-selection-picker-submenu model-selection-picker-${activeDefinition.id}-submenu`}
              ref={submenuRef}
              role="menu"
              aria-label={`${activeDefinition.label} options`}
            >
              {activeDefinition.options.map((option) => {
                const selected = option.value === activeDefinition.value;
                return (
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    aria-disabled={option.disabled || undefined}
                    className={`model-selection-picker-option ${selected ? 'is-selected' : ''}`.trim()}
                    tabIndex={selected ? 0 : -1}
                    disabled={option.disabled}
                    key={option.value}
                    onClick={() => {
                      activeDefinition.onSelect(option.value);
                      closePicker();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowLeft') {
                        event.preventDefault();
                        focusRow(activeDefinition.id);
                        return;
                      }
                      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
                      event.preventDefault();
                      const options = Array.from(submenuRef.current?.querySelectorAll<HTMLButtonElement>('.model-selection-picker-option:not(:disabled)') ?? []);
                      const currentIndex = options.indexOf(event.currentTarget);
                      const nextIndex = event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? options.length - 1
                          : (currentIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
                      options[nextIndex]?.focus();
                    }}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`${className} model-selection-picker ${open ? 'is-open' : ''}`.trim()} ref={pickerRef}>
      <button
        ref={triggerRef}
        type="button"
        className="model-selection-picker-trigger"
        title={title}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            closePicker();
            return;
          }
          openPicker();
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          const section = event.key === 'ArrowDown' ? 'provider' : 'effort';
          openPicker(section, true);
        }}
      >
        <ProviderIcon className="model-selection-picker-provider-icon" provider={providerValue} size={13} aria-hidden="true" />
        <span className="model-selection-picker-model">{modelLabel}</span>
        <span className="model-selection-picker-effort">{effortLabel}</span>
        <ChevronDown className="model-selection-picker-trigger-chevron" size={13} aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

function selectedLabel(options: ModelSelectionPickerOption[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}
