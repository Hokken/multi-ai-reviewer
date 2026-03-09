import { parseAgentResponse } from "../../agents/parser.js";
import { buildPrompt } from "../../agents/prompts.js";
import { ClaudeAdapter } from "../../agents/adapters/claude.js";
import { CodexAdapter } from "../../agents/adapters/codex.js";
import { GeminiAdapter } from "../../agents/adapters/gemini.js";
import type { AgentAdapter } from "../../agents/adapters/types.js";
import { getRolePrompt, resolveAgentModels } from "../../config/project.js";
import { buildContext } from "../../context/builder.js";
import type {
  AgentModelConfig,
  ExecutionStepResult,
  ParsedPipeline,
  PipelineGroup,
  PipelineStep,
  PriorStepOutput,
  ProjectConfig,
} from "../../types/index.js";

const ADAPTERS: Record<"claude" | "codex" | "gemini", AgentAdapter> = {
  claude: new ClaudeAdapter(),
  codex: new CodexAdapter(),
  gemini: new GeminiAdapter(),
};

export interface ExecutePipelineInput {
  pipeline: ParsedPipeline;
  task: string;
  options: RunExecutionOptions;
}

export interface RunExecutionOptions {
  contextCwd: string;
  agentCwd: string;
  agentModels?: AgentModelConfig | undefined;
  verbose?: boolean | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
  files?: string[] | undefined;
  diff?: boolean | undefined;
  symbol?: string | undefined;
  geminiStrict?: boolean | undefined;
  projectConfig?: ProjectConfig | undefined;
  onGroupStart?: ((input: {
    group: PipelineGroup;
    totalGroups: number;
  }) => void) | undefined;
  onStepStart?: ((input: {
    stepIndex: number;
    totalSteps: number;
    step: PipelineStep;
  }) => void) | undefined;
  onStepComplete?: ((input: {
    result: ExecutionStepResult;
    totalSteps: number;
  }) => void) | undefined;
}

export interface ExecutePipelineResult {
  steps: ExecutionStepResult[];
}

export async function executePipeline(
  input: ExecutePipelineInput,
): Promise<ExecutePipelineResult> {
  const resolvedAgentModels = input.options.projectConfig
    ? resolveAgentModels(input.options.projectConfig, input.options.agentModels)
    : (input.options.agentModels ?? {});
  const allResults: ExecutionStepResult[] = [];
  const priorOutputs: PriorStepOutput[] = [];
  const totalSteps = input.pipeline.groups.reduce(
    (count, group) => count + group.steps.length,
    0,
  );
  let stepIndex = 0;

  for (const group of input.pipeline.groups) {
    input.options.onGroupStart?.({
      group,
      totalGroups: input.pipeline.groups.length,
    });
    const groupStepIndexStart = stepIndex;
    const groupResults = await Promise.all(
      group.steps.map(async (step, indexInGroup) => {
        const currentStepIndex = groupStepIndexStart + indexInGroup + 1;
        input.options.onStepStart?.({
          stepIndex: currentStepIndex,
          totalSteps,
          step,
        });
        const startedAtDate = new Date();
        const context = await buildContext({
          cwd: input.options.contextCwd,
          role: step.role,
          files: input.options.files,
          diff: input.options.diff,
          symbol: input.options.symbol,
          repoSummary: input.options.repoSummary,
          techStack: input.options.techStack,
        });
        const prompt = buildPrompt({
          step,
          task: input.task,
          context,
          priorOutputs,
          systemPrompt: input.options.projectConfig
            ? getRolePrompt(input.options.projectConfig, step.role)
            : "",
        });

        const adapter = ADAPTERS[step.agent];
        const execution = await adapter.execute({
          step,
          prompt,
          cwd: input.options.agentCwd,
          model: resolvedAgentModels[step.agent],
          verbose: input.options.verbose,
        });

        const parsed = parseAgentResponse(step.role, execution.normalizedOutput);
        const parseFailed = !parsed.ok;
        const failed = execution.exitCode !== 0;
        const status =
          failed ? "failed" : parseFailed ? "parse_failed" : "completed";
        const completedAtDate = new Date();

        const result = {
          stepIndex: currentStepIndex,
          role: step.role,
          agent: step.agent,
          status,
          startedAt: startedAtDate.toISOString(),
          completedAt: completedAtDate.toISOString(),
          durationMs: completedAtDate.getTime() - startedAtDate.getTime(),
          context,
          command: execution.command,
          prompt,
          stdout: execution.stdout,
          stderr: execution.stderr,
          normalizedOutput: execution.normalizedOutput,
          parsedOutput: parsed.data,
          error:
            execution.exitCode !== 0
              ? `Command exited with code ${execution.exitCode}`
              : parsed.error,
        } satisfies ExecutionStepResult;

        input.options.onStepComplete?.({
          result,
          totalSteps,
        });

        return result;
      }),
    );

    allResults.push(...groupResults);
    stepIndex += group.steps.length;

    const usableResults = groupResults.filter(
      (result) => result.normalizedOutput.trim().length > 0,
    );

    if (usableResults.length === 0) {
      const details = groupResults
        .map((result) => {
          const fragments = [
            `${result.role}:${result.agent}`,
            result.error,
            result.stderr.trim(),
            result.stdout.trim(),
          ].filter((fragment) => fragment && fragment.length > 0);

          return fragments.join(" | ");
        })
        .join("\n");

      throw new Error(
        `All steps in pipeline group ${group.index + 1} failed to produce usable output.\n${details}`,
      );
    }

    for (const result of groupResults) {
      priorOutputs.push({
        stepIndex: result.stepIndex,
        role: result.role,
        agent: result.agent,
        content:
          result.parsedOutput !== null
            ? JSON.stringify(result.parsedOutput, null, 2)
            : result.normalizedOutput || result.stderr || result.error || "",
      });

      if (
        input.options.geminiStrict &&
        result.agent === "gemini" &&
        result.status === "parse_failed"
      ) {
        throw new Error("Gemini strict mode is enabled and Gemini returned invalid structured output.");
      }
    }
  }

  return { steps: allResults };
}
