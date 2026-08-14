import type { MenuItemConstructorOptions } from 'electron';
import type { NativeMenuAction } from '@shared/types';

export interface NativeApplicationMenuCallbacks {
  dispatchRendererAction: (action: NativeMenuAction) => void;
  zoomOut: () => void;
  zoomIn: () => void;
  minimizeWindow: () => void;
  maximizeWindow: () => void;
  closeWindow: () => void;
}

export function nativeMacApplicationMenuTemplate(
  zoomPercent: number,
  callbacks: NativeApplicationMenuCallbacks
): MenuItemConstructorOptions[] {
  return [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Research Workspace',
          click: () => callbacks.dispatchRendererAction('new_research_workspace')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { label: 'Copy', role: 'copy', accelerator: 'CommandOrControl+C' },
        { label: 'Paste', role: 'paste', accelerator: 'CommandOrControl+V' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom Level',
          sublabel: zoomPercentLabel(zoomPercent),
          enabled: false
        },
        { label: 'Zoom Out', accelerator: 'CommandOrControl+-', click: callbacks.zoomOut },
        { label: 'Zoom In', accelerator: 'CommandOrControl+=', click: callbacks.zoomIn }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Minimize', click: callbacks.minimizeWindow },
        { label: 'Maximize', click: callbacks.maximizeWindow },
        { label: 'Close', click: callbacks.closeWindow }
      ]
    }
  ];
}

function zoomPercentLabel(value: number): string {
  const safePercent = Number.isFinite(value) ? Math.max(1, Math.round(value)) : 100;
  return `${safePercent}%`;
}
