const SECRET_KEY_PATTERN = /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password|credential|cookie)\b/iu;
const PAIRED_SECRET_ARGUMENTS = new Set([
  '--api-key',
  '--apikey',
  '--access-token',
  '--refresh-token',
  '--token',
  '--secret',
  '--password',
  '--passwd',
  '--client-secret',
  '--credential',
  '--credentials',
  '--authorization',
  '--auth',
  '--user',
  '--userpwd',
  '--proxy-user',
  '--cookie',
  '-b',
  '-u'
]);
const HEADER_ARGUMENTS = new Set(['--header', '--proxy-header', '-h']);
const SECRET_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key'
]);

export function redactForModelText(text: string): string {
  return text
    .replace(
      /\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie|X-Api-Key|Api-Key)\s*:\s*[^\r\n]+/giu,
      '$1: ...redacted'
    )
    .replace(/\bBasic\s+[A-Za-z0-9+/=]{8,}/giu, 'Basic ...redacted')
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

export function redactCommandArgumentsForModel(args: readonly string[]): string[] {
  let redactNext = false;
  let redactHeader = false;
  return args.map((arg) => {
    if (redactNext) {
      redactNext = false;
      return '...redacted';
    }
    if (redactHeader) {
      redactHeader = false;
      return redactHeaderArgument(arg);
    }
    const normalized = arg.trim().toLowerCase();
    if (PAIRED_SECRET_ARGUMENTS.has(normalized)) {
      redactNext = true;
      return redactForModelText(arg);
    }
    const inlineSecretArgument = [...PAIRED_SECRET_ARGUMENTS].find((flag) =>
      normalized.startsWith(`${flag}=`)
    );
    if (inlineSecretArgument) {
      const separator = arg.indexOf('=');
      return `${arg.slice(0, separator + 1)}...redacted`;
    }
    if (HEADER_ARGUMENTS.has(normalized)) {
      redactHeader = true;
    }
    return redactForModelText(arg);
  });
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

function redactHeaderArgument(value: string): string {
  const separator = value.indexOf(':');
  if (separator < 0) return redactForModelText(value);
  const name = value.slice(0, separator).trim();
  return SECRET_HEADER_NAMES.has(name.toLowerCase())
    ? `${name}: ...redacted`
    : redactForModelText(value);
}
