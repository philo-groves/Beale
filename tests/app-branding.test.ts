import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const projectRoot = process.cwd();

describe('desktop app branding', () => {
  it('brands every supported source-launch path before Electron starts', () => {
    const packageJson = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8')) as {
      productName: string;
      scripts: Record<string, string>;
    };

    expect(packageJson.productName).toBe('Beale');
    expect(packageJson.scripts.postinstall).toBe('npm run brand:electron');
    expect(packageJson.scripts.prestart).toBe('npm run brand:electron');
    expect(packageJson.scripts.predev).toBe('npm run brand:electron');
    expect(packageJson.scripts.prepreview).toBe('npm run brand:electron');
  });

  it.runIf(process.platform === 'darwin')('embeds the Beale identity and icon in the macOS Electron bundle', () => {
    execFileSync(process.execPath, [join(projectRoot, 'scripts/brand-electron.mjs')]);
    const contentsPath = join(projectRoot, 'node_modules/electron/dist/Electron.app/Contents');
    const plistPath = join(contentsPath, 'Info.plist');
    const plistValue = (key: string): string => execFileSync(
      'plutil',
      ['-extract', key, 'raw', plistPath],
      { encoding: 'utf8' }
    ).trim();

    expect(plistValue('CFBundleDisplayName')).toBe('Beale');
    expect(plistValue('CFBundleName')).toBe('Beale');
    expect(plistValue('CFBundleIdentifier')).toBe('com.beale.app');
    expect(plistValue('CFBundleIconFile')).toBe('beale.icns');
    expect(readFileSync(join(contentsPath, 'Resources/beale.icns')).byteLength).toBeGreaterThan(0);
  });
});
