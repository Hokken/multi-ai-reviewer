import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readContextFiles } from "../../src/context/files.js";

describe("readContextFiles", () => {
  it("keeps primary review artifacts intact", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-context-files-"));

    try {
      await mkdir(join(cwd, "docs"), { recursive: true });
      await writeFile(
        join(cwd, "docs", "review.md"),
        [
          "# Review Instructions",
          "## Changed Files",
          "- src/a.ts",
          "## Review Checklist",
          "- verify tests",
        ].join("\n"),
        "utf8",
      );

      const fragments = await readContextFiles(cwd, ["docs/review.md"]);

      expect(fragments[0]?.content).toContain("## Changed Files");
      expect(fragments[0]?.content).toContain("## Review Checklist");
      expect(fragments[0]?.content).not.toContain("omitted to reduce repeated reviewer context");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("condenses prior review reports to findings-oriented sections", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-context-files-"));

    try {
      await mkdir(join(cwd, ".mrev", "reports"), { recursive: true });
      await writeFile(
        join(cwd, ".mrev", "reports", "pass-1.md"),
        [
          "# Multi AI Reviewer Report",
          "",
          "## Review Summary",
          "- Issues found: 2",
          "",
          "## Key Findings",
          "- [high] src/a.ts: regression risk",
          "",
          "## Steps",
          "Very long per-step output that should not be repeated.",
          "",
          "## Diffs",
          "Very long diff output that should not be repeated.",
        ].join("\n"),
        "utf8",
      );

      const fragments = await readContextFiles(cwd, [".mrev/reports/pass-1.md"]);

      expect(fragments[0]?.content).toContain("## Review Summary");
      expect(fragments[0]?.content).toContain("## Key Findings");
      expect(fragments[0]?.content).not.toContain("## Steps");
      expect(fragments[0]?.content).not.toContain("## Diffs");
      expect(fragments[0]?.content).toContain("Detailed per-step outputs and diffs omitted");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("keeps repo instruction files intact", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-context-files-"));

    try {
      await writeFile(
        join(cwd, "AGENTS.md"),
        Array.from({ length: 180 }, (_, index) => `Line ${index + 1}: guidance`).join("\n"),
        "utf8",
      );

      const fragments = await readContextFiles(cwd, ["AGENTS.md"]);

      expect(fragments[0]?.content).toContain("Line 1: guidance");
      expect(fragments[0]?.content).toContain("Line 180: guidance");
      expect(fragments[0]?.content).not.toContain("truncated to reduce repeated reviewer context");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
