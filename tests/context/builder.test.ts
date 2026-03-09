import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { buildContext } from "../../src/context/builder.js";
import { estimateTokens, truncateContext } from "../../src/context/tokenguard.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureTemplatePath = resolve(__dirname, "../fixtures/repo-template");

describe("buildContext", () => {
  it("includes explicit file content", async () => {
    const repoPath = await createFixtureRepo();

    try {
      const context = await buildContext({
        cwd: repoPath,
        role: "architect",
        files: ["src/service.ts"],
        techStack: ["TypeScript"],
      });

      expect(context.sources).toContain("--files");
      expect(context.summary).toContain("FILE: src\\service.ts");
      expect(context.summary).toContain("export class AlphaService");
      expect(context.includedFiles[0]?.path).toBe("src\\service.ts");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("falls back to staged diff when no explicit context is provided", async () => {
    const repoPath = await createFixtureRepo();

    try {
      const targetFile = join(repoPath, "src/service.ts");
      const original = await readFile(targetFile, "utf8");
      await writeFile(
        targetFile,
        original.replace("hello", "hello staged"),
        "utf8",
      );
      await git(repoPath, ["add", "src/service.ts"]);

      const context = await buildContext({
        cwd: repoPath,
        role: "execute",
      });

      expect(context.sources).toContain("--diff");
      expect(context.warnings.join(" ")).toContain("Falling back to staged diff");
      expect(context.summary).toContain("STAGED DIFF");
      expect(context.summary).toContain("hello staged");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("warns when no context is available", async () => {
    const repoPath = await createFixtureRepo();

    try {
      const context = await buildContext({
        cwd: repoPath,
        role: "review",
      });

      expect(context.warnings.join(" ")).toContain("No context provided");
      expect(context.summary).toContain("No context provided beyond the task description");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });

  it("finds symbol matches in the repository", async () => {
    const repoPath = await createFixtureRepo();

    try {
      const context = await buildContext({
        cwd: repoPath,
        role: "review",
        symbol: "AlphaService",
      });

      expect(context.sources).toContain("--symbol");
      expect(context.summary).toContain("SYMBOL SEARCH: AlphaService");
      expect(context.summary).toContain("AlphaService");
    } finally {
      await rm(repoPath, { recursive: true, force: true });
    }
  });
});

describe("tokenguard", () => {
  it("truncates fragments to fit a budget", () => {
    const result = truncateContext(
      [
        {
          label: "A",
          source: "--files",
          path: "a.ts",
          content: "x".repeat(800),
        },
        {
          label: "B",
          source: "--files",
          path: "b.ts",
          content: "y".repeat(800),
        },
      ],
      100,
    );

    expect(result.truncated).toBe(true);
    expect(estimateTokens(result.summary)).toBeGreaterThan(0);
    expect(result.summary).toContain("truncated");
  });
});

async function createFixtureRepo(): Promise<string> {
  const repoPath = await mkdtemp(join(tmpdir(), "conductor-fixture-"));
  await cp(fixtureTemplatePath, repoPath, { recursive: true });

  await git(repoPath, ["init"]);
  await git(repoPath, ["config", "user.email", "fixture@example.com"]);
  await git(repoPath, ["config", "user.name", "Fixture User"]);
  await git(repoPath, ["add", "."]);
  await git(repoPath, ["commit", "-m", "initial"]);

  return repoPath;
}

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    shell: process.platform === "win32",
  });
}
