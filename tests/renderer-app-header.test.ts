import { describe, expect, it } from 'vitest';
import { displayBreakoutRoomTitle, displayWorkspaceHeaderName } from '../src/renderer/view-models/appHeader';

describe('renderer app header view model', () => {
  it('renders workspace names in word-capitalized form', () => {
    expect(displayWorkspaceHeaderName('SUPABASE')).toBe('Supabase');
    expect(displayWorkspaceHeaderName('supabase mcp')).toBe('Supabase Mcp');
    expect(displayWorkspaceHeaderName('  github-security_lab  ')).toBe('Github-Security_Lab');
  });

  it('falls back when no workspace is selected', () => {
    expect(displayWorkspaceHeaderName('')).toBe('No Workspace Selected');
  });

  it('capitalizes the first letter of each breakout room name word', () => {
    expect(displayBreakoutRoomTitle('parser review')).toBe('Parser Review');
    expect(displayBreakoutRoomTitle('  live provider challenge  ')).toBe('Live Provider Challenge');
    expect(displayBreakoutRoomTitle('API audit')).toBe('API Audit');
  });
});
