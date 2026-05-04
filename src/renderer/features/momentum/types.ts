export type ResearchMomentumState = 'idle' | 'exploring' | 'building' | 'verifying' | 'hot' | 'stuck' | 'waiting';

export interface ResearchMomentum {
  state: ResearchMomentumState;
  reason: string;
  since: string | null;
  supportingTraceEventIds: string[];
}

export interface ContextMeter {
  fraction: number;
  inputTokens: number | null;
  tokenLimit: number;
  totalSessionTokens: number;
  totalSessionTokensLabel: string;
  label: string;
  source: string;
}
