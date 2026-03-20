export type AgentId = "claude" | "codex" | "gemini";

export type RoleId =
  | "architect"
  | "execute"
  | "review"
  | "revise"
  | "summarise";

export interface PipelineStep {
  role: RoleId;
  agent: AgentId;
  raw: string;
}

export interface PipelineGroup {
  index: number;
  steps: PipelineStep[];
}

export interface ParsedPipeline {
  raw: string;
  groups: PipelineGroup[];
}

export interface CodeContext {
  summary: string;
  sources: string[];
  techStack: string[];
  tokenBudget: number;
  warnings: string[];
  truncated: boolean;
  includedFiles: Array<{ path: string; estimatedTokens: number }>;
}

export interface PriorStepOutput {
  stepIndex: number;
  role: RoleId;
  agent: AgentId;
  content: string;
}

export interface TokenUsage {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  cachedInputTokens?: number | undefined;
  cacheCreationInputTokens?: number | undefined;
  thoughtTokens?: number | undefined;
  toolTokens?: number | undefined;
  totalTokens?: number | undefined;
}

export interface ExecutionStepResult {
  stepIndex: number;
  role: RoleId;
  agent: AgentId;
  status: "completed" | "failed" | "parse_failed";
  startedAt: string;
  completedAt: string;
  durationMs: number;
  context: CodeContext;
  command: string[];
  prompt: string;
  stdout: string;
  stderr: string;
  normalizedOutput: string;
  providerSessionId?: string | undefined;
  tokenUsage?: TokenUsage | undefined;
  parsedOutput: StepOutput | null;
  error: string | null;
}

export interface ArchitectOutput {
  rationale: string;
  proposed_approach: string;
  confidence: number;
  concerns: string[];
  suggested_tests: string[];
}

export interface ExecutorOutput {
  unified_diff: string;
  files_affected: string[];
  shell_commands: string[];
  edge_cases: string[];
  confidence: number;
}

export interface ReviewIssue {
  file: string | null;
  line: number | null;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestion: string;
}

export interface ReviewOutput {
  verdict: "approve" | "revise" | "reject";
  severity: "low" | "medium" | "high" | "critical";
  issues: ReviewIssue[];
  security_flags: string[];
  cross_file_concerns: string[];
  agrees_with_prior_reviews: boolean | null;
  prior_review_disagreements: string[];
  suggested_revision: string | null;
}

export interface ReviseOutput {
  revised_unified_diff: string;
  rationale: string;
  addressed_issues: string[];
  unresolved: string[];
  confidence: number;
}

export interface SummaryOutput {
  decision: string;
  key_issues_found: string[];
  changes_proposed: string[];
  open_questions: string[];
  recommendation: string;
}

export type StepOutput =
  | ArchitectOutput
  | ExecutorOutput
  | ReviewOutput
  | ReviseOutput
  | SummaryOutput;

export interface SessionStepLog {
  index: number;
  role: RoleId;
  agent: AgentId;
  status: "completed" | "failed" | "timed_out" | "parse_failed";
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  promptSummary: {
    taskLength: number;
    contextSources: string[];
    includedFiles: Array<{ path: string; estimatedTokens: number }>;
    truncated: boolean;
  };
  rawOutput: string | null;
  providerSessionId?: string | undefined;
  tokenUsage?: TokenUsage | undefined;
  parsedOutput: unknown | null;
  error: string | null;
}

export interface ConsensusReport {
  aligned: boolean;
  overallSeverity: "low" | "medium" | "high" | "critical";
  confidence: number;
  blockers: ReviewIssue[];
  recommendation: "proceed" | "revise" | "escalate_to_human";
  summary: string;
}

export interface SessionLog {
  sessionId: string;
  timestamp: string;
  durationMs: number;
  request: {
    task: string;
    pipeline: string;
    options: Record<string, unknown>;
  };
  steps: SessionStepLog[];
  consensus: ConsensusReport | null;
  finalRecommendation: string;
}

export interface ValidationWarning {
  code: string;
  message: string;
}

export interface ValidationError {
  code: string;
  message: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface AgentCliStatus {
  agent: AgentId;
  binary: string;
  installed: boolean;
  detectedVersion: string | null;
  minimumVersion: string;
  meetsMinimumVersion: boolean;
  error: string | null;
}

export interface ParsedAgentResponse<TOutput> {
  ok: boolean;
  data: TOutput | null;
  extractedJson: string | null;
  error: string | null;
}

export interface PresetConfig {
  pipeline: string;
  description: string;
}

export interface AgentModelConfig {
  claude?: string | undefined;
  codex?: string | undefined;
  gemini?: string | undefined;
}

export interface ReviewLauncherProfileConfig {
  description?: string | undefined;
  mode?: "investigation" | "plan" | "implementation" | undefined;
  default_reviewers?: AgentId[] | undefined;
}

export interface ReviewLauncherLastUsedConfig {
  reviewer_models?: string[] | undefined;
}

export interface ReviewLauncherConfig {
  files_folder?: string | undefined;
  investigations_folder?: string | undefined;
  plans_folder?: string | undefined;
  reviews_folder?: string | undefined;
  profiles: Record<string, ReviewLauncherProfileConfig>;
  last_used?: ReviewLauncherLastUsedConfig | undefined;
}

export interface ReviewDefaultsConfig {
  mode?: "investigation" | "plan" | "implementation" | undefined;
  instructions?: string | undefined;
  repo_summary?: string | undefined;
  tech_stack?: string[] | undefined;
  files?: string[] | undefined;
  verbose?: boolean | undefined;
  gemini_strict?: boolean | undefined;
}

export interface ProjectConfig {
  default_pipeline?: string | undefined;
  presets: Record<string, PresetConfig>;
  agent_models: AgentModelConfig;
  prompts: Partial<Record<RoleId, string | undefined>>;
  review_defaults?: ReviewDefaultsConfig | undefined;
  review_launcher?: ReviewLauncherConfig | undefined;
}
