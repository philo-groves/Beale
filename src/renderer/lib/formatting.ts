const SESSION_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_PRIORITY_SCORE = 64;

export function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

export function traceLabel(value: string): string {
  return value
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join(' ');
}

export function formatSessionStart(date: Date): string {
  return `${SESSION_MONTHS[date.getMonth()]} ${date.getDate()}, ${formatSessionTime(date)}`;
}

export function formatSessionDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return formatSessionStart(date);
}

export function formatSessionTime(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? 'a' : 'p';
  return `${hour12}:${minutes}${suffix}`;
}

export function formatDurationHms(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000));
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatPriorityPill(priorityScore: number): string {
  return `P${clampPriorityScoreForDisplay(priorityScore)}`;
}

export function clampPriorityScoreForDisplay(priorityScore: number): number {
  if (!Number.isFinite(priorityScore)) return 0;
  return Math.max(0, Math.min(MAX_PRIORITY_SCORE, Math.round(priorityScore)));
}

export function networkProfileLabel(profile: string): string {
  if (profile === 'offline') return 'Offline';
  if (profile === 'scoped') return 'Scoped';
  if (profile === 'elevated') return 'Elevated';
  return profile;
}

export function stateClass(state: string): string {
  return state.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value * 100)}%`;
}

export function shortDate(value: string): string {
  return value.slice(0, 10);
}
