import type { SessionLog } from "../types/index.js";

export function getSessionDiff(log: SessionLog): { executorDiff: string | null; revisedDiff: string | null } {
  const executorStep = log.steps.find(
    (step) =>
      step.role === "execute" &&
      step.parsedOutput !== null &&
      typeof (step.parsedOutput as Record<string, unknown>).unified_diff === "string",
  );

  const reviseStep = [...log.steps]
    .reverse()
    .find(
      (step) =>
        step.role === "revise" &&
        step.parsedOutput !== null &&
        typeof (step.parsedOutput as Record<string, unknown>).revised_unified_diff === "string",
    );

  return {
    executorDiff: executorStep
      ? ((executorStep.parsedOutput as Record<string, unknown>).unified_diff as string)
      : null,
    revisedDiff: reviseStep
      ? ((reviseStep.parsedOutput as Record<string, unknown>).revised_unified_diff as string)
      : null,
  };
}

