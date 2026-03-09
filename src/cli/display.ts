import type {
  AgentId,
  AgentModelConfig,
  ArchitectOutput,
  ExecutionStepResult,
  ExecutorOutput,
  ParsedPipeline,
  PipelineGroup,
  PipelineStep,
  ReviewOutput,
  ReviseOutput,
  SummaryOutput,
} from "../types/index.js";

const SPINNER_FRAMES = ["-", "\\", "|", "/"];

export interface TerminalWriter {
  isTTY?: boolean | undefined;
  write(chunk: string): boolean;
}

export interface StepProgressEvent {
  stepIndex: number;
  totalSteps: number;
  step: PipelineStep;
}

export interface ProgressReporter {
  startRun(input: {
    pipeline: ParsedPipeline;
  }): void;
  startGroup(input: {
    group: PipelineGroup;
    totalGroups: number;
  }): void;
  startStep(input: StepProgressEvent): void;
  completeStep(input: {
    result: ExecutionStepResult;
    totalSteps: number;
  }): void;
  fail(message: string): void;
  stop(): void;
}

export function createProgressReporter(input?: {
  writer?: TerminalWriter | undefined;
  interactive?: boolean | undefined;
}): ProgressReporter {
  const writer = input?.writer ?? process.stdout;
  const interactive = input?.interactive ?? Boolean(writer.isTTY);
  const activeSteps = new Map<number, string>();
  let spinnerFrame = 0;
  let spinnerTimer: NodeJS.Timeout | null = null;
  let activeBlockVisible = 0;

  function writeLine(line: string): void {
    clearActiveBlock();
    writer.write(`${line}\n`);
    renderActiveBlock();
  }

  function clearActiveBlock(): void {
    if (!interactive || activeBlockVisible === 0) {
      return;
    }

    for (let index = 0; index < activeBlockVisible; index += 1) {
      writer.write("\x1B[1A");
      writer.write("\r\x1B[2K");
    }
    activeBlockVisible = 0;
  }

  function renderActiveBlock(): void {
    if (!interactive || activeSteps.size === 0) {
      activeBlockVisible = 0;
      return;
    }

    const frame = SPINNER_FRAMES[spinnerFrame] ?? "-";
    spinnerFrame = (spinnerFrame + 1) % SPINNER_FRAMES.length;
    const lines = Array.from(activeSteps.entries())
      .sort((left, right) => left[0] - right[0])
      .map(([, label]) => `${frame} ${label}`);

    for (const line of lines) {
      writer.write(`${line}\n`);
    }
    activeBlockVisible = lines.length;
  }

  function repaintActiveBlock(): void {
    clearActiveBlock();
    renderActiveBlock();
  }

  function ensureSpinner(): void {
    if (!interactive || spinnerTimer !== null) {
      return;
    }

    spinnerTimer = setInterval(repaintActiveBlock, 100);
  }

  function stopSpinner(): void {
    if (spinnerTimer !== null) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  return {
    startRun({ pipeline }): void {
      const totalSteps = pipeline.groups.reduce(
        (count, group) => count + group.steps.length,
        0,
      );
      writeLine(
        `Starting run: ${totalSteps} step(s) across ${pipeline.groups.length} group(s).`,
      );
    },

    startGroup({ group, totalGroups }): void {
      void totalGroups;
      const summary = group.steps
        .map((step) => `${step.role}:${step.agent}`)
        .join(" | ");
      writeLine(`Running: ${summary}`);
    },

    startStep({ stepIndex, totalSteps, step }): void {
      const label = `[${stepIndex}/${totalSteps}] ${step.role}:${step.agent}`;
      activeSteps.set(stepIndex, label);

      if (interactive) {
        ensureSpinner();
        repaintActiveBlock();
        return;
      }

      writeLine(`Running ${label}...`);
    },

    completeStep({ result, totalSteps }): void {
      activeSteps.delete(result.stepIndex);
      const seconds = (result.durationMs / 1000).toFixed(1);
      void totalSteps;
      writeLine(
        `Finished ${result.role}:${result.agent} -> ${result.status} (${seconds}s)`,
      );
    },

    fail(message: string): void {
      writeLine(`Run failed: ${message}`);
    },

    stop(): void {
      stopSpinner();
      clearActiveBlock();
      activeSteps.clear();
    },
  };
}

export function warning(message: string): string {
  return `Warning: ${message}`;
}

export function formatStepResult(result: ExecutionStepResult): string {
  if (result.parsedOutput === null) {
    return result.normalizedOutput.trim();
  }

  switch (result.role) {
    case "architect":
      return formatArchitectOutput(result.parsedOutput as ArchitectOutput);
    case "execute":
      return formatExecutorOutput(result.parsedOutput as ExecutorOutput);
    case "review":
      return formatReviewOutput(result.parsedOutput as ReviewOutput);
    case "revise":
      return formatReviseOutput(result.parsedOutput as ReviseOutput);
    case "summarise":
      return formatSummaryOutput(result.parsedOutput as SummaryOutput);
    default:
      return result.normalizedOutput.trim();
  }
}

export function formatCompactTask(task: string, maxLength = 72): string {
  const singleLine = task.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function formatActiveAgentModels(
  pipeline: ParsedPipeline,
  agentModels: AgentModelConfig,
): string {
  const activeAgents = new Set<AgentId>();

  for (const group of pipeline.groups) {
    for (const step of group.steps) {
      activeAgents.add(step.agent);
    }
  }

  const parts = Array.from(activeAgents).map((agent) => {
    const model = agentModels[agent] ?? "default";
    return `${agent}=${model}`;
  });

  return `Agent models: ${parts.join(", ")}`;
}

function formatArchitectOutput(output: ArchitectOutput): string {
  const lines = [
    "### Architecture",
    `- **Rationale:** ${output.rationale}`,
    `- **Approach:** ${output.proposed_approach}`,
    `- **Confidence:** ${output.confidence.toFixed(2)}`,
  ];

  appendList(lines, "Concerns", output.concerns);
  appendList(lines, "Suggested tests", output.suggested_tests);
  return lines.join("\n");
}

function formatExecutorOutput(output: ExecutorOutput): string {
  const lines = [
    "### Execution",
    `- **Files affected:** ${output.files_affected.length > 0 ? output.files_affected.join(", ") : "[none]"}`,
    `- **Confidence:** ${output.confidence.toFixed(2)}`,
  ];

  appendList(lines, "Shell commands", output.shell_commands);
  appendList(lines, "Edge cases", output.edge_cases);

  const diff = output.unified_diff.trim();
  lines.push("#### Unified Diff");
  lines.push(diff.length > 0 ? diff : "[none]");
  return lines.join("\n");
}

function formatReviewOutput(output: ReviewOutput): string {
  const lines = [
    "### Review",
    `- **Verdict:** ${output.verdict}`,
    `- **Severity:** ${output.severity}`,
  ];

  if (output.issues.length === 0) {
    lines.push("- **Issues:** [none]");
  } else {
    lines.push("#### Issues");
    for (const issue of output.issues) {
      const location = issue.file
        ? issue.line !== null
          ? `${issue.file}:${issue.line}`
          : issue.file
        : "general";
      lines.push(`- **[${issue.severity}]** ${location} ${issue.description}`);
      if (issue.suggestion.trim().length > 0) {
        lines.push(`  - Suggestion: ${issue.suggestion}`);
      }
    }
  }

  appendList(lines, "Security flags", output.security_flags);
  appendList(lines, "Cross-file concerns", output.cross_file_concerns);
  appendList(lines, "Prior review disagreements", output.prior_review_disagreements);

  if (output.suggested_revision && output.suggested_revision.trim().length > 0) {
    lines.push(`- **Suggested revision:** ${output.suggested_revision}`);
  }

  return lines.join("\n");
}

function formatReviseOutput(output: ReviseOutput): string {
  const lines = [
    "### Revision",
    `- **Rationale:** ${output.rationale}`,
    `- **Confidence:** ${output.confidence.toFixed(2)}`,
  ];

  appendList(lines, "Addressed issues", output.addressed_issues);
  appendList(lines, "Unresolved", output.unresolved);

  const diff = output.revised_unified_diff.trim();
  lines.push("#### Revised Diff");
  lines.push(diff.length > 0 ? diff : "[none]");
  return lines.join("\n");
}

function formatSummaryOutput(output: SummaryOutput): string {
  const lines = [
    "### Summary",
    `- **Decision:** ${output.decision}`,
    `- **Recommendation:** ${output.recommendation}`,
  ];

  appendList(lines, "Key issues", output.key_issues_found);
  appendList(lines, "Changes proposed", output.changes_proposed);
  appendList(lines, "Open questions", output.open_questions);
  return lines.join("\n");
}

function appendList(lines: string[], label: string, items: string[]): void {
  if (items.length === 0) {
    lines.push(`- **${label}:** [none]`);
    return;
  }

  lines.push(`#### ${label}`);
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}
