import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runPresetDeleteCommand,
  runPresetListCommand,
  runPresetSaveCommand,
  runPresetShowCommand,
} from "../../src/cli/commands/preset.js";

describe("preset commands", () => {
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

  it("saves, lists, shows, and deletes presets", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-preset-"));

    try {
      process.env.MREV_CONFIG = join(cwd, ".mrev", "config.yaml");
      expect(
        await runPresetSaveCommand(
          cwd,
          "quick",
          "execute:codex",
          "Fast path",
        ),
      ).toBe(0);

      stdoutSpy.mockClear();
      await runPresetListCommand(cwd);
      expect(stdoutSpy.mock.calls.map((call) => String(call[0])).join("")).toContain("quick");

      stdoutSpy.mockClear();
      await runPresetShowCommand(cwd, "quick");
      expect(stdoutSpy.mock.calls.map((call) => String(call[0])).join("")).toContain("Fast path");

      stdoutSpy.mockClear();
      expect(await runPresetDeleteCommand(cwd, "quick")).toBe(0);
      expect(stdoutSpy.mock.calls.map((call) => String(call[0])).join("")).toContain("Deleted preset");
    } finally {
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

