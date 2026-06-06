export type SimulationStep =
  | 'IDLE'
  | 'INPUT_GUARD'
  | 'REJECTED_STATE'
  | 'OBSERVE'
  | 'REASON'
  | 'FEEDBACK_LOOP'
  | 'ACT'
  | 'OUTPUT_GUARD'
  | 'ALERT_STATE';

export interface SourceInfo {
  title: string;
  url: string;
  relevance: number;
}

export interface TraceLog {
  id: string;
  stepName: string;
  subType: string;
  status: 'DONE' | 'BLOCKED' | 'PENDING' | 'RETRYING';
  durationMs: number;
  modelName: string;
  tokens: string;
  cost: string;
  retryCount: number;
}

export interface PresetScenario {
  id: string;
  label: string;
  icon: string;
  prompt: string;
  category: string;
  behaviorType: 'standard' | 'injection' | 'low_confidence';
  summary: string;
  inputGuardrailResults: {
    approvedTopics: boolean;
    promptInjectionSafe: boolean;
    lengthChecks: boolean;
  };
  observeResults: {
    sources: SourceInfo[];
    progressSearch: number;
    progressPage: number;
    progressParse: number;
  };
  reasonResults: {
    diffProgress: number;
    sourceRanking: number;
    confidence: number;
  };
  actResults: {
    summarizeProgress: number;
    notifierProgress: number;
    tokensUsed: number;
    costUsd: number;
  };
  outputGuardrailResults: {
    disclaimerCheck: boolean;
    confidenceScoreCheck: boolean;
    citationCheck: boolean;
  };
  finalAlert: {
    title: string;
    description: string;
    details: string;
    markdownBody: string;
  };
}
