const MAX_GOAL_OBJECTIVE_CHARS = 320;

const EXPLICIT_OBJECTIVE_LINE = /^\s*(?:#{1,6}\s*)?(?:(?:research|session)\s+)?(?:goal|objective|direction)\s*:?[ \t]*(.*)$/i;
const MARKDOWN_PREFIX = /^\s*(?:(?:#{1,6}|[-*+]|\d+[.)])\s+)+/;

/**
 * Keeps Honeycrisp's persistent objective concise and wholly derived from user
 * input. This deliberately performs no model generation or semantic rewrite.
 */
export function normalizeGoalObjective(value: string | null | undefined): string | null {
  const normalized = cleanObjectiveText(value ?? '');
  if (!normalized) return null;
  return truncateAtWordBoundary(normalized, MAX_GOAL_OBJECTIVE_CHARS);
}

/**
 * Derives a compact objective for manually-authored prompts. Explicit Goal or
 * Objective sections win; otherwise the first non-heading content is used.
 */
export function deriveGoalObjective(promptMarkdown: string): string | null {
  const lines = promptMarkdown.replace(/\r\n?/g, '\n').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index]?.match(EXPLICIT_OBJECTIVE_LINE);
    if (!match) continue;
    const paragraph = objectiveParagraph(lines, index, match[1] ?? '');
    if (paragraph) return firstSentence(paragraph);
  }

  const firstContent = firstContentLine(lines, true);
  return firstContent ? firstSentence(firstContent) : null;
}

export function resolveGoalObjective(
  explicitObjective: string | null | undefined,
  promptMarkdown: string
): string | null {
  return normalizeGoalObjective(explicitObjective) ?? deriveGoalObjective(promptMarkdown);
}

function firstContentLine(lines: readonly string[], skipHeadings = false): string | null {
  let headingFallback: string | null = null;
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^```/.test(trimmed)) continue;
    const isHeading = /^#{1,6}\s+/.test(trimmed);
    const cleaned = normalizeGoalObjective(trimmed.replace(MARKDOWN_PREFIX, ''));
    if (!cleaned) continue;
    if (skipHeadings && isHeading) {
      headingFallback ??= cleaned;
      continue;
    }
    return cleaned;
  }
  return headingFallback;
}

function firstSentence(value: string): string {
  const bounded = normalizeGoalObjective(value) ?? '';
  const sentenceEnd = bounded.search(/[.!?](?=\s|$)/);
  return sentenceEnd >= 0 ? bounded.slice(0, sentenceEnd + 1) : bounded;
}

function cleanObjectiveText(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:research|session)\s+)?(?:goal|objective|direction)\s*:\s*/i, '')
    .trim();
}

function objectiveParagraph(lines: readonly string[], headingIndex: number, inline: string): string | null {
  const parts: string[] = [];
  const normalizedInline = normalizeGoalObjective(inline);
  if (normalizedInline) parts.push(normalizedInline);

  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    if (hasSentenceEnd(parts.join(' '))) break;
    const trimmed = lines[index]?.trim() ?? '';
    if (!trimmed) {
      if (parts.length > 0) break;
      continue;
    }
    if (/^(?:```|#{1,6}\s+)/.test(trimmed)) break;
    const cleaned = normalizeGoalObjective(trimmed.replace(MARKDOWN_PREFIX, ''));
    if (cleaned) parts.push(cleaned);
  }

  return normalizeGoalObjective(parts.join(' '));
}

function hasSentenceEnd(value: string): boolean {
  return /[.!?](?=\s|$)/.test(value);
}

function truncateAtWordBoundary(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const prefix = value.slice(0, maxChars + 1);
  const boundary = prefix.lastIndexOf(' ');
  return prefix.slice(0, boundary >= Math.floor(maxChars * 0.6) ? boundary : maxChars).trimEnd();
}
