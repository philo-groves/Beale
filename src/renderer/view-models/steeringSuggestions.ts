import type { RunDetail, RunStatus } from '@shared/types';

const MAX_SUGGESTION_WORDS = 14;

export type SteeringInputTabAction = 'accept_suggestion' | 'show_suggestion' | 'none';

export function steeringInputSuggestion(detail: RunDetail | null): string | null {
  if (!detail) return null;
  const suggestedPrompt = finalPromptSuggestion(detail);
  if (suggestedPrompt) return shortSteeringSuggestion(suggestedPrompt);
  return fallbackSteeringSuggestion(detail.run.status);
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
  if (words.length <= MAX_SUGGESTION_WORDS) return sentence;
  return words.slice(0, MAX_SUGGESTION_WORDS).join(' ').replace(/[,:;.-]+$/u, '');
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
  for (const suggestion of suggestions) {
    if (typeof suggestion === 'string' && suggestion.trim()) return suggestion;
    if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) continue;
    const record = suggestion as Record<string, unknown>;
    const prompt = typeof record.promptMarkdown === 'string' ? record.promptMarkdown.trim() : '';
    const title = typeof record.title === 'string' ? record.title.trim() : '';
    if (prompt) return prompt;
    if (title) return title;
  }
  return null;
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
