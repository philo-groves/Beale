import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron renderer security boundary', () => {
  it('keeps the renderer sandboxed with navigation and popup denial', () => {
    const source = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8');
    expect(source).toMatch(/contextIsolation:\s*true/);
    expect(source).toMatch(/nodeIntegration:\s*false/);
    expect(source).toMatch(/sandbox:\s*true/);
    expect(source).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))");
    expect(source).toContain("webContents.on('will-navigate'");
  });

  it('ships a restrictive renderer content security policy', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain("object-src 'none'");
    expect(html).toContain("frame-ancestors 'none'");
  });
});
