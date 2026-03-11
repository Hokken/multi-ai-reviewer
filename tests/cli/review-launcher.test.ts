import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildReviewLauncherConfirmationLines,
  buildInteractiveReviewCommandPreview,
  countRenderedPromptLines,
  listReviewLauncherFiles,
  resolveReviewLauncherFilesFolder,
  resolveReviewLauncherProfiles,
} from "../../src/cli/review-launcher.js";

describe("interactive review launcher", () => {
  it("falls back to the built-in review profile", () => {
    expect(resolveReviewLauncherProfiles({ profiles: {} })).toEqual([
      {
        key: "review",
        label: "review (Review workflow)",
        description: "Review workflow",
        mode: undefined,
        defaultReviewers: undefined,
      },
    ]);
  });

  it("preserves an explicit workflow mode from profile config", () => {
    expect(resolveReviewLauncherProfiles({
      profiles: {
        investigation: {
          description: "Review an investigation artifact.",
          mode: "investigation",
          default_reviewers: ["codex", "gemini"],
        },
      },
    })).toEqual([
      {
        key: "investigation",
        label: "investigation (Review an investigation artifact.)",
        description: "Review an investigation artifact.",
        mode: "investigation",
        defaultReviewers: ["codex", "gemini"],
      },
    ]);
  });

  it("resolves mode-specific launcher folders with legacy fallback", () => {
    expect(resolveReviewLauncherFilesFolder({
      investigations_folder: "docs/investigations",
      plans_folder: "docs/plans",
      reviews_folder: "docs/reviews",
      profiles: {},
    }, "investigation")).toBe("docs/investigations");

    expect(resolveReviewLauncherFilesFolder({
      plans_folder: "docs/plans",
      files_folder: "docs/legacy",
      profiles: {},
    }, "plan")).toBe("docs/plans");

    expect(resolveReviewLauncherFilesFolder({
      files_folder: "docs/legacy",
      profiles: {},
    }, "implementation")).toBe("docs/legacy");
  });

  it("builds a review command preview from interactive selections", () => {
    const command = buildInteractiveReviewCommandPreview({
      file: "docs/reviews/auth-review.md",
      reviewers: ["codex", "gemini"],
      reviewerModels: {
        codex: "gpt-5.4",
        gemini: "gemini-3-flash-preview",
      },
      options: {
        dryRun: true,
        instructions: "Focus on regressions.",
      },
    });

    expect(command).toBe(
      'mrev review docs/reviews/auth-review.md --reviewers codex gemini --reviewer-models codex=gpt-5.4 gemini=gemini-3-flash-preview --instructions "Focus on regressions." --dry-run',
    );
  });

  it("includes the selected workflow mode in the command preview when forced", () => {
    const command = buildInteractiveReviewCommandPreview({
      file: "docs/investigations/auth-investigation.md",
      reviewers: ["codex"],
      reviewerModels: {
        codex: "gpt-5.2-codex",
      },
      options: {
        mode: "investigation",
      },
    });

    expect(command).toBe(
      "mrev review docs/investigations/auth-investigation.md --reviewers codex --reviewer-models codex=gpt-5.2-codex --mode investigation",
    );
  });

  it("builds a command preview for the plain gpt-5.2 codex model", () => {
    const command = buildInteractiveReviewCommandPreview({
      file: "docs/reviews/auth-review.md",
      reviewers: ["codex"],
      reviewerModels: {
        codex: "gpt-5.2",
      },
      options: {},
    });

    expect(command).toBe(
      "mrev review docs/reviews/auth-review.md --reviewers codex --reviewer-models codex=gpt-5.2",
    );
  });

  it("builds validation-pass confirmation lines with prior report context", () => {
    const lines = buildReviewLauncherConfirmationLines({
      profileLabel: "review",
      reviewerModels: ["claude-sonnet-4-6", "gpt-5.2-codex"],
      reviewFile: "docs/reviews/weather-review.md",
      detectedMode: "implementation",
      validationPass: true,
      detectedAuthor: "claude",
      preparedWorkflow: {
        kind: "implementation",
        task: "task",
        pipeline: "review:claude | review:codex",
        files: [
          "docs/reviews/weather-review.md",
          ".mrev/reports/pass-1.md",
          ".mrev/reports/pass-2.md",
        ],
        agentFiles: {},
        reviewers: ["claude", "codex"],
        validationPass: true,
        hasPriorReportContext: true,
        missingReferencedReports: [".mrev/reports/missing.md"],
        modelOverrides: {
          claudeModel: "claude-sonnet-4-6",
          codexModel: "gpt-5.2-codex",
        },
      },
      commandPreview: "mrev review docs/reviews/weather-review.md ...",
    });

    expect(lines).toContain("Workflow: review");
    expect(lines).not.toContain("Author: unknown");
    expect(lines).toContain("Prior reports: 2 included");
    expect(lines).toContain("Missing prior reports: .mrev/reports/missing.md");
  });

  it("counts rendered prompt lines without overcounting the trailing newline", () => {
    expect(countRenderedPromptLines("")).toBe(0);
    expect(countRenderedPromptLines("Select workflow\n", 80)).toBe(1);
    expect(countRenderedPromptLines("Title\nHelp\n\n> First option\n", 80)).toBe(4);
    expect(countRenderedPromptLines("Title\nHelp\n\n> First option", 80)).toBe(4);
  });

  it("counts soft-wrapped prompt rows using the terminal width", () => {
    expect(countRenderedPromptLines("> 1234567890\n", 5)).toBe(3);
    expect(countRenderedPromptLines("Title\n> 1234567890\n", 5)).toBe(4);
    expect(countRenderedPromptLines("\n> 1234\n", 4)).toBe(3);
  });

  it("lists review files from the configured folder and extracts headings", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-launcher-"));

    try {
      await mkdir(join(cwd, "docs", "reviews", "auth"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "reviews", "auth", "review.md"),
        [
          "# Auth Review",
          "",
          "Check the login flow.",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, "docs", "reviews", "plan.md"),
        [
          "## Implementation Plan",
          "",
          "Phase 1",
        ].join("\n"),
        "utf8",
      );

      const files = await listReviewLauncherFiles(cwd, "docs/reviews");
      expect(files).toEqual([
        {
          path: "docs/reviews/auth/review.md",
          displayPath: "auth/review.md",
          heading: "Auth Review",
        },
        {
          path: "docs/reviews/plan.md",
          displayPath: "plan.md",
          heading: "Implementation Plan",
        },
      ]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
