import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeReviewFile,
  buildInvestigationReviewTask,
  buildImplementationReviewTask,
  buildParallelReviewPipeline,
  buildPlanReviewTask,
  coerceAutoReviewWorkflowOptions,
  coerceReviewWorkflowOptions,
  detectAuthoringAgent,
  detectReferencedReviewReports,
  detectReviewWorkflowMode,
  detectValidationPass,
  formatReviewArtifactLine,
  prepareImplementationReviewWorkflow,
  prepareInvestigationReviewWorkflow,
  preparePlanReviewWorkflow,
  resolveReviewAgentFiles,
  resolveReviewWorkflowContext,
  resolveReviewWorkflowFiles,
  resolveReviewers,
} from "../../src/cli/commands/review.js";

describe("review workflows", () => {
  it("uses all reviewer providers by default", () => {
    expect(resolveReviewers()).toEqual(["claude", "codex", "gemini"]);
  });

  it("uses all reviewer providers by default even when reviewer models are not provided", () => {
    expect(resolveReviewers()).toEqual(["claude", "codex", "gemini"]);
  });

  it("keeps explicit reviewers as selected", () => {
    expect(resolveReviewers(["claude", "gemini"])).toEqual(["claude", "gemini"]);
  });

  it("requires explicit models for direct review runs", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(
        join(cwd, "review.md"),
        [
          "# Review Instructions",
          "## Changed Files",
          "## Review Checklist",
        ].join("\n"),
        "utf8",
      );

      await expect(
        prepareImplementationReviewWorkflow(cwd, "review.md", {}),
      ).rejects.toThrow("Review runs require explicit reviewer models.");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("uses reviewer model keys when explicit reviewers are omitted", () => {
    expect(
      resolveReviewers(
        undefined,
        {
          claude: "claude-sonnet-4-6",
          gemini: "gemini-3.1-pro-preview",
        },
      ),
    ).toEqual(["claude", "gemini"]);
  });

  it("builds a parallel review pipeline", () => {
    expect(buildParallelReviewPipeline(["claude", "gemini"])).toBe(
      "review:claude | review:gemini",
    );
  });

  it("formats the reviewed file line for run output", () => {
    expect(formatReviewArtifactLine("docs/investigations/feature-x.md")).toBe(
      "File: docs/investigations/feature-x.md",
    );
  });

  it("builds plan review task wording", () => {
    const task = buildPlanReviewTask("docs/PLAN.md", "codex");
    expect(task).toContain('Review the implementation plan in "docs/PLAN.md".');
    expect(task).toContain("The plan was authored by codex.");
    expect(task).toContain("Return structured review JSON only.");
  });

  it("builds plan validation task wording", () => {
    const task = buildPlanReviewTask("docs/PLAN.md", "codex", undefined, true, true);
    expect(task).toContain('Validate the applied fixes in the implementation plan "docs/PLAN.md".');
    expect(task).toContain("One or more prior review reports are also included in context.");
    expect(task).toContain("Start with the FIXES APPLIED section.");
    expect(task).toContain("Only raise new issues when a claimed fix is incomplete");
  });

  it("builds investigation review task wording", () => {
    const task = buildInvestigationReviewTask("docs/INVESTIGATION.md", "codex");
    expect(task).toContain('Review the investigation in "docs/INVESTIGATION.md".');
    expect(task).toContain("The investigation was authored by codex.");
    expect(task).toContain("captures constraints");
    expect(task).toContain("Return structured review JSON only.");
  });

  it("builds investigation validation task wording", () => {
    const task = buildInvestigationReviewTask(
      "docs/INVESTIGATION.md",
      "codex",
      undefined,
      true,
      true,
    );
    expect(task).toContain('Validate the applied fixes in the investigation "docs/INVESTIGATION.md".');
    expect(task).toContain("One or more prior review reports are also included in context.");
    expect(task).toContain("Start with the FIXES APPLIED section.");
    expect(task).toContain("Only raise new issues when a claimed fix is incomplete");
  });

  it("builds implementation review task wording", () => {
    const task = buildImplementationReviewTask("review-instructions.md", "claude");
    expect(task).toContain(
      'Review the implementation using the review instructions file "review-instructions.md".',
    );
    expect(task).toContain("The implementation was authored by claude.");
    expect(task).toContain("Use the instructions file plus the current staged diff when available.");
    expect(task).toContain("If the review instructions file contains a FIXES APPLIED section");
  });

  it("builds review tasks without author metadata when no author is known", () => {
    expect(buildPlanReviewTask("docs/PLAN.md")).not.toContain("authored by");
    expect(buildInvestigationReviewTask("docs/INVESTIGATION.md")).not.toContain("authored by");
    expect(buildImplementationReviewTask("review-instructions.md")).not.toContain("authored by");
  });

  it("mentions prior report context in implementation review tasks when present", () => {
    const task = buildImplementationReviewTask(
      "review-instructions.md",
      "claude",
      undefined,
      true,
      true,
    );

    expect(task).toContain("One or more prior review reports are also included in context.");
    expect(task).toContain("preserve reviewer context across passes");
  });

  it("builds implementation validation task wording", () => {
    const task = buildImplementationReviewTask(
      "review-instructions.md",
      "claude",
      undefined,
      true,
      true,
    );
    expect(task).toContain(
      'Validate the applied fixes using the review instructions file "review-instructions.md".',
    );
    expect(task).toContain("Start with the FIXES APPLIED section.");
    expect(task).toContain("Only raise new issues when a claimed fix is incomplete");
  });

  it("appends extra instructions to review tasks", () => {
    const task = buildImplementationReviewTask(
      "review-instructions.md",
      undefined,
      "Verify every FIXES APPLIED entry against the actual diff.",
    );

    expect(task).toContain(
      "Additional review instructions: Verify every FIXES APPLIED entry against the actual diff.",
    );
  });

  it("coerces CLI workflow options", () => {
    const options = coerceReviewWorkflowOptions({
      reviewers: ["claude", "codex"],
      reviewerModels: ["claude=claude-sonnet-4-6", "codex=gpt-5.4"],
      instructions: "Focus on regressions first.",
      repoSummary: "TypeScript service",
      techStack: ["TypeScript", "Vitest"],
      dryRun: true,
      files: ["README.md"],
    });

    expect(options).toEqual({
      reviewers: ["claude", "codex"],
      reviewerModels: {
        claude: "claude-sonnet-4-6",
        codex: "gpt-5.4",
      },
      instructions: "Focus on regressions first.",
      repoSummary: "TypeScript service",
      techStack: ["TypeScript", "Vitest"],
      verbose: undefined,
      geminiStrict: undefined,
      dryRun: true,
      extraFiles: ["README.md"],
    });
  });

  it("coerces CLI workflow options without an author", () => {
    const options = coerceReviewWorkflowOptions({
      reviewers: ["claude", "codex"],
    });

    expect(options.reviewers).toEqual(["claude", "codex"]);
  });

  it("coerces auto review options", () => {
    const options = coerceAutoReviewWorkflowOptions({
      mode: "implementation",
      reviewerModels: ["claude=claude-sonnet-4-6", "gemini=gemini-3-flash-preview"],
      instructions: "Validate fixes.",
    });

    expect(options).toEqual({
      reviewers: undefined,
      reviewerModels: {
        claude: "claude-sonnet-4-6",
        gemini: "gemini-3-flash-preview",
      },
      instructions: "Validate fixes.",
      mode: "implementation",
      claudeModel: undefined,
      codexModel: undefined,
      geminiModel: undefined,
      repoSummary: undefined,
      techStack: undefined,
      verbose: undefined,
      geminiStrict: undefined,
      dryRun: undefined,
      extraFiles: undefined,
    });
  });

  it("detects plan review content", () => {
    const mode = detectReviewWorkflowMode(
      "docs/IMPLEMENTATION_PLAN.md",
      [
        "# Implementation Plan",
        "## Phase 1",
        "## Test Matrix",
        "## Pipeline",
      ].join("\n"),
    );

    expect(mode).toBe("plan");
  });

  it("detects investigation review content", () => {
    const mode = detectReviewWorkflowMode(
      "docs/feature-investigation.md",
      [
        "# Investigation",
        "## Problem Statement",
        "## Constraints",
        "## Unknowns",
        "## Candidate Approaches",
      ].join("\n"),
    );

    expect(mode).toBe("investigation");
  });

  it("detects implementation review content", () => {
    const mode = detectReviewWorkflowMode(
      "docs/reviews/feature-review.md",
      [
        "# Review Instructions",
        "## Changed Files",
        "## Review Checklist",
        "## Testing Steps",
      ].join("\n"),
    );

    expect(mode).toBe("implementation");
  });

  it("detects validation passes from a populated FIXES APPLIED section", () => {
    const detected = detectValidationPass(
      [
        "## FIXES APPLIED",
        "",
        "#### Fix 1: Null check added",
        "- **Reviewer**: codex",
        "- **Status**: fixed",
      ].join("\n"),
    );

    expect(detected).toBe(true);
  });

  it("does not treat an empty FIXES APPLIED section as a validation pass", () => {
    const detected = detectValidationPass(
      [
        "## FIXES APPLIED",
        "",
        "This section is intentionally empty on the first pass.",
        "",
        "## Testing Steps",
      ].join("\n"),
    );

    expect(detected).toBe(false);
  });

  it("does not treat research-only placeholder text as a validation pass", () => {
    const detected = detectValidationPass(
      [
        "## FIXES APPLIED",
        "",
        "None. This is a research/investigation report only.",
      ].join("\n"),
    );

    expect(detected).toBe(false);
  });

  it("detects authoring agent from content", () => {
    const author = detectAuthoringAgent(
      [
        "## Change Summary",
        "- Authoring model: gemini",
      ].join("\n"),
    );

    expect(author).toBe("gemini");
  });

  it("detects referenced prior review reports from review instructions content", () => {
    const reports = detectReferencedReviewReports(
      [
        "## FIXES APPLIED",
        '- Prior report: ".mrev/reports/2026-03-08-foo.md"',
        "- Windows path: C:\\repo\\.mrev\\reports\\2026-03-08-bar.md",
      ].join("\n"),
    );

    expect(reports).toEqual([
      ".mrev/reports/2026-03-08-foo.md",
      "C:\\repo\\.mrev\\reports\\2026-03-08-bar.md",
    ]);
  });

  it("keeps shared workflow files separate from repo instruction files", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(join(cwd, "CLAUDE.md"), "claude repo instructions", "utf8");
      await writeFile(join(cwd, "AGENTS.md"), "codex repo instructions", "utf8");

      const files = await resolveReviewWorkflowFiles(cwd, "docs/review.md", ["README.md"]);

      expect(files).toEqual(["docs/review.md", "README.md"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("assigns provider-specific repo instruction files to each reviewer", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(join(cwd, "CLAUDE.md"), "claude repo instructions", "utf8");
      await writeFile(join(cwd, "AGENTS.md"), "codex repo instructions", "utf8");
      await writeFile(join(cwd, "GEMINI.md"), "gemini repo instructions", "utf8");

      const files = await resolveReviewAgentFiles(cwd, ["claude", "codex", "gemini"]);

      expect(files).toEqual({
        claude: ["CLAUDE.md"],
        codex: ["AGENTS.md"],
        gemini: ["GEMINI.md"],
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prepares a plan review workflow with reviewer pipeline and model overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await mkdir(join(cwd, "docs"), { recursive: true });
      await writeFile(join(cwd, "AGENTS.md"), "repo instructions", "utf8");
      await writeFile(
        join(cwd, "docs", "PLAN.md"),
        [
          "# Implementation Plan",
          "## Goals",
          "## Risks",
          "## Validation",
        ].join("\n"),
        "utf8",
      );

      const prepared = await preparePlanReviewWorkflow(cwd, "docs/PLAN.md", {
        reviewerModels: {
          codex: "gpt-5.2-codex",
          gemini: "gemini-3.1-pro-preview",
        },
        repoSummary: "TypeScript service",
      });

      expect(prepared).toMatchObject({
        kind: "plan",
        pipeline: "review:codex | review:gemini",
        agentFiles: {
          codex: ["AGENTS.md"],
          gemini: ["AGENTS.md"],
        },
        reviewers: ["codex", "gemini"],
        validationPass: false,
        hasPriorReportContext: false,
        missingReferencedReports: [],
        modelOverrides: {
          codexModel: "gpt-5.2-codex",
          geminiModel: "gemini-3.1-pro-preview",
        },
      });
      expect(prepared.task).toContain('Review the implementation plan in "docs/PLAN.md".');
      expect(prepared.files).toEqual(["docs/PLAN.md"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prepares an investigation review workflow with reviewer pipeline and model overrides", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(join(cwd, "AGENTS.md"), "repo instructions", "utf8");
      await writeFile(
        join(cwd, "docs-investigation.md"),
        [
          "# Investigation",
          "## Problem Statement",
          "## Constraints",
          "## Unknowns",
        ].join("\n"),
        "utf8",
      );

      const prepared = await prepareInvestigationReviewWorkflow(cwd, "docs-investigation.md", {
        reviewerModels: {
          codex: "gpt-5.2-codex",
          gemini: "gemini-3.1-pro-preview",
        },
      });

      expect(prepared).toMatchObject({
        kind: "investigation",
        pipeline: "review:codex | review:gemini",
        agentFiles: {
          codex: ["AGENTS.md"],
          gemini: ["AGENTS.md"],
        },
        reviewers: ["codex", "gemini"],
        validationPass: false,
        hasPriorReportContext: false,
        missingReferencedReports: [],
        modelOverrides: {
          codexModel: "gpt-5.2-codex",
          geminiModel: "gemini-3.1-pro-preview",
        },
      });
      expect(prepared.task).toContain('Review the investigation in "docs-investigation.md".');
      expect(prepared.files).toEqual(["docs-investigation.md"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps investigation first-pass reviews broad when FIXES APPLIED only contains research placeholder text", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(join(cwd, "AGENTS.md"), "repo instructions", "utf8");
      await writeFile(
        join(cwd, "docs-investigation.md"),
        [
          "# Investigation",
          "## Problem Statement",
          "## Constraints",
          "## FIXES APPLIED",
          "",
          "None. This is a research/investigation report only.",
        ].join("\n"),
        "utf8",
      );

      const prepared = await prepareInvestigationReviewWorkflow(cwd, "docs-investigation.md", {
        reviewerModels: {
          codex: "gpt-5.2-codex",
        },
      });

      expect(prepared.validationPass).toBe(false);
      expect(prepared.agentFiles).toEqual({
        codex: ["AGENTS.md"],
      });
      expect(prepared.task).toContain('Review the investigation in "docs-investigation.md".');
      expect(prepared.task).not.toContain("Validate the applied fixes in the investigation");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prepares a plan validation workflow with prior report context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "plan.md"),
        [
          "# Implementation Plan",
          "Author: claude",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous report: .mrev/reports/plan-pass-1.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "plan-pass-1.md"),
        "# First plan pass report",
        "utf8",
      );

      const prepared = await preparePlanReviewWorkflow(cwd, "docs/plan.md", {
        reviewerModels: {
          codex: "gpt-5.2-codex",
          gemini: "gemini-3.1-pro-preview",
        },
      });

      expect(prepared.validationPass).toBe(true);
      expect(prepared.hasPriorReportContext).toBe(true);
      expect(prepared.agentFiles).toEqual({});
      expect(prepared.files).toEqual([
        "docs/plan.md",
        ".mrev/reports/plan-pass-1.md",
      ]);
      expect(prepared.task).toContain("Validate the applied fixes in the implementation plan");
      expect(prepared.task).toContain("Start with the FIXES APPLIED section.");
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prepares an investigation validation workflow with prior report context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "investigation.md"),
        [
          "# Investigation",
          "Author: claude",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous report: .mrev/reports/investigation-pass-1.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "investigation-pass-1.md"),
        "# First investigation pass report",
        "utf8",
      );

      const prepared = await prepareInvestigationReviewWorkflow(cwd, "investigation.md", {
        reviewerModels: {
          codex: "gpt-5.2-codex",
          gemini: "gemini-3.1-pro-preview",
        },
      });

      expect(prepared.validationPass).toBe(true);
      expect(prepared.hasPriorReportContext).toBe(true);
      expect(prepared.agentFiles).toEqual({});
      expect(prepared.files).toEqual([
        "investigation.md",
        ".mrev/reports/investigation-pass-1.md",
      ]);
      expect(prepared.task).toContain("Validate the applied fixes in the investigation");
      expect(prepared.task).toContain("Start with the FIXES APPLIED section.");
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("dedupes explicit files against auto-included repo instructions", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));

    try {
      await writeFile(join(cwd, "CLAUDE.md"), "claude repo instructions", "utf8");

      const files = await resolveReviewWorkflowFiles(cwd, "docs/review.md", [
        "CLAUDE.md",
        "README.md",
      ]);

      expect(files).toEqual(["docs/review.md", "CLAUDE.md", "README.md"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes referenced prior review reports during validation passes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous report: .mrev/reports/2026-03-08-first-pass.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "2026-03-08-first-pass.md"),
        "# First pass report",
        "utf8",
      );

      const files = await resolveReviewWorkflowFiles(cwd, "docs/review.md", undefined, {
        validationPass: true,
      });

      expect(files).toEqual([
        "docs/review.md",
        ".mrev/reports/2026-03-08-first-pass.md",
      ]);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("includes all referenced prior review reports during validation passes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous reports:",
          "- .mrev/reports/pass-1.md",
          "- .mrev/reports/pass-2.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "pass-1.md"),
        "# First pass report",
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "pass-2.md"),
        "# Second pass report",
        "utf8",
      );

      const context = await resolveReviewWorkflowContext(
        cwd,
        "docs/review.md",
        undefined,
        true,
      );

      expect(context).toEqual({
        files: [
          "docs/review.md",
          ".mrev/reports/pass-2.md",
          ".mrev/reports/pass-1.md",
        ],
        hasPriorReportContext: true,
        missingReferencedReports: [],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prioritizes the most recent referenced prior review reports first", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "## PRIOR REPORTS",
          "- .mrev/reports/pass-1.md",
          "- .mrev/reports/pass-2.md",
          "- .mrev/reports/pass-3.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(join(cwd, ".mrev", "reports", "pass-1.md"), "# First", "utf8");
      await writeFile(join(cwd, ".mrev", "reports", "pass-2.md"), "# Second", "utf8");
      await writeFile(join(cwd, ".mrev", "reports", "pass-3.md"), "# Third", "utf8");

      const context = await resolveReviewWorkflowContext(
        cwd,
        "docs/review.md",
        undefined,
        true,
      );

      expect(context.files).toEqual([
        "docs/review.md",
        ".mrev/reports/pass-3.md",
        ".mrev/reports/pass-2.md",
        ".mrev/reports/pass-1.md",
      ]);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reports missing referenced prior review reports during validation passes", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous report: .mrev/reports/missing-report.md",
        ].join("\n"),
        "utf8",
      );

      const context = await resolveReviewWorkflowContext(
        cwd,
        "docs/review.md",
        undefined,
        true,
      );

      expect(context).toEqual({
        files: ["docs/review.md"],
        hasPriorReportContext: false,
        missingReferencedReports: [".mrev/reports/missing-report.md"],
      });
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("prepares an implementation validation workflow with prior report context", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      await mkdir(join(cwd, "docs"), { recursive: true });
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "Author: claude",
          "## Changed Files",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous report: .mrev/reports/first-pass.md",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "first-pass.md"),
        "# First pass report",
        "utf8",
      );
      await writeFile(
        join(cwd, ".mrev", "reports", "second-pass.md"),
        "# Second pass report",
        "utf8",
      );
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "Author: claude",
          "## Changed Files",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
          "",
          "Previous reports:",
          "- .mrev/reports/first-pass.md",
          "- .mrev/reports/second-pass.md",
        ].join("\n"),
        "utf8",
      );
      const prepared = await prepareImplementationReviewWorkflow(cwd, "docs/review.md", {
        reviewers: ["claude", "codex"],
        reviewerModels: {
          claude: "claude-sonnet-4-6",
          codex: "gpt-5.2-codex",
        },
      });

      expect(prepared).toMatchObject({
        kind: "implementation",
        pipeline: "review:claude | review:codex",
        agentFiles: {},
        reviewers: ["claude", "codex"],
        validationPass: true,
        hasPriorReportContext: true,
        missingReferencedReports: [],
        modelOverrides: {
          claudeModel: "claude-sonnet-4-6",
          codexModel: "gpt-5.2-codex",
        },
      });
      expect(prepared.task).toContain("One or more prior review reports are also included in context.");
      expect(prepared.task).toContain("Treat this as a validation pass");
      expect(prepared.files).toEqual([
        "docs/review.md",
        ".mrev/reports/second-pass.md",
        ".mrev/reports/first-pass.md",
      ]);
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("analyzes review files for mode, validation pass, and author", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-review-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      const filePath = join(cwd, "review.md");
      await writeFile(
        filePath,
        [
          "# Review Instructions",
          "Author: claude",
          "## Changed Files",
          "## FIXES APPLIED",
          "#### Fix 1: Applied",
        ].join("\n"),
        "utf8",
      );

      const analysis = await analyzeReviewFile("review.md");
      expect(analysis).toEqual({
        mode: "implementation",
        validationPass: true,
        detectedAuthor: "claude",
      });
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

