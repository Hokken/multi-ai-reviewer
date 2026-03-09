import type {
  ParsedPipeline,
  PipelineStep,
  ValidationError,
  ValidationResult,
  ValidationWarning,
} from "../../types/index.js";

export function validatePipeline(pipeline: ParsedPipeline): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const steps = pipeline.groups.flatMap((group) => group.steps);
  const executeSteps = steps.filter((step) => step.role === "execute");
  const reviewIndexes = indexStepsByRole(steps, "review");
  const reviseIndexes = indexStepsByRole(steps, "revise");

  if (executeSteps.length > 1) {
    errors.push({
      code: "multiple_execute_steps",
      message: "Only one execute step is allowed. Use revise for post-review refinement.",
    });
  }

  if (reviewIndexes.length === 0 && reviseIndexes.length > 0) {
    errors.push({
      code: "revise_without_review",
      message: "revise step has no review output to act on.",
    });
  }

  for (const reviseIndex of reviseIndexes) {
    const priorReviewExists = reviewIndexes.some((reviewIndex) => reviewIndex < reviseIndex);
    if (!priorReviewExists) {
      errors.push({
        code: "revise_before_review",
        message: "revise step requires at least one review step earlier in the pipeline.",
      });
    }
  }

  for (const group of pipeline.groups) {
    const seenAgents = new Set<string>();
    for (const step of group.steps) {
      if (seenAgents.has(step.agent)) {
        errors.push({
          code: "duplicate_agent_in_parallel_group",
          message: `${step.agent} cannot appear twice in the same parallel group.`,
        });
        break;
      }
      seenAgents.add(step.agent);
    }
  }

  for (let groupIndex = 1; groupIndex < pipeline.groups.length; groupIndex += 1) {
    const previousGroup = pipeline.groups[groupIndex - 1];
    const currentGroup = pipeline.groups[groupIndex];
    if (!previousGroup || !currentGroup) continue;

    for (const current of currentGroup.steps) {
      if (current.role !== "review") continue;
      const duplicate = previousGroup.steps.find(
        (prev) => prev.role === "review" && prev.agent === current.agent,
      );
      if (duplicate) {
        warnings.push({
          code: "same_agent_sequential_review",
          message:
            `Warning: ${current.agent} is assigned to review steps in consecutive groups. ` +
            "This is valid, but often has limited value.",
        });
      }
    }
  }

  const firstExecuteIndex = steps.findIndex((step) => step.role === "execute");
  if (firstExecuteIndex !== -1) {
    const architectBeforeExecute = steps
      .slice(0, firstExecuteIndex)
      .some((step) => step.role === "architect");

    if (!architectBeforeExecute) {
      warnings.push({
        code: "no_architect_before_execute",
        message: "Warning: no architect step before execute. The executor will work from task and context alone.",
      });
    }
  }

  if (steps.length > 6) {
    warnings.push({
      code: "long_pipeline",
      message: `Warning: long pipeline (${steps.length} steps). Consider saving it as a preset.`,
    });
  }

  return {
    errors,
    warnings,
  };
}

function indexStepsByRole(
  steps: PipelineStep[],
  role: PipelineStep["role"],
): number[] {
  const indexes: number[] = [];

  steps.forEach((step, index) => {
    if (step.role === role) {
      indexes.push(index);
    }
  });

  return indexes;
}
