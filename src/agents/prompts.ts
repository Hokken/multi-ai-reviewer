import { PROMPT_OUTPUT_CONTRACTS } from "../roles/index.js";
import type {
  CodeContext,
  PipelineStep,
  PriorStepOutput,
} from "../types/index.js";

export interface BuildPromptInput {
  step: PipelineStep;
  task: string;
  context: CodeContext;
  priorOutputs: PriorStepOutput[];
  systemPrompt: string;
}

export function buildPrompt(input: BuildPromptInput): string {
  const sections = [
    renderSection("ROLE", `${input.step.role}:${input.step.agent}`),
    renderSection("SYSTEM PROMPT", input.systemPrompt),
    renderSection("TASK", input.task),
    renderSection("CONTEXT", renderContext(input.context)),
    renderSection("PRIOR OUTPUTS", renderPriorOutputs(input.priorOutputs)),
    renderSection("OUTPUT CONTRACT", PROMPT_OUTPUT_CONTRACTS[input.step.role]),
  ];

  return sections.join("\n\n");
}

function renderSection(title: string, content: string): string {
  return `=== ${title} ===\n${content.trim()}`;
}

function renderContext(context: CodeContext): string {
  const lines: string[] = [
    `Token budget: ${context.tokenBudget}`,
    `Sources: ${context.sources.length > 0 ? context.sources.join(", ") : "none"}`,
  ];

  if (context.techStack.length > 0) {
    lines.push(`Tech stack: ${context.techStack.join(", ")}`);
  }

  if (context.truncated) {
    lines.push("Truncated: yes");
  }

  if (context.warnings.length > 0) {
    lines.push(`Warnings: ${context.warnings.join(" | ")}`);
  }

  if (context.includedFiles.length > 0) {
    lines.push(
      `Included files: ${context.includedFiles
        .map((file) => `${file.path} (${file.estimatedTokens} tokens)`)
        .join(", ")}`,
    );
  }

  lines.push("");
  lines.push(context.summary.trim() || "No context provided.");

  return lines.join("\n");
}

function renderPriorOutputs(priorOutputs: PriorStepOutput[]): string {
  if (priorOutputs.length === 0) {
    return "No prior outputs available for this step.";
  }

  return priorOutputs
    .map((priorOutput) => {
      const heading = `[Step ${priorOutput.stepIndex}] ${priorOutput.role}:${priorOutput.agent}`;
      return `${heading}\n${priorOutput.content}`;
    })
    .join("\n\n");
}
