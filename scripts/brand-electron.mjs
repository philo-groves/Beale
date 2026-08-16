import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const APP_NAME = 'Beale';
const APP_ID = 'com.beale.app';
const BRAND_VERSION = 1;
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function brandProjectElectron({
  electronAppPath = join(projectRoot, 'node_modules/electron/dist/Electron.app'),
  sourceIconPath = join(projectRoot, 'resources/app-icon.png')
} = {}) {
  if (process.platform !== 'darwin') return { branded: false, reason: 'unsupported-platform' };
  if (!existsSync(electronAppPath)) return { branded: false, reason: 'electron-not-installed' };
  if (!existsSync(sourceIconPath)) throw new Error(`Beale app icon is missing: ${sourceIconPath}`);

  const contentsPath = join(electronAppPath, 'Contents');
  const resourcesPath = join(contentsPath, 'Resources');
  const plistPath = join(contentsPath, 'Info.plist');
  const bundleIconPath = join(resourcesPath, 'beale.icns');
  const markerPath = join(resourcesPath, '.beale-brand.json');
  const fingerprint = createHash('sha256')
    .update(String(BRAND_VERSION))
    .update(readFileSync(sourceIconPath))
    .digest('hex');

  if (brandingIsCurrent(markerPath, bundleIconPath, plistPath, fingerprint)) {
    return { branded: false, reason: 'current' };
  }

  mkdirSync(resourcesPath, { recursive: true });
  const temporaryPath = mkdtempSync(join(tmpdir(), 'beale-icon-'));
  try {
    const generatedIconPath = generateMacIcon(sourceIconPath, temporaryPath);
    copyFileSync(generatedIconPath, bundleIconPath);
  } finally {
    rmSync(temporaryPath, { recursive: true, force: true });
  }

  replacePlistString(plistPath, 'CFBundleDisplayName', APP_NAME);
  replacePlistString(plistPath, 'CFBundleName', APP_NAME);
  replacePlistString(plistPath, 'CFBundleIdentifier', APP_ID);
  replacePlistString(plistPath, 'CFBundleIconFile', 'beale.icns');
  writeFileSync(markerPath, `${JSON.stringify({ fingerprint, appName: APP_NAME, appId: APP_ID })}\n`);

  // Electron releases vary between unsealed and signed bundles. Re-signing ad hoc
  // keeps the project-local development runtime launchable after metadata changes.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', electronAppPath], { stdio: 'ignore' });
  const now = new Date();
  utimesSync(electronAppPath, now, now);
  return { branded: true, reason: 'updated' };
}

function brandingIsCurrent(markerPath, iconPath, plistPath, fingerprint) {
  if (!existsSync(markerPath) || !existsSync(iconPath) || !existsSync(plistPath)) return false;
  try {
    const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
    return marker.fingerprint === fingerprint
      && plistString(plistPath, 'CFBundleDisplayName') === APP_NAME
      && plistString(plistPath, 'CFBundleName') === APP_NAME
      && plistString(plistPath, 'CFBundleIdentifier') === APP_ID
      && plistString(plistPath, 'CFBundleIconFile') === 'beale.icns';
  } catch {
    return false;
  }
}

function generateMacIcon(sourceIconPath, temporaryPath) {
  const sourceSize = imageSize(sourceIconPath);
  const cropSize = Math.min(sourceSize.width, sourceSize.height);
  if (!Number.isFinite(cropSize) || cropSize <= 0) throw new Error('Beale app icon has invalid dimensions.');

  const squarePath = join(temporaryPath, 'square.png');
  execFileSync('sips', ['--cropToHeightWidth', String(cropSize), String(cropSize), sourceIconPath, '--out', squarePath], { stdio: 'ignore' });

  const pngBySize = new Map();
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const pngPath = join(temporaryPath, `icon-${size}.png`);
    execFileSync('sips', ['--resampleHeightWidth', String(size), String(size), squarePath, '--out', pngPath], { stdio: 'ignore' });
    pngBySize.set(size, readFileSync(pngPath));
  }

  const iconPath = join(temporaryPath, 'beale.icns');
  writeFileSync(iconPath, encodeIcns([
    ['icp4', pngBySize.get(16)],
    ['icp5', pngBySize.get(32)],
    ['icp6', pngBySize.get(64)],
    ['ic07', pngBySize.get(128)],
    ['ic08', pngBySize.get(256)],
    ['ic09', pngBySize.get(512)],
    ['ic10', pngBySize.get(1024)],
    ['ic11', pngBySize.get(32)],
    ['ic12', pngBySize.get(64)],
    ['ic13', pngBySize.get(256)],
    ['ic14', pngBySize.get(512)]
  ]));
  return iconPath;
}

function encodeIcns(entries) {
  const chunks = entries.map(([type, data]) => {
    if (!Buffer.isBuffer(data)) throw new Error(`Missing Beale icon representation: ${type}`);
    const chunk = Buffer.allocUnsafe(8 + data.length);
    chunk.write(type, 0, 4, 'ascii');
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const header = Buffer.allocUnsafe(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

function imageSize(path) {
  const output = execFileSync('sips', ['--getProperty', 'pixelWidth', '--getProperty', 'pixelHeight', path], { encoding: 'utf8' });
  const width = Number(output.match(/pixelWidth: (\d+)/u)?.[1]);
  const height = Number(output.match(/pixelHeight: (\d+)/u)?.[1]);
  return { width, height };
}

function replacePlistString(plistPath, key, value) {
  execFileSync('plutil', ['-replace', key, '-string', value, plistPath], { stdio: 'ignore' });
}

function plistString(plistPath, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', plistPath], { encoding: 'utf8' }).trim();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = brandProjectElectron();
  if (result.reason === 'updated') console.log('Branded the project-local Electron runtime as Beale.');
}
