import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runRunCommand } from "../../src/cli/commands/run.js";
import { saveProjectConfig } from "../../src/config/project.js";

describe("runRunCommand", () => {
  const stdoutSpy = vi.spyOn(process.stdout, "write");
  const stderrSpy = vi.spyOn(process.stderr, "write");
  const originalConfigEnv = process.env.MREV_CONFIG;
  const originalLegacyConfigEnv = process.env.AI_CONDUCTOR_CONFIG;

  beforeEach(() => {
    stdoutSpy.mockImplementation(() => true);
    stderrSpy.mockImplementation(() => true);
  });

  afterEach(() => {
    stdoutSpy.mockReset();
    stderrSpy.mockReset();
    restoreConfigEnv(originalConfigEnv, originalLegacyConfigEnv);
  });

  it("prints planned prompts in dry-run mode", async () => {
    const exitCode = await runRunCommand({
      task: "Review the auth flow",
      pipeline: "architect:claude > execute:codex > review:gemini",
      dryRun: true,
      repoSummary: "TypeScript service",
      techStack: ["TypeScript", "Vitest"],
    });

    const written = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");

    expect(exitCode).toBe(0);
    expect(written).toContain("--- STEP 1: architect:claude ---");
    expect(written).toContain("--- STEP 2: execute:codex ---");
    expect(written).toContain("--- STEP 3: review:gemini ---");
    expect(written).toContain("=== OUTPUT CONTRACT ===");
  });

  it("rejects missing task input", async () => {
    const exitCode = await runRunCommand({
      pipeline: "execute:codex",
    });

    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join("");

    expect(exitCode).toBe(1);
    expect(written).toContain("A task is required");
  });

  it("uses default pipeline and prompt overrides from project config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-run-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(cwd);
      process.env.MREV_CONFIG = join(cwd, ".mrev", "config.yaml");
      await saveProjectConfig(cwd, {
        default_pipeline: "architect:claude",
        presets: {},
        agent_models: {},
        prompts: {
          architect: "Focus on configuration hygiene.",
        },
      });

      const exitCode = await runRunCommand({
        task: "Assess configuration.",
        dryRun: true,
      });

      const written = stdoutSpy.mock.calls.map((call) => String(call[0])).join("");

      expect(exitCode).toBe(0);
      expect(written).toContain("--- STEP 1: architect:claude ---");
      expect(written).toContain("Focus on configuration hygiene.");
    } finally {
      process.chdir(originalCwd);
      await rm(cwd, { recursive: true, force: true });
    }
  });
});

function restoreConfigEnv(
  value: string | undefined,
  legacyValue: string | undefined,
): void {
  if (value === undefined) {
    delete process.env.MREV_CONFIG;
  } else {
    process.env.MREV_CONFIG = value;
  }

  if (legacyValue === undefined) {
    delete process.env.AI_CONDUCTOR_CONFIG;
  } else {
    process.env.AI_CONDUCTOR_CONFIG = legacyValue;
  }
}

