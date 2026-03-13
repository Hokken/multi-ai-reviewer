import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getSessionDiff } from "../../src/audit/diff.js";
import { getSessionById, listSessions, searchSessions } from "../../src/audit/reader.js";
import { writeSessionLog } from "../../src/audit/logger.js";
import type { ExecutionStepResult } from "../../src/types/index.js";

describe("audit persistence", () => {
  it("writes and reads a session log", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-audit-"));

    try {
      const writeResult = await writeSessionLog({
        cwd,
        task: "Implement a no-op diff",
        pipeline: "execute:codex > review:claude",
        options: {
          agentModels: {
            codex: "gpt-5.2-codex",
            claude: "claude-sonnet-4-6",
          },
        },
        consensus: {
          aligned: true,
          overallSeverity: "low",
          confidence: 0.9,
          blockers: [],
          recommendation: "proceed",
          summary: "All good.",
        },
        steps: [makeExecuteStep(), makeReviewStep()],
      });

      const sessions = await listSessions(cwd);
      expect(sessions).toHaveLength(1);
      expect(sessions[0]?.log.sessionId).toBe(writeResult.sessionId);

      const found = await getSessionById(cwd, writeResult.sessionId);
      expect(found?.log.request.task).toBe("Implement a no-op diff");

      const matches = await searchSessions(cwd, "no-op");
      expect(matches).toHaveLength(1);

      const diff = getSessionDiff(found!.log);
      expect(diff.executorDiff).toBe("diff --git a/a.ts b/a.ts");
      expect(diff.revisedDiff).toBeNull();

      const markdown = await readFile(writeResult.reportPath, "utf8");
      expect(markdown).toContain("# Multi AI Reviewer Report");
      expect(markdown).toContain("## Review Summary");
      expect(markdown).toContain("Reviewers did not record any explicit issues");
      expect(markdown).toContain("File:** review-instructions.md");
      expect(markdown).toContain("Mode:** implementation");
      expect(markdown).toContain("Reviewer models:** claude=claude-sonnet-4-6");
      expect(markdown).toContain("## Key Findings");
      expect(markdown).toContain("No reviewer issues were recorded.");
      expect(markdown).toContain("### Step 1 - execute:codex");
      expect(markdown).toContain("- **Model:** gpt-5.2-codex");
      expect(markdown).toContain("- **Model:** claude-sonnet-4-6");
      expect(markdown).toContain("```diff");
      expect(markdown).toContain("## Author Follow-Up");
      expect(markdown).toContain(
        "update the `FIXES APPLIED` section and add the relative path of this report to the `PRIOR REPORTS` section in the original review instructions file",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("shows prior validation reports included in reviewer context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-audit-"));

    try {
      const writeResult = await writeSessionLog({
        cwd,
        task: "Validate applied fixes for the implementation review.",
        pipeline: "review:claude > review:codex",
        options: {
          agentModels: {
            claude: "claude-sonnet-4-6",
            codex: "gpt-5.2-codex",
          },
        },
        consensus: {
          aligned: true,
          overallSeverity: "low",
          confidence: 0.95,
          blockers: [],
          recommendation: "proceed",
          summary: "Fix validation passed.",
        },
        steps: [
          makeReviewStep({
            index: 1,
            agent: "claude",
            includedFiles: [
              { path: "docs/reviews/weather-review.md", estimatedTokens: 120 },
              { path: ".mrev/reports/pass-1.md", estimatedTokens: 80 },
              { path: ".mrev/reports/pass-2.md", estimatedTokens: 90 },
            ],
          }),
          makeReviewStep({
            index: 2,
            agent: "codex",
            includedFiles: [
              { path: "docs/reviews/weather-review.md", estimatedTokens: 120 },
              { path: ".mrev/reports/pass-1.md", estimatedTokens: 80 },
              { path: ".mrev/reports/pass-2.md", estimatedTokens: 90 },
            ],
          }),
        ],
      });

      const markdown = await readFile(writeResult.reportPath, "utf8");
      expect(markdown).toContain("File:** docs/reviews/weather-review.md");
      expect(markdown).toContain("Mode:** implementation");
      expect(markdown).toContain("Validation history:** 2 prior report(s) included");
      expect(markdown).toContain("## Validation Context");
      expect(markdown).toContain("- .mrev/reports/pass-1.md");
      expect(markdown).toContain("- .mrev/reports/pass-2.md");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("uses investigation-specific follow-up wording when the artifact is an investigation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-audit-"));

    try {
      const writeResult = await writeSessionLog({
        cwd,
        task: 'Review the investigation in "docs/investigations/feature-x.md". The investigation was authored by claude. Return structured review JSON only.',
        pipeline: "review:codex | review:gemini",
        options: {
          agentModels: {
            codex: "gpt-5.4",
            gemini: "gemini-3.1-pro-preview",
          },
        },
        consensus: {
          aligned: false,
          overallSeverity: "high",
          confidence: 0,
          blockers: [],
          recommendation: "escalate_to_human",
          summary: "Investigation needs revision.",
        },
        steps: [
          makeReviewStep({
            index: 1,
            agent: "codex",
            includedFiles: [
              { path: "docs/investigations/feature-x.md", estimatedTokens: 120 },
              { path: "AGENTS.md", estimatedTokens: 40 },
            ],
          }),
        ],
      });

      const markdown = await readFile(writeResult.reportPath, "utf8");
      expect(markdown).toContain("File:** docs/investigations/feature-x.md");
      expect(markdown).toContain("Mode:** investigation");
      expect(markdown).toContain(
        "update the `FIXES APPLIED` section and add the relative path of this report to the `PRIOR REPORTS` section in the original investigation file",
      );
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function makeExecuteStep(): ExecutionStepResult {
  return {
    stepIndex: 1,
    role: "execute",
    agent: "codex",
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
      includedFiles: [{ path: "review-instructions.md", estimatedTokens: 50 }],
    },
    command: ["codex"],
    prompt: "prompt",
    stdout: "",
    stderr: "",
    normalizedOutput: "{\"unified_diff\":\"diff --git a/a.ts b/a.ts\"}",
    parsedOutput: {
      unified_diff: "diff --git a/a.ts b/a.ts",
      files_affected: ["a.ts"],
      shell_commands: [],
      edge_cases: [],
      confidence: 1,
    },
    error: null,
  };
}

function makeReviewStep(input?: {
  index?: number | undefined;
  agent?: "claude" | "codex" | "gemini" | undefined;
  includedFiles?: Array<{ path: string; estimatedTokens: number }> | undefined;
}): ExecutionStepResult {
  return {
    stepIndex: input?.index ?? 2,
    role: "review",
    agent: input?.agent ?? "claude",
    status: "completed",
    startedAt: new Date(100).toISOString(),
    completedAt: new Date(200).toISOString(),
    durationMs: 100,
    context: {
      summary: "",
      sources: [],
      techStack: [],
      tokenBudget: 100,
      warnings: [],
      truncated: false,
      includedFiles: input?.includedFiles ?? [],
    },
    command: [input?.agent ?? "claude"],
    prompt: "prompt",
    stdout: "",
    stderr: "",
    normalizedOutput: "{\"verdict\":\"approve\"}",
    parsedOutput: {
      verdict: "approve",
      severity: "low",
      issues: [],
      security_flags: [],
      cross_file_concerns: [],
      agrees_with_prior_reviews: null,
      prior_review_disagreements: [],
      suggested_revision: null,
    },
    error: null,
  };
}

