import type { ShellSafetyMode } from '@shared/types';
import {
  DEFAULT_SHELL_SAFETY_MODE,
  normalizeShellSafetyMode,
  SHELL_SAFETY_MODE_OPTIONS
} from '../../shared/shellSafety';

export interface PermissionSettings {
  dangerModeEnabled: boolean;
  defaultShellSafetyMode: ShellSafetyMode;
}

export const PERMISSION_SETTINGS_STORAGE_KEY = 'beale.permissionSettings';
export const DEFAULT_PERMISSION_SETTINGS: PermissionSettings = Object.freeze({
  dangerModeEnabled: false,
  defaultShellSafetyMode: DEFAULT_SHELL_SAFETY_MODE
});

export function normalizePermissionSettings(value: unknown): PermissionSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PERMISSION_SETTINGS };
  const record = value as Record<string, unknown>;
  const dangerModeEnabled = record.dangerModeEnabled === true;
  const requestedDefault = normalizeShellSafetyMode(record.defaultShellSafetyMode);
  return {
    dangerModeEnabled,
    defaultShellSafetyMode: requestedDefault === 'danger' && !dangerModeEnabled
      ? DEFAULT_SHELL_SAFETY_MODE
      : requestedDefault
  };
}

export function readPermissionSettings(storage: Pick<Storage, 'getItem'>): PermissionSettings {
  try {
    const raw = storage.getItem(PERMISSION_SETTINGS_STORAGE_KEY);
    return raw ? normalizePermissionSettings(JSON.parse(raw)) : { ...DEFAULT_PERMISSION_SETTINGS };
  } catch {
    return { ...DEFAULT_PERMISSION_SETTINGS };
  }
}

export function writePermissionSettings(
  storage: Pick<Storage, 'setItem'>,
  settings: PermissionSettings
): void {
  try {
    storage.setItem(PERMISSION_SETTINGS_STORAGE_KEY, JSON.stringify(normalizePermissionSettings(settings)));
  } catch {
    // The current renderer can still use permission settings when storage is unavailable.
  }
}

export function withDangerModeEnabled(settings: PermissionSettings, enabled: boolean): PermissionSettings {
  return normalizePermissionSettings({ ...settings, dangerModeEnabled: enabled });
}

export function withDefaultShellSafetyMode(
  settings: PermissionSettings,
  mode: ShellSafetyMode
): PermissionSettings {
  return normalizePermissionSettings({ ...settings, defaultShellSafetyMode: mode });
}

export function permissionModeOptions(settings: PermissionSettings): typeof SHELL_SAFETY_MODE_OPTIONS {
  return settings.dangerModeEnabled
    ? [...SHELL_SAFETY_MODE_OPTIONS]
    : SHELL_SAFETY_MODE_OPTIONS.filter((option) => option.value !== 'danger');
}
