export const SESSION_TITLE_FALLBACK = 'No Title Yet';
export const SESSION_TITLE_MAX_WORDS = 6;

const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'analysis',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'conduct',
  'deep',
  'first-party',
  'for',
  'focus',
  'focused',
  'focuses',
  'from',
  'in',
  'in-scope',
  'inscope',
  'into',
  'is',
  'it',
  'lets',
  "let's",
  'next',
  'of',
  'on',
  'or',
  'our',
  'please',
  'primary',
  'research',
  'review',
  'run',
  'scoped',
  'session',
  'surface',
  'surfaces',
  'target',
  'targets',
  'the',
  'this',
  'to',
  'underexplored',
  'use',
  'using',
  'we',
  'with'
]);

const LEGACY_TITLE_FALLBACKS = new Set(['Open discovery run', 'OpenAI discovery run', 'VM executor alpha run', 'Untitled research', 'Untitled run']);

export function generateSessionTitle(promptMarkdown: string): string {
  const text = promptTitleText(promptMarkdown);
  if (!text) return SESSION_TITLE_FALLBACK;

  const words = titleWords(text);
  const meaningful = words.filter((word) => !TITLE_STOP_WORDS.has(word.toLowerCase()));
  const selected = (meaningful.length > 0 ? meaningful : words).slice(0, SESSION_TITLE_MAX_WORDS);
  const title = selected.map(titleWord).join(' ').trim();
  return title || SESSION_TITLE_FALLBACK;
}

export function displaySessionTitle(title: string | null | undefined, promptMarkdown = ''): string {
  const normalized = normalizeTitle(title ?? '');
  if (!isGeneratedSessionTitle(normalized)) {
    return promptMarkdown ? generateSessionTitle(promptMarkdown) : SESSION_TITLE_FALLBACK;
  }
  if (isLowQualitySessionTitle(normalized) && promptMarkdown) return generateSessionTitle(promptMarkdown);
  return normalized;
}

export function isGeneratedSessionTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  if (!normalized || LEGACY_TITLE_FALLBACKS.has(normalized)) return false;
  return titleWords(normalized).length <= SESSION_TITLE_MAX_WORDS;
}

function promptTitleText(promptMarkdown: string): string {
  const withoutCode = promptMarkdown.replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]+)`/g, '$1');
  const rawLines = withoutCode.split(/\r?\n/);
  const cleanLines = rawLines
    .map(cleanPromptLine)
    .filter(Boolean)
    .map(stripTitleBoilerplate)
    .filter(Boolean);
  const firstHeading = rawLines.find((line) => /^#{1,6}\s+/.test(line.trim()));
  const headingCandidate = firstHeading ? stripTitleBoilerplate(cleanPromptLine(firstHeading)) : '';
  const text = cleanLines.join(' ').replace(/\s+/g, ' ').trim();
  const sentence = text.match(/^(.+?[.!?])(?:\s|$)/)?.[1] ?? text;
  const candidates = [headingCandidate, stripTitleBoilerplate(sentence), text];
  return candidates.find(hasUsefulTitleWords) ?? normalizeTitle(sentence);
}

function titleWords(value: string): string[] {
  return normalizeTitle(value)
    .replace(/[^\p{L}\p{N}#+._-]+/gu, ' ')
    .split(/\s+/)
    .map((word) => word.replace(/^[-_.]+|[-_.]+$/g, ''))
    .filter(Boolean);
}

function titleWord(value: string): string {
  if (/^[A-Z0-9_+.#-]{2,}$/.test(value)) return value;
  return value
    .split(/([-_.])/)
    .map((part) => (part.length === 0 || /^[-_.]$/.test(part) ? part : `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}`))
    .join('');
}

function cleanPromptLine(line: string): string {
  return normalizeTitle(line.replace(/^#{1,6}\s+/, '').replace(/^[*\-\d.]+\s+/, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'));
}

function stripTitleBoilerplate(value: string): string {
  let next = normalizeTitle(value);
  let previous = '';
  while (next && next !== previous) {
    previous = next;
    next = next
      .replace(/^(?:next\s+)?research\s+session\s*[:\-]\s*/i, '')
      .replace(/^(?:target\s+focus|focus|objective|goal)\s*[:\-]\s*/i, '')
      .replace(/^(?:please\s+)?(?:let'?s\s+)?(?:perform|conduct|run|do|start|begin|launch)\s+(?:a\s+|an\s+)?/i, '')
      .replace(/^(?:deep\s+)?(?:vulnerability|security)\s+(?:analysis|review|research|assessment)\s+(?:on|of|for)\s+/i, '')
      .replace(/^(?:the\s+)+/i, '')
      .trim();
  }
  return next;
}

function hasUsefulTitleWords(value: string): boolean {
  return titleWords(value).filter((word) => !TITLE_STOP_WORDS.has(word.toLowerCase())).length >= 2;
}

function isLowQualitySessionTitle(title: string): boolean {
  const words = titleWords(title);
  if (words.length === 0) return true;
  const usefulWords = words.filter((word) => !TITLE_STOP_WORDS.has(word.toLowerCase()));
  return usefulWords.length < Math.min(2, words.length);
}

function normalizeTitle(value: string): string {
  return value.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, ' ').trim();
}
