import { useCallback, useEffect, useState } from 'react';
import type { ShellSafetyMode } from '@shared/types';
import {
  DEFAULT_PERMISSION_SETTINGS,
  readPermissionSettings,
  withDangerModeEnabled,
  withDefaultShellSafetyMode,
  writePermissionSettings,
  type PermissionSettings
} from '../view-models/permissionSettings';

function initialPermissionSettings(): PermissionSettings {
  if (typeof window === 'undefined') return { ...DEFAULT_PERMISSION_SETTINGS };
  return readPermissionSettings(window.localStorage);
}

export function usePermissionSettings(): [
  PermissionSettings,
  (enabled: boolean) => void,
  (mode: ShellSafetyMode) => void
] {
  const [settings, setSettings] = useState<PermissionSettings>(initialPermissionSettings);

  useEffect(() => {
    writePermissionSettings(window.localStorage, settings);
  }, [settings]);

  const setDangerModeEnabled = useCallback((enabled: boolean): void => {
    setSettings((current) => withDangerModeEnabled(current, enabled));
  }, []);

  const setDefaultMode = useCallback((mode: ShellSafetyMode): void => {
    setSettings((current) => withDefaultShellSafetyMode(current, mode));
  }, []);

  return [settings, setDangerModeEnabled, setDefaultMode];
}
