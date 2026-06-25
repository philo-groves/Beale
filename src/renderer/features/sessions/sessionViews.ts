export type SessionMainView = 'list' | 'spawn';

export const SESSION_MAIN_VIEW_ORDER = ['spawn', 'list'] as const satisfies readonly SessionMainView[];

export const DEFAULT_SESSION_MAIN_VIEW: SessionMainView = 'spawn';
