export interface FocusableWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  restore(): void;
  show(): void;
  focus(): void;
}

export function restoreAndFocusWindow(window: FocusableWindow | null): boolean {
  if (!window || window.isDestroyed()) return false;

  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
  return true;
}
