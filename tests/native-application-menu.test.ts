import { describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';
import { nativeMacApplicationMenuTemplate } from '../src/main/nativeApplicationMenu';

describe('native macOS application menu', () => {
  it('builds the native File, Edit, View, and Window menus', () => {
    const dispatchRendererAction = vi.fn();
    const zoomOut = vi.fn();
    const zoomIn = vi.fn();
    const minimizeWindow = vi.fn();
    const maximizeWindow = vi.fn();
    const closeWindow = vi.fn();
    const template = nativeMacApplicationMenuTemplate(125, {
      dispatchRendererAction,
      zoomOut,
      zoomIn,
      minimizeWindow,
      maximizeWindow,
      closeWindow
    });

    expect(template[0]).toMatchObject({ role: 'appMenu' });
    expect(menuLabels(template)).toEqual(['File', 'Edit', 'View', 'Window']);
    expect(submenuLabels(template, 'File')).toEqual(['New Research Workspace']);
    expect(submenuLabels(template, 'Edit')).toEqual(['Copy', 'Paste']);
    expect(submenuItem(template, 'Edit', 'Copy')).toMatchObject({
      role: 'copy',
      accelerator: 'CommandOrControl+C'
    });
    expect(submenuItem(template, 'Edit', 'Paste')).toMatchObject({
      role: 'paste',
      accelerator: 'CommandOrControl+V'
    });
    expect(submenuLabels(template, 'View')).toEqual(['Zoom Level', 'Zoom Out', 'Zoom In']);
    expect(submenuLabels(template, 'Window')).toEqual(['Minimize', 'Maximize', 'Close']);
    expect(submenuItem(template, 'View', 'Zoom Level')).toMatchObject({ sublabel: '125%', enabled: false });

    invokeMenuItem(template, 'File', 'New Research Workspace');
    invokeMenuItem(template, 'View', 'Zoom Out');
    invokeMenuItem(template, 'View', 'Zoom In');
    invokeMenuItem(template, 'Window', 'Minimize');
    invokeMenuItem(template, 'Window', 'Maximize');
    invokeMenuItem(template, 'Window', 'Close');

    expect(dispatchRendererAction).toHaveBeenCalledExactlyOnceWith('new_research_workspace');
    expect(zoomOut).toHaveBeenCalledOnce();
    expect(zoomIn).toHaveBeenCalledOnce();
    expect(minimizeWindow).toHaveBeenCalledOnce();
    expect(maximizeWindow).toHaveBeenCalledOnce();
    expect(closeWindow).toHaveBeenCalledOnce();
  });
});

function menuLabels(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => typeof item.label === 'string' ? [item.label] : []);
}

function submenuItems(template: MenuItemConstructorOptions[], menuLabel: string): MenuItemConstructorOptions[] {
  const submenu = template.find((item) => item.label === menuLabel)?.submenu;
  return Array.isArray(submenu) ? submenu : [];
}

function submenuLabels(template: MenuItemConstructorOptions[], menuLabel: string): string[] {
  return submenuItems(template, menuLabel).flatMap((item) => typeof item.label === 'string' ? [item.label] : []);
}

function submenuItem(
  template: MenuItemConstructorOptions[],
  menuLabel: string,
  itemLabel: string
): MenuItemConstructorOptions | undefined {
  return submenuItems(template, menuLabel).find((item) => item.label === itemLabel);
}

function invokeMenuItem(template: MenuItemConstructorOptions[], menuLabel: string, itemLabel: string): void {
  const click = submenuItem(template, menuLabel, itemLabel)?.click;
  expect(click).toBeTypeOf('function');
  (click as unknown as () => void)();
}
