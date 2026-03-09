import { describe, expect, it } from "vitest";

import { buildConsensusReport } from "../../src/consensus/engine.js";
import type { ExecutionStepResult, ReviewOutput } from "../../src/types/index.js";

describe("buildConsensusReport", () => {
  it("recommends proceed for approving reviews", () => {
    const report = buildConsensusReport([
      makeReviewStep({
        verdict: "approve",
        severity: "low",
        issues: [],
        security_flags: [],
        cross_file_concerns: [],
        agrees_with_prior_reviews: null,
        prior_review_disagreements: [],
        suggested_revision: null,
      }),
    ]);

    expect(report).not.toBeNull();
    expect(report?.recommendation).toBe("proceed");
    expect(report?.overallSeverity).toBe("low");
  });

  it("recommends escalate for critical issues", () => {
    const report = buildConsensusReport([
      makeReviewStep({
        verdict: "reject",
        severity: "critical",
        issues: [
          {
            file: "src/index.ts",
            line: 1,
            description: "Critical flaw",
            severity: "critical",
            suggestion: "Fix it",
          },
        ],
        security_flags: [],
        cross_file_concerns: [],
        agrees_with_prior_reviews: null,
        prior_review_disagreements: [],
        suggested_revision: null,
      }),
    ]);

    expect(report?.recommendation).toBe("escalate_to_human");
    expect(report?.blockers).toHaveLength(1);
  });
});

function makeReviewStep(parsedOutput: ReviewOutput): ExecutionStepResult {
  return {
    stepIndex: 1,
    role: "review",
    agent: "claude",
    status: "completed",
    startedAt: new Date(0).toISOString(),
    completedAt: new Date(100).toISOString(),
    durationMs: 100,
    context: {
      summary: "",
      sources: [],
      techStack: [],
      tokenBudget: 100,
      warnings: [],
      truncated: false,
      includedFiles: [],
    },
    command: ["claude"],
    prompt: "prompt",
    stdout: "",
    stderr: "",
    normalizedOutput: JSON.stringify(parsedOutput),
    parsedOutput,
    error: null,
  };
}
