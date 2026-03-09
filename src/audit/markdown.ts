import { getSessionDiff } from "./diff.js";
import { getReportPathPattern } from "../config/storage.js";

import type { SessionLog } from "../types/index.js";

export function renderSessionMarkdown(log: SessionLog): string {
  const reviewFindings = collectReviewFindings(log);
  const reviewerModels = collectReviewerModels(log);
  const priorReviewReports = collectPriorReviewReports(log);
  const reviewArtifact = resolveReviewArtifact(log);
  const lines: string[] = [
    "# Multi AI Reviewer Report",
    "",
    "## Session",
    "",
    `- **Session ID:** ${log.sessionId}`,
    `- **Timestamp:** ${log.timestamp}`,
    `- **Duration:** ${formatDuration(log.durationMs)}`,
    `- **Pipeline:** \`${log.request.pipeline}\``,
    `- **Recommendation:** ${log.finalRecommendation}`,
    "",
    "## Review Summary",
    "",
  ];

  if (reviewFindings.length > 0) {
    lines.push(`- **Issues found:** ${reviewFindings.length}`);
    lines.push(`- **Highest severity:** ${highestSeverity(reviewFindings)}`);
  } else if (log.steps.some((step) => step.role === "review")) {
    lines.push("- **Issues found:** 0");
    lines.push("- **Highest severity:** low");
    lines.push("");
    lines.push("Reviewers did not record any explicit issues in this run.");
  } else {
    lines.push("This session did not include review findings.");
  }

  if (log.consensus) {
    lines.push(`- **Consensus recommendation:** ${log.consensus.recommendation}`);
  }
  if (reviewArtifact.path) {
    lines.push(`- **File:** ${reviewArtifact.path}`);
  }
  if (reviewArtifact.kind) {
    lines.push(`- **Mode:** ${reviewArtifact.kind}`);
  }
  if (reviewerModels.length > 0) {
    lines.push(`- **Reviewer models:** ${reviewerModels.join(", ")}`);
  }
  if (priorReviewReports.length > 0) {
    lines.push(`- **Validation history:** ${priorReviewReports.length} prior report(s) included`);
  }

  lines.push("");

  if (priorReviewReports.length > 0) {
    lines.push("## Validation Context");
    lines.push("");
    lines.push("Prior review reports included in this validation pass:");
    for (const reportPath of priorReviewReports) {
      lines.push(`- ${reportPath}`);
    }
    lines.push("");
  }

  if (log.steps.some((step) => step.role === "review")) {
    lines.push("## Key Findings");
    lines.push("");

    if (reviewFindings.length === 0) {
      lines.push("- No reviewer issues were recorded.");
    } else {
      for (const finding of reviewFindings) {
        lines.push(
          `- [${finding.severity}] ${formatIssueLocation(finding.file, finding.line)}${finding.description} (reviewer: ${finding.reviewer})`,
        );
        if (finding.suggestion) {
          lines.push(`  Suggestion: ${finding.suggestion}`);
        }
      }
    }

    lines.push("");
  }

  lines.push("## Steps");
  lines.push("");

  for (const step of log.steps) {
    lines.push(`### Step ${step.index} - ${step.role}:${step.agent}`);
    lines.push("");
    lines.push(`- **Status:** ${step.status}`);
    const stepModel = resolveStepModel(log, step.agent);
    if (stepModel) {
      lines.push(`- **Model:** ${stepModel}`);
    }
    if (step.durationMs !== null) {
      lines.push(`- **Duration:** ${formatDuration(step.durationMs)}`);
    }
    if (step.promptSummary.contextSources.length > 0) {
      lines.push(`- **Context sources:** ${step.promptSummary.contextSources.join(", ")}`);
    } else {
      lines.push("- **Context sources:** [none]");
    }
    if (step.promptSummary.includedFiles.length > 0) {
      lines.push(
        `- **Included files:** ${step.promptSummary.includedFiles
          .map((file) => `${file.path} (${file.estimatedTokens} tokens)`)
          .join(", ")}`,
      );
    }
    if (step.promptSummary.truncated) {
      lines.push("- **Context truncated:** yes");
    }
    if (step.error) {
      lines.push(`- **Error:** ${step.error}`);
    }
    lines.push("");
    lines.push(formatSessionStepOutput(step));
    lines.push("");
  }

  if (log.consensus) {
    lines.push("## Consensus");
    lines.push("");
    lines.push(`- **Recommendation:** ${log.consensus.recommendation}`);
    lines.push(`- **Severity:** ${log.consensus.overallSeverity}`);
    lines.push(`- **Confidence:** ${log.consensus.confidence.toFixed(2)}`);
    lines.push(`- **Aligned:** ${log.consensus.aligned ? "yes" : "no"}`);
    lines.push("");
    lines.push(log.consensus.summary);
    lines.push("");
  }

  const diff = getSessionDiff(log);
  if ((diff.executorDiff?.trim() ?? "").length > 0 || (diff.revisedDiff?.trim() ?? "").length > 0) {
    lines.push("## Diffs");
    lines.push("");

    if ((diff.executorDiff?.trim() ?? "").length > 0) {
      lines.push("### Executor Diff");
      lines.push("");
      lines.push("```diff");
      lines.push(diff.executorDiff!.trim());
      lines.push("```");
      lines.push("");
    }

    if ((diff.revisedDiff?.trim() ?? "").length > 0) {
      lines.push("### Revised Diff");
      lines.push("");
      lines.push("```diff");
      lines.push(diff.revisedDiff!.trim());
      lines.push("```");
      lines.push("");
    }
  }

  if (log.steps.some((step) => step.role === "review")) {
    lines.push("## Author Follow-Up");
    lines.push("");
    lines.push(buildAuthorFollowUp(reviewArtifact.kind));
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

function resolveReviewArtifact(log: SessionLog): {
  path?: string | undefined;
  kind?: "investigation" | "plan" | "implementation" | undefined;
} {
  const task = log.request.task;
  const investigationMatch = task.match(/^Review the investigation in "([^"]+)"/);
  if (investigationMatch?.[1]) {
    return {
      path: investigationMatch[1],
      kind: "investigation",
    };
  }

  const planMatch = task.match(/^Review the implementation plan in "([^"]+)"/);
  if (planMatch?.[1]) {
    return {
      path: planMatch[1],
      kind: "plan",
    };
  }

  const implementationMatch = task.match(
    /^Review the implementation using the review instructions file "([^"]+)"/,
  );
  if (implementationMatch?.[1]) {
    return {
      path: implementationMatch[1],
      kind: "implementation",
    };
  }

  for (const step of log.steps) {
    const primaryFile = step.promptSummary.includedFiles
      .map((file) => file.path)
      .find((filePath) => !isPriorReviewReportPath(filePath) && !isRepoInstructionFile(filePath));
    if (primaryFile) {
      return {
        path: primaryFile,
        kind: inferArtifactKindFromPath(primaryFile),
      };
    }
  }

  return {};
}

function buildAuthorFollowUp(
  kind?: "investigation" | "plan" | "implementation" | undefined,
): string {
  if (kind === "investigation") {
    return (
      "After addressing reviewer suggestions, update the `FIXES APPLIED` " +
      "section and keep the `Prior Reports` section current in the original " +
      "investigation file before running the next validation pass."
    );
  }

  if (kind === "plan") {
    return (
      "After addressing reviewer suggestions, update the `FIXES APPLIED` " +
      "section and keep the `Prior Reports` section current in the original " +
      "plan file before running the next validation pass."
    );
  }

  return (
    "After addressing reviewer suggestions, update the `FIXES APPLIED` " +
    "section and keep the `Prior Reports` section current in the original " +
    "review instructions file before running the next validation pass."
  );
}

function formatSessionStepOutput(step: SessionLog["steps"][number]): string {
  if (step.parsedOutput !== null) {
    return [
      "#### Parsed Output",
      "",
      "```json",
      JSON.stringify(step.parsedOutput, null, 2),
      "```",
    ].join("\n");
  }

  const raw = step.rawOutput?.trim() ?? "";
  if (raw.length > 0) {
    return [
      "#### Raw Output",
      "",
      "```text",
      raw,
      "```",
    ].join("\n");
  }

  return "_No output recorded._";
}

function formatDuration(durationMs: number): string {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function collectReviewFindings(log: SessionLog): Array<{
  reviewer: string;
  file: string | null;
  line: number | null;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  suggestion: string;
}> {
  const findings: Array<{
    reviewer: string;
    file: string | null;
    line: number | null;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    suggestion: string;
  }> = [];

  for (const step of log.steps) {
    if (step.role !== "review" || !isReviewOutput(step.parsedOutput)) {
      continue;
    }

    for (const issue of step.parsedOutput.issues) {
      findings.push({
        reviewer: step.agent,
        file: issue.file,
        line: issue.line,
        description: issue.description,
        severity: issue.severity,
        suggestion: issue.suggestion,
      });
    }
  }

  return findings;
}

function collectReviewerModels(log: SessionLog): string[] {
  return log.steps
    .filter((step) => step.role === "review")
    .map((step) => {
      const model = resolveStepModel(log, step.agent);
      return model ? `${step.agent}=${model}` : step.agent;
    });
}

function collectPriorReviewReports(log: SessionLog): string[] {
  const reports = new Set<string>();

  for (const step of log.steps) {
    if (step.role !== "review") {
      continue;
    }

    for (const includedFile of step.promptSummary.includedFiles) {
      if (isPriorReviewReportPath(includedFile.path)) {
        reports.add(includedFile.path);
      }
    }
  }

  return Array.from(reports).sort((left, right) => left.localeCompare(right));
}

function resolveStepModel(
  log: SessionLog,
  agent: SessionLog["steps"][number]["agent"],
): string | undefined {
  const requestOptions = log.request.options;
  if (!requestOptions || typeof requestOptions !== "object") {
    return undefined;
  }

  const agentModels = (requestOptions as { agentModels?: unknown }).agentModels;
  if (!agentModels || typeof agentModels !== "object") {
    return undefined;
  }

  const value = (agentModels as Record<string, unknown>)[agent];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function isPriorReviewReportPath(filePath: string): boolean {
  return getReportPathPattern().test(filePath);
}

function isRepoInstructionFile(filePath: string): boolean {
  return /(^|[\\/])(CLAUDE|AGENTS|GEMINI)\.md$/i.test(filePath);
}

function inferArtifactKindFromPath(
  filePath: string,
): "investigation" | "plan" | "implementation" | undefined {
  const normalized = filePath.toLowerCase();
  if (normalized.includes("investigation")) {
    return "investigation";
  }
  if (normalized.includes("plan")) {
    return "plan";
  }
  if (normalized.includes("review")) {
    return "implementation";
  }
  return undefined;
}

function isReviewOutput(value: unknown): value is {
  issues: Array<{
    file: string | null;
    line: number | null;
    description: string;
    severity: "low" | "medium" | "high" | "critical";
    suggestion: string;
  }>;
} {
  return Boolean(
    value
    && typeof value === "object"
    && Array.isArray((value as { issues?: unknown }).issues),
  );
}

function highestSeverity(
  findings: Array<{ severity: "low" | "medium" | "high" | "critical" }>,
): "low" | "medium" | "high" | "critical" {
  const order = {
    low: 0,
    medium: 1,
    high: 2,
    critical: 3,
  } as const;

  return findings.reduce<"low" | "medium" | "high" | "critical">((current, finding) => {
    return order[finding.severity] > order[current] ? finding.severity : current;
  }, "low");
}

function formatIssueLocation(file: string | null, line: number | null): string {
  if (!file) {
    return "";
  }

  if (line === null) {
    return `${file}: `;
  }

  return `${file}:${line}: `;
}
