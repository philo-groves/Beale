import type { RepeatSchedule } from './types';

export function normalizeRepeatSchedule(value: unknown): RepeatSchedule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: 'none' };
  const candidate = value as Partial<RepeatSchedule>;
  if (
    candidate.type !== 'minutely'
    && candidate.type !== 'hourly'
    && candidate.type !== 'daily'
    && candidate.type !== 'weekly'
    && candidate.type !== 'monthly'
  ) {
    return { type: 'none' };
  }
  return {
    type: candidate.type,
    interval: boundedRepeatInterval('interval' in candidate ? candidate.interval : undefined)
  };
}

export function repeatScheduleLabel(schedule: RepeatSchedule): string {
  const normalized = normalizeRepeatSchedule(schedule);
  if (normalized.type === 'none') return 'No Repeat';
  if (normalized.type === 'minutely') return normalized.interval === 1 ? 'Every minute' : `Every ${normalized.interval} minutes`;
  if (normalized.type === 'hourly') return normalized.interval === 1 ? 'Hourly' : `Every ${normalized.interval} hours`;
  if (normalized.type === 'daily') return normalized.interval === 1 ? 'Daily' : `Every ${normalized.interval} days`;
  if (normalized.type === 'weekly') return normalized.interval === 1 ? 'Weekly' : `Every ${normalized.interval} weeks`;
  return normalized.interval === 1 ? 'Monthly' : `Every ${normalized.interval} months`;
}

export function repeatScheduleFor(type: RepeatSchedule['type'], interval: number): RepeatSchedule {
  if (type === 'none') return { type: 'none' };
  return { type, interval: boundedRepeatInterval(interval) };
}

function boundedRepeatInterval(value: unknown): number {
  const interval = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 1;
  return Math.max(1, Math.min(99, interval));
}
