import type { HostEnvironment } from '@shared/types';

export function menuShortcut(platform: HostEnvironment['platform'], key: string): string {
  return platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`;
}

export function viewMenuShortcut(platform: HostEnvironment['platform'], action: 'zoom_in' | 'zoom_out'): string {
  return menuShortcut(platform, action === 'zoom_in' ? '+' : '-');
}

export function zoomPercentLabel(percent: number): string {
  const safePercent = Number.isFinite(percent) ? Math.max(1, Math.round(percent)) : 100;
  return `${safePercent}%`;
}
