import type { ShellSafetyMode } from './types';

export const DEFAULT_SHELL_SAFETY_MODE: ShellSafetyMode = 'auto_review';

export function normalizeShellSafetyMode(value: unknown): ShellSafetyMode {
  if (value === 'manual_approval' || value === 'auto_review' || value === 'danger') return value;
  return DEFAULT_SHELL_SAFETY_MODE;
}

export function shellSafetyModeLabel(mode: ShellSafetyMode): string {
  if (mode === 'manual_approval') return 'Manual Approval';
  if (mode === 'danger') return 'Danger Mode';
  return 'Auto-Review';
}
