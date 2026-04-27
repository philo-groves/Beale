const SECRET_KEY_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential)\b/iu;

export function redactForModelText(text: string): string {
  return text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer ...redacted')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, 'sk-...redacted')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{12,}/g, 'github_pat_...redacted')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{12,}/g, 'gh*_...redacted')
    .replace(/\bxox[baprs]-[A-Za-z0-9-]{12,}/g, 'xox*-...redacted')
    .replace(
      /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)\s*([:=])\s*("[^"]+"|'[^']+'|[^\s,;]+)/giu,
      (_match, key: string, separator: string) => `${key}${separator}...redacted`
    );
}

export function redactJsonForModel(value: unknown): unknown {
  if (typeof value === 'string') return redactForModelText(value);
  if (Array.isArray(value)) return value.map((item) => redactJsonForModel(item));
  if (!value || typeof value !== 'object') return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] = SECRET_KEY_PATTERN.test(key) ? '...redacted' : redactJsonForModel(child);
  }
  return redacted;
}
