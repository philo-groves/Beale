import { describe, expect, it } from 'vitest';
import { normalizeRepeatSchedule, repeatScheduleLabel } from '../src/shared/repeatSchedule';

describe('repeat schedule helpers', () => {
  it('defaults to no repeat', () => {
    expect(normalizeRepeatSchedule(undefined)).toEqual({ type: 'none' });
    expect(repeatScheduleLabel({ type: 'none' })).toBe('No Repeat');
  });

  it('keeps concise labels for recurring schedules', () => {
    expect(repeatScheduleLabel({ type: 'minutely', interval: 1 })).toBe('Every minute');
    expect(repeatScheduleLabel({ type: 'hourly', interval: 1 })).toBe('Hourly');
    expect(repeatScheduleLabel({ type: 'hourly', interval: 4 })).toBe('Every 4 hours');
    expect(repeatScheduleLabel({ type: 'daily', interval: 1 })).toBe('Daily');
    expect(repeatScheduleLabel({ type: 'weekly', interval: 2 })).toBe('Every 2 weeks');
    expect(repeatScheduleLabel({ type: 'monthly', interval: 3 })).toBe('Every 3 months');
  });

  it('bounds custom intervals', () => {
    expect(normalizeRepeatSchedule({ type: 'minutely', interval: 15 })).toEqual({ type: 'minutely', interval: 15 });
    expect(normalizeRepeatSchedule({ type: 'daily', interval: 0 })).toEqual({ type: 'daily', interval: 1 });
    expect(normalizeRepeatSchedule({ type: 'weekly', interval: 120 })).toEqual({ type: 'weekly', interval: 99 });
  });
});
