import { writeSessionLog } from "../../audit/logger.js";
import { writeReviewChainRecord } from "../../audit/review-chains.js";
import { readFile } from "node:fs/promises";

import { buildPrompt } from "../../agents/prompts.js";
import {
  createProgressReporter,
  formatActiveAgentModels,
  formatStepResult,
  warning,
} from "../display.js";
import { buildConsensusReport } from "../../consensus/engine.js";
import { formatConsensusReport } from "../../consensus/report.js";
import {
  getRolePrompt,
  loadProjectConfig,
  resolveAgentModels,
} from "../../config/project.js";
import { buildContext } from "../../context/builder.js";
import { prepareExecutionWorkspace } from "../../execution/workspace.js";
import { executePipeline } from "../../orchestrator/pipeline/executor.js";
import { parsePipeline, PipelineParseError } from "../../orchestrator/pipeline/parser.js";
import { validatePipeline } from "../../orchestrator/pipeline/validator.js";
import type {
  AgentId,
  ParsedPipeline,
  PriorStepOutput,
  ReviewWorkflowKind,
} from "../../types/index.js";

export interface RunCommandOptions {
  task?: string;
  taskFile?: string;
  pipeline?: string;
  preset?: string;
  dryRun?: boolean;
  repoSummary?: string;
  techStack?: string[];
  files?: string[];
  agentFiles?: Partial<Record<AgentId, string[]>> | undefined;
  agentResumeSessions?: Partial<Record<AgentId, string>> | undefined;
  diff?: boolean;
  symbol?: string;
  verbose?: boolean;
  geminiStrict?: boolean;
  claudeModel?: string;
  codexModel?: string;
  geminiModel?: string;
  reportOnly?: boolean;
  interactiveProgress?: boolean | undefined;
  reviewChain?:
    | {
      kind: ReviewWorkflowKind;
      artifactPath: string;
    }
    | undefined;
}

export async function runRunCommand(options: RunCommandOptions): Promise<number> {
  const cwd = process.cwd();
  const projectConfig = await loadProjectConfig(cwd);
  const task = await resolveTask(options);
  if (!task) {
    process.stderr.write("A task is required. Use --task or --task-file.\n");
    return 1;
  }

  const pipelineString = resolvePipelineString(options, projectConfig);
  if (!pipelineString) {
    process.stderr.write(
      "A pipeline is required. Use --pipeline, --preset, or set default_pipeline in .mrev/config.yaml.\n",
    );
    return 1;
  }

  let pipeline: ParsedPipeline;
  try {
    pipeline = parsePipeline(pipelineString);
  } catch (error) {
    if (error instanceof PipelineParseError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const validation = validatePipeline(pipeline);
  for (const validationWarning of validation.warnings) {
    process.stdout.write(`${warning(validationWarning.message)}\n`);
  }

  if (validation.errors.length > 0) {
    for (const error of validation.errors) {
      process.stderr.write(`${error.message}\n`);
    }
    return 1;
  }

  if (!options.dryRun) {
    return runActualPipeline(task, pipeline, options, projectConfig);
  }

  const priorOutputs: PriorStepOutput[] = [];
  let stepIndex = 0;

  for (const group of pipeline.groups) {
    for (const step of group.steps) {
      stepIndex += 1;
        const context = await buildContext({
          cwd: process.cwd(),
          role: step.role,
          files: resolveContextFilesForStep(step.agent, options.files, options.agentFiles),
          diff: options.diff,
          symbol: options.symbol,
          repoSummary: options.repoSummary,
        techStack: options.techStack,
      });
      const prompt = buildPrompt({
        step,
        task,
        context,
        priorOutputs,
        systemPrompt: getRolePrompt(projectConfig, step.role),
      });

      process.stdout.write(`--- STEP ${stepIndex}: ${step.role}:${step.agent} ---\n`);
      process.stdout.write(`${prompt}\n\n`);
    }

    for (const step of group.steps) {
      priorOutputs.push({
        stepIndex: priorOutputs.length + 1,
        role: step.role,
        agent: step.agent,
        content:
          `[Dry-run placeholder] Runtime output from ${step.role}:${step.agent} ` +
          "will be injected here during an actual execution.",
      });
    }
  }

  return 0;
}

async function runActualPipeline(
  task: string,
  pipeline: ParsedPipeline,
  options: RunCommandOptions,
  projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>,
): Promise<number> {
  const agentModels = resolveAgentModels(projectConfig, {
    claude: options.claudeModel,
    codex: options.codexModel,
    gemini: options.geminiModel,
  });
  const workspace = await prepareExecutionWorkspace(process.cwd());
  const startedAt = Date.now();
  const progress = createProgressReporter({
    interactive:
      options.interactiveProgress ?? (!options.verbose && Boolean(process.stdout.isTTY)),
  });
  try {
    progress.startRun({ pipeline });
    process.stdout.write(`${formatActiveAgentModels(pipeline, agentModels)}\n`);

    const result = await executePipeline({
      pipeline,
      task,
      options: {
        contextCwd: workspace.contextCwd,
        agentCwd: workspace.agentCwd,
        agentModels,
        verbose: options.verbose,
        repoSummary: options.repoSummary,
        techStack: options.techStack,
        files: options.files,
        agentFiles: options.agentFiles,
        agentResumeSessions: options.agentResumeSessions,
        diff: options.diff,
        symbol: options.symbol,
        geminiStrict: options.geminiStrict,
        projectConfig,
        onGroupStart: (input) => {
          progress.startGroup(input);
        },
        onStepStart: (input) => {
          progress.startStep(input);
        },
        onStepComplete: (input) => {
          progress.completeStep(input);
        },
      },
    });
    const consensus = buildConsensusReport(result.steps);
    const session = await writeSessionLog({
      cwd: process.cwd(),
      task,
      pipeline: pipeline.raw,
      options: {
        repoSummary: options.repoSummary,
        techStack: options.techStack,
        files: options.files,
        agentFiles: options.agentFiles,
        diff: options.diff,
        symbol: options.symbol,
        geminiStrict: options.geminiStrict,
        verbose: options.verbose,
        dryRun: false,
        preset: options.preset,
        elapsedMs: Date.now() - startedAt,
        agentModels,
      },
      steps: result.steps,
      consensus,
    });
    if (options.reviewChain) {
      await writeReviewChainRecord({
        cwd: process.cwd(),
        kind: options.reviewChain.kind,
        artifactPath: options.reviewChain.artifactPath,
        reportPath: session.reportPath,
        sessionLogPath: session.path,
        sessionLog: session.log,
      });
    }

    const hasHardFailure = result.steps.some((step) => step.status === "failed");
    const hasParseFailure = result.steps.some((step) => step.status === "parse_failed");

    if (options.reportOnly) {
      const completionLabel = hasHardFailure || hasParseFailure
        ? "Completed with issues."
        : "Completed.";
      process.stdout.write(`${completionLabel} Markdown report saved: ${session.reportPath}\n`);
      return hasHardFailure ? 1 : 0;
    }

    for (const step of result.steps) {
      process.stdout.write(
        `STEP ${step.stepIndex} ${step.role}:${step.agent} - ${step.status}\n`,
      );

      if (step.status === "completed") {
        process.stdout.write(`${formatStepResult(step)}\n\n`);
        continue;
      }

      if (step.error) {
        process.stderr.write(`${step.error}\n`);
      }
      if (step.normalizedOutput.trim().length > 0) {
        process.stdout.write(`${step.normalizedOutput.trim()}\n\n`);
      }
    }

    process.stdout.write(`${formatConsensusReport(consensus)}\n`);
    process.stdout.write(`Session saved: ${session.path}\n`);
    process.stdout.write(`Markdown report saved: ${session.reportPath}\n`);

    return hasHardFailure ? 1 : 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    progress.fail(message);
    throw error;
  } finally {
    progress.stop();
    await workspace.cleanup();
  }
}

function resolveContextFilesForStep(
  agent: AgentId,
  sharedFiles?: string[] | undefined,
  agentFiles?: Partial<Record<AgentId, string[]>> | undefined,
): string[] | undefined {
  const merged = [
    ...(sharedFiles ?? []),
    ...(agentFiles?.[agent] ?? []),
  ];
  const unique = Array.from(new Set(merged));
  return unique.length > 0 ? unique : undefined;
}

function resolvePipelineString(
  options: RunCommandOptions,
  projectConfig: Awaited<ReturnType<typeof loadProjectConfig>>,
): string | null {
  if (options.pipeline && options.pipeline.trim().length > 0) {
    return options.pipeline.trim();
  }

  if (options.preset) {
    const preset = projectConfig.presets[options.preset];
    if (!preset) {
      throw new Error(`Preset not found: ${options.preset}`);
    }
    return preset.pipeline;
  }

  return projectConfig.default_pipeline ?? null;
}

async function resolveTask(options: RunCommandOptions): Promise<string | null> {
  if (options.task && options.task.trim().length > 0) {
    return options.task.trim();
  }

  if (options.taskFile) {
    const content = await readFile(options.taskFile, "utf8");
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  return null;
}
