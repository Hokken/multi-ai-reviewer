import type { ConsensusReport, ExecutionStepResult, ReviewIssue, ReviewOutput } from "../types/index.js";

export function buildConsensusReport(steps: ExecutionStepResult[]): ConsensusReport | null {
  const reviewSteps = steps.filter(
    (step): step is ExecutionStepResult & { parsedOutput: ReviewOutput } =>
      step.role === "review" && step.parsedOutput !== null,
  );

  if (reviewSteps.length === 0) {
    return null;
  }

  const reviews = reviewSteps.map((step) => step.parsedOutput);
  const allIssues = reviews.flatMap((review) => review.issues);
  const blockers = allIssues.filter(
    (issue) => issue.severity === "high" || issue.severity === "critical",
  );
  const hasCritical = allIssues.some((issue) => issue.severity === "critical");
  const hasReject = reviews.some((review) => review.verdict === "reject");
  const hasRevise = reviews.some((review) => review.verdict === "revise");

  const severity = computeOverallSeverity(reviews, allIssues);
  const recommendation = hasCritical || hasReject
    ? "escalate_to_human"
    : hasRevise
      ? "revise"
      : "proceed";

  const aligned = reviews.every((review) => review.verdict === reviews[0]?.verdict);
  const parseFailures = steps.filter((step) => step.status === "parse_failed").length;
  const failures = steps.filter((step) => step.status === "failed").length;
  const confidencePenalty = parseFailures * 0.1 + failures * 0.15;
  const confidence = Math.max(0, Math.min(1, (reviews.filter((r) => r.verdict === "approve").length / reviews.length) - confidencePenalty + (aligned ? 0.15 : 0)));

  const summary = buildSummary(reviews, blockers, recommendation, aligned);

  return {
    aligned,
    overallSeverity: severity,
    confidence,
    blockers,
    recommendation,
    summary,
  };
}

function computeOverallSeverity(
  reviews: ReviewOutput[],
  issues: ReviewIssue[],
): ConsensusReport["overallSeverity"] {
  if (issues.some((issue) => issue.severity === "critical")) {
    return "critical";
  }
  if (
    issues.some((issue) => issue.severity === "high") ||
    reviews.some((review) => review.severity === "high")
  ) {
    return "high";
  }
  if (
    issues.some((issue) => issue.severity === "medium") ||
    reviews.some((review) => review.severity === "medium")
  ) {
    return "medium";
  }
  return "low";
}

function buildSummary(
  reviews: ReviewOutput[],
  blockers: ReviewIssue[],
  recommendation: ConsensusReport["recommendation"],
  aligned: boolean,
): string {
  const reviewCount = reviews.length;
  const blockerCount = blockers.length;
  const verdicts = reviews.map((review) => review.verdict).join(", ");

  return [
    `${reviewCount} review step(s) completed with verdicts: ${verdicts}.`,
    blockerCount > 0 ? `${blockerCount} blocking issue(s) were identified.` : "No blocking review issues were identified.",
    aligned ? "Reviewers were aligned." : "Reviewers were not fully aligned.",
    `Recommendation: ${recommendation}.`,
  ].join(" ");
}

