import type { HostEnvironment } from '@shared/types';

export const PASTE_STEERING_EVENT = 'beale:paste-steering';

export interface PasteSteeringEventDetail {
  text: string;
}

export function editMenuShortcut(platform: HostEnvironment['platform'], key: 'C' | 'V'): string {
  return platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`;
}

export function selectedTextFromDocument(doc: Document = document): string {
  const active = doc.activeElement;
  if (isSelectableTextInput(active)) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    return start === end ? '' : active.value.slice(Math.min(start, end), Math.max(start, end));
  }
  return doc.getSelection()?.toString() ?? '';
}

export async function copySelectedTextToClipboard(): Promise<boolean> {
  const text = selectedTextFromDocument();
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    return await navigator.clipboard.readText();
  } catch {
    return '';
  }
}

export function dispatchPasteSteeringText(text: string): void {
  if (!text) return;
  window.dispatchEvent(new CustomEvent<PasteSteeringEventDetail>(PASTE_STEERING_EVENT, { detail: { text } }));
}

export function insertTextAtRange(value: string, text: string, start: number, end: number): { value: string; caret: number } {
  const safeStart = clampIndex(start, value.length);
  const safeEnd = clampIndex(end, value.length);
  const from = Math.min(safeStart, safeEnd);
  const to = Math.max(safeStart, safeEnd);
  return {
    value: `${value.slice(0, from)}${text}${value.slice(to)}`,
    caret: from + text.length
  };
}

function isSelectableTextInput(element: Element | null): element is HTMLInputElement | HTMLTextAreaElement {
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return ['email', 'number', 'password', 'search', 'tel', 'text', 'url'].includes(element.type);
}

function clampIndex(value: number, length: number): number {
  if (!Number.isFinite(value)) return length;
  return Math.max(0, Math.min(length, Math.trunc(value)));
}
