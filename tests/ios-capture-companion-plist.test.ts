import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PLIST = join(process.cwd(), 'ios/BealeCaptureCompanion/Info.plist');

function plistJson(key: string): unknown {
  return JSON.parse(execFileSync('/usr/bin/plutil', [
    '-extract', key, 'json', '-o', '-', PLIST
  ], { encoding: 'utf8' })) as unknown;
}

function plistString(key: string): string {
  return execFileSync('/usr/bin/plutil', [
    '-extract', key, 'raw', '-o', '-', PLIST
  ], { encoding: 'utf8' }).trim();
}

describe('iOS capture companion configuration', () => {
  it('declares persistent full-display capture while backgrounded', () => {
    expect(plistJson('UIBackgroundModes')).toEqual(['screen-capture']);
    expect(plistString('NSScreenCaptureUsageDescription')).toMatch(/iPhone screen pixels/);
  });
});
