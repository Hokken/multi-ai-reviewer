import { describe, expect, it } from "vitest";

import {
  createProgressReporter,
  formatActiveAgentModels,
  formatCompactTask,
  formatStepResult,
} from "../../src/cli/display.js";
import type {
  ExecutionStepResult,
  ParsedPipeline,
  PipelineGroup,
  PipelineStep,
} from "../../src/types/index.js";

describe("createProgressReporter", () => {
  it("prints readable progress updates in non-interactive mode", () => {
    const writes: string[] = [];
    const writer = {
      isTTY: false,
      write(chunk: string) {
        writes.push(chunk);
        return true;
      },
    };

    const reporter = createProgressReporter({ writer, interactive: false });
    const step: PipelineStep = {
      role: "execute",
      agent: "codex",
      raw: "execute:codex",
    };
    const group: PipelineGroup = {
      index: 0,
      steps: [step],
    };
    const pipeline: ParsedPipeline = {
      raw: "execute:codex",
      groups: [group],
    };
    const result: ExecutionStepResult = {
      stepIndex: 1,
      role: "execute",
      agent: "codex",
      status: "completed",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1200).toISOString(),
      durationMs: 1200,
      context: {
        summary: "",
        sources: [],
        techStack: [],
        tokenBudget: 0,
        warnings: [],
        truncated: false,
        includedFiles: [],
      },
      command: ["codex"],
      prompt: "prompt",
      stdout: "",
      stderr: "",
      normalizedOutput: "{}",
      parsedOutput: null,
      error: null,
    };

    reporter.startRun({ pipeline });
    reporter.startGroup({ group, totalGroups: 1 });
    reporter.startStep({ stepIndex: 1, totalSteps: 1, step });
    reporter.completeStep({ result, totalSteps: 1 });
    reporter.fail("boom");
    reporter.stop();

    const output = writes.join("");
    expect(output).toContain("Starting run: 1 step(s) across 1 group(s).");
    expect(output).toContain("Running: execute:codex");
    expect(output).toContain("Running [1/1] execute:codex...");
    expect(output).toContain("Finished execute:codex -> completed (1.2s)");
    expect(output).toContain("Run failed: boom");
  });

  it("formats review output as markdown-like text", () => {
    const result: ExecutionStepResult = {
      stepIndex: 1,
      role: "review",
      agent: "gemini",
      status: "completed",
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1000).toISOString(),
      durationMs: 1000,
      context: {
        summary: "",
        sources: [],
        techStack: [],
        tokenBudget: 0,
        warnings: [],
        truncated: false,
        includedFiles: [],
      },
      command: ["gemini"],
      prompt: "prompt",
      stdout: "",
      stderr: "",
      normalizedOutput: "",
      parsedOutput: {
        verdict: "revise",
        severity: "medium",
        issues: [
          {
            file: "src/cli/commands/run.ts",
            line: 42,
            description: "Conflicting flag precedence is implicit.",
            severity: "medium",
            suggestion: "Reject conflicting flags explicitly.",
          },
        ],
        security_flags: ["Dangerous mode is not a true sandbox."],
        cross_file_concerns: [],
        agrees_with_prior_reviews: null,
        prior_review_disagreements: [],
        suggested_revision: "Tighten validation.",
      },
      error: null,
    };

    const output = formatStepResult(result);
    expect(output).toContain("### Review");
    expect(output).toContain("- **Verdict:** revise");
    expect(output).toContain("#### Issues");
    expect(output).toContain("- **[medium]** src/cli/commands/run.ts:42 Conflicting flag precedence is implicit.");
    expect(output).toContain("  - Suggestion: Reject conflicting flags explicitly.");
    expect(output).toContain("#### Security flags");
    expect(output).toContain("- **Suggested revision:** Tighten validation.");
  });

  it("compacts multiline tasks for list output", () => {
    const output = formatCompactTask("Review this repo.\nLook for auth bugs.\nReturn only summary.", 32);
    expect(output).toBe("Review this repo. Look for au...");
  });

  it("formats only models for agents present in the pipeline", () => {
    const pipeline: ParsedPipeline = {
      raw: "review:claude | review:codex",
      groups: [
        {
          index: 0,
          steps: [
            {
              role: "review",
              agent: "claude",
              raw: "review:claude",
            },
            {
              role: "review",
              agent: "codex",
              raw: "review:codex",
            },
          ],
        },
      ],
    };

    const output = formatActiveAgentModels(pipeline, {
      claude: "claude-sonnet-4-6",
      codex: "gpt-5.2-codex",
      gemini: "gemini-3-pro-preview",
    });

    expect(output).toBe("Agent models: claude=claude-sonnet-4-6, codex=gpt-5.2-codex");
  });
});
