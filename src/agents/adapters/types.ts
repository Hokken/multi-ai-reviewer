import type { AgentId, PipelineStep } from "../../types/index.js";

export interface AgentExecutionInput {
  step: PipelineStep;
  prompt: string;
  cwd: string;
  model?: string | undefined;
  verbose?: boolean | undefined;
}

export interface AgentExecutionResult {
  agent: AgentId;
  command: string[];
  stdout: string;
  stderr: string;
  exitCode: number;
  normalizedOutput: string;
}

export interface AgentAdapter {
  readonly agent: AgentId;
  execute(input: AgentExecutionInput): Promise<AgentExecutionResult>;
}
