import { describe, expect, it } from 'vitest';
import { notificationPreviewText } from '../src/renderer/features/notifications/Notifications';

describe('renderer notification display helpers', () => {
  it('skips a leading markdown heading and uses the first sentence for toast previews', () => {
    const preview = notificationPreviewText('# Final response\nThe agent found a verifier-backed issue. More detail follows.', 140);

    expect(preview).toBe('The agent found a verifier-backed issue.');
  });

  it('normalizes whitespace and truncates long previews', () => {
    const preview = notificationPreviewText('Line one has enough detail to overflow the small toast preview window without wrapping cleanly.', 48);

    expect(preview).toBe('Line one has enough detail to overflow the sm...');
  });
});
