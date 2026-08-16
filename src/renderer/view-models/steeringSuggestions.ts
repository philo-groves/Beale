import type { RunDetail, RunStatus } from '@shared/types';

const MAX_SUGGESTION_WORDS = 14;
const MAX_RESEARCH_FOCUS_WORDS = 10;
const CLAUSE_CONNECTORS = new Set(['and', 'but', 'nor', 'or', 'then', 'while', 'yet']);
const INCOMPLETE_ENDING_WORDS = new Set((
  'a an and as at because but by for from if in into nor of on onto or the then through to under via while with without yet'
).split(/\s+/u));
const GENERIC_SUGGESTION_WORDS = new Set((
  'a an analyze analyzing and assess assessing blocker by completed context continue current deeper determine determining '
  + 'ended evidence examine examining explore exploring failed failure findings focus from high-impact highest highest-impact '
  + 'identify identifying impact important in inspect inspecting into investigate investigating investigation issue latest '
  + 'lead more most new next objective of on paused prior problem remaining research resolve result results review reviewing '
  + 'safely session state status stopped strongest task test testing the then to unresolved untitled use using validate validating '
  + 'verify verifying with work'
).split(/\s+/u));

export type SteeringInputTabAction = 'accept_suggestion' | 'show_suggestion' | 'none';

export function steeringInputSuggestion(detail: RunDetail | null): string | null {
  if (!detail) return null;
  const suggestedPrompt = finalPromptSuggestion(detail);
  const shortSuggestedPrompt = suggestedPrompt ? shortSteeringSuggestion(suggestedPrompt) : null;
  if (shortSuggestedPrompt && !isVagueSteeringSuggestion(shortSuggestedPrompt)) return shortSuggestedPrompt;

  const researchFocus = contextualResearchFocus(detail);
  if (researchFocus) return `Continue investigating ${researchFocus}.`;
  return shortSuggestedPrompt ?? fallbackSteeringSuggestion(detail.run.status);
}

export function steeringSuggestionAutoVisible(status: RunStatus | null): boolean {
  return status === 'blocked' || status === 'completed' || status === 'failed' || status === 'stopped';
}

export function steeringInputTabAction(input: {
  instruction: string;
  suggestion: string | null;
  suggestionShowing: boolean;
}): SteeringInputTabAction {
  if (input.instruction.trim() || !input.suggestion) return 'none';
  return input.suggestionShowing ? 'accept_suggestion' : 'show_suggestion';
}

export function shortSteeringSuggestion(value: string): string | null {
  const normalized = normalizeSuggestionText(value);
  if (!normalized) return null;
  const sentence = firstSentence(normalized);
  const words = sentence.split(/\s+/u).filter(Boolean);
  const clipped = words.length <= MAX_SUGGESTION_WORDS
    ? sentence
    : clipAtCoherentBoundary(words, MAX_SUGGESTION_WORDS);
  return completeSuggestionSentence(clipped);
}

function finalPromptSuggestion(detail: RunDetail): string | null {
  const transcriptMessages = detail.transcriptMessages ?? [];
  const traceEvents = detail.traceEvents ?? [];
  for (let index = transcriptMessages.length - 1; index >= 0; index -= 1) {
    const message = transcriptMessages[index];
    const suggestion = message ? promptSuggestionFromMetadata(message.metadata) : null;
    if (suggestion) return suggestion;
  }
  for (let index = traceEvents.length - 1; index >= 0; index -= 1) {
    const event = traceEvents[index];
    const suggestion = event ? promptSuggestionFromMetadata(event.payload) : null;
    if (suggestion) return suggestion;
  }
  return null;
}

function promptSuggestionFromMetadata(metadata: Record<string, unknown>): string | null {
  const suggestions = metadata.nextPromptSuggestions;
  if (!Array.isArray(suggestions)) return null;
  let fallback: string | null = null;
  for (const suggestion of suggestions) {
    let candidates: string[] = [];
    if (typeof suggestion === 'string') {
      candidates = [suggestion];
    } else if (suggestion && typeof suggestion === 'object' && !Array.isArray(suggestion)) {
      const record = suggestion as Record<string, unknown>;
      candidates = [
        typeof record.promptMarkdown === 'string' ? record.promptMarkdown : '',
        typeof record.title === 'string' ? record.title : ''
      ];
    }
    const normalizedCandidates = candidates
      .map((candidate) => shortSteeringSuggestion(candidate))
      .filter((candidate): candidate is string => Boolean(candidate));
    const specific = normalizedCandidates.find((candidate) => !isVagueSteeringSuggestion(candidate));
    if (specific) return specific;
    fallback ??= normalizedCandidates[0] ?? null;
  }
  return fallback;
}

function contextualResearchFocus(detail: RunDetail): string | null {
  const latestUserInstruction = [...(detail.transcriptMessages ?? [])]
    .reverse()
    .find((message) => message.role === 'user')
    ?.contentMarkdown;
  const ended = detail.run.status === 'blocked'
    || detail.run.status === 'completed'
    || detail.run.status === 'failed'
    || detail.run.status === 'stopped';
  const candidates = ended
    ? [
        detail.run.finalDisposition?.summary,
        detail.run.summary,
        latestUserInstruction,
        detail.run.title,
        detail.run.promptMarkdown,
        detail.run.targetPath
      ]
    : [latestUserInstruction, detail.run.title, detail.run.promptMarkdown, detail.run.targetPath];
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const focus = compactResearchFocus(candidate);
    if (focus && !isVagueSteeringSuggestion(focus)) return focus;
  }
  return null;
}

function compactResearchFocus(value: string): string | null {
  const normalized = firstSentence(normalizeSuggestionText(value))
    .replace(/^(?:objective|goal|task)\s*:?\s*/iu, '')
    .replace(
      /^(?:(?:the\s+)?(?:research|investigation|analysis|session)|i|we)?\s*(?:characterized|confirmed|concluded|demonstrated|established|found|identified|reproduced|showed)\s+(?:that\s+)?/iu,
      ''
    )
    .replace(
      /^(?:please\s+)?(?:continue(?:\s+(?:to|with))?|focus(?:\s+next)?(?:\s+on)?|investigat(?:e|ing)|analyz(?:e|ing)|assess(?:ing)?|determin(?:e|ing)|verif(?:y|ying)|validat(?:e|ing)|explor(?:e|ing)|research(?:ing)?|inspect(?:ing)?|review(?:ing)?|test(?:ing)?|find(?:ing)?|identif(?:y|ying)|examin(?:e|ing))\s+/iu,
      ''
    )
    .replace(/[.!?]+$/u, '')
    .trim();
  if (!normalized) return null;
  const words = normalized.split(/\s+/u).filter(Boolean);
  const clipped = words.length <= MAX_RESEARCH_FOCUS_WORDS
    ? words.join(' ')
    : clipAtCoherentBoundary(words, MAX_RESEARCH_FOCUS_WORDS);
  return trimIncompleteEnding(clipped) || null;
}

function clipAtCoherentBoundary(words: readonly string[], maximumWords: number): string {
  const clipped = words.slice(0, maximumWords);
  for (let index = clipped.length - 1; index >= Math.ceil(maximumWords / 2); index -= 1) {
    const word = clipped[index]?.toLocaleLowerCase().replace(/[^\p{L}]+/gu, '') ?? '';
    if (CLAUSE_CONNECTORS.has(word)) return clipped.slice(0, index).join(' ');
  }
  return clipped.join(' ');
}

function trimIncompleteEnding(value: string): string {
  const words = value
    .replace(/[.!?]+$/u, '')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  while (words.length > 1) {
    const last = words.at(-1)?.toLocaleLowerCase().replace(/[^\p{L}]+/gu, '') ?? '';
    if (!INCOMPLETE_ENDING_WORDS.has(last)) break;
    words.pop();
  }
  return words.join(' ').replace(/[,:;.-]+$/u, '').trim();
}

function completeSuggestionSentence(value: string): string | null {
  const ending = value.trim().match(/[?!]$/u)?.[0] ?? '.';
  const body = trimIncompleteEnding(value);
  return body ? `${body}${ending}` : null;
}

function isVagueSteeringSuggestion(value: string): boolean {
  const words = normalizeSuggestionText(value)
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu) ?? [];
  return !words.some((word) => !GENERIC_SUGGESTION_WORDS.has(word));
}

function fallbackSteeringSuggestion(status: RunStatus): string {
  if (status === 'active') return 'Focus on the highest-impact remaining lead.';
  if (status === 'paused') return 'Continue from the current paused state.';
  if (status === 'blocked') return 'Resolve the blocker, then continue the session.';
  if (status === 'failed') return 'Investigate the failure and continue safely.';
  if (status === 'stopped') return 'Resume from the last useful result.';
  if (status === 'completed') return 'Continue from the latest findings.';
  return 'Continue from the latest session context.';
}

function normalizeSuggestionText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, '$1')
    .replace(/^#{1,6}\s*/gmu, '')
    .replace(/^\s*[-*+]\s+/gmu, '')
    .replace(/[*_~>#]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function firstSentence(value: string): string {
  const match = value.match(/^(.{1,180}?[.!?])(?:\s|$)/u);
  return (match?.[1] ?? value).trim();
}
