export type SessionMainView = 'context' | 'list';

export const SESSION_MAIN_VIEW_ORDER = ['list', 'context'] as const satisfies readonly SessionMainView[];

export const DEFAULT_SESSION_MAIN_VIEW: SessionMainView = 'list';
