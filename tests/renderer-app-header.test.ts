import { describe, expect, it } from 'vitest';
import { displayProgramHeaderName } from '../src/renderer/view-models/appHeader';

describe('renderer app header view model', () => {
  it('renders program names in word-capitalized form', () => {
    expect(displayProgramHeaderName('SUPABASE')).toBe('Supabase');
    expect(displayProgramHeaderName('supabase mcp')).toBe('Supabase Mcp');
    expect(displayProgramHeaderName('  github-security_lab  ')).toBe('Github-Security_Lab');
  });

  it('falls back when no program is selected', () => {
    expect(displayProgramHeaderName('')).toBe('No Program Selected');
  });
});
