import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('renderer run-detail polling', () => {
  it('does not defer live incremental detail behind a starvable React transition', () => {
    const source = readFileSync(
      new URL('../src/renderer/hooks/useRunDetailPolling.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('startTransition');
    expect(source).toContain('detailRef.current = detail;');
    expect(source).toContain('setRunDetail(detail);');
  });
});
