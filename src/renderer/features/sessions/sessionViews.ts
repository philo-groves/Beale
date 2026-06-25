export type SessionMainView = 'context' | 'list' | 'spawn';

export const SESSION_MAIN_VIEW_ORDER = ['spawn', 'context', 'list'] as const satisfies readonly SessionMainView[];

export const DEFAULT_SESSION_MAIN_VIEW: SessionMainView = 'spawn';
