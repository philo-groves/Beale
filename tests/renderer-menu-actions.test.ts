import { describe, expect, it } from 'vitest';
import { editMenuShortcut, insertTextAtRange } from '../src/renderer/app/menuActions';

describe('renderer menu actions', () => {
  it('formats platform-specific edit shortcuts', () => {
    expect(editMenuShortcut('darwin', 'C')).toBe('⌘C');
    expect(editMenuShortcut('linux', 'V')).toBe('Ctrl+V');
    expect(editMenuShortcut('win32', 'C')).toBe('Ctrl+C');
  });

  it('inserts pasted steering text at the selected range', () => {
    expect(insertTextAtRange('focus auth boundary', 'new ', 6, 6)).toEqual({
      value: 'focus new auth boundary',
      caret: 10
    });
    expect(insertTextAtRange('focus old boundary', 'auth', 6, 9)).toEqual({
      value: 'focus auth boundary',
      caret: 10
    });
    expect(insertTextAtRange('focus', ' now', 99, 99)).toEqual({
      value: 'focus now',
      caret: 9
    });
  });
});
