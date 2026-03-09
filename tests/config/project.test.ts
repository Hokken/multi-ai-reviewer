import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  getRolePrompt,
  loadProjectConfig,
  loadRepoReviewLauncherConfig,
  resolveAgentModels,
  saveRepoReviewLauncherLastUsed,
  saveProjectConfig,
} from "../../src/config/project.js";
import { SYSTEM_PROMPTS } from "../../src/roles/system-prompts.js";

describe("project config", () => {
  it("loads an empty config when none exists", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));
    const originalConfigEnv = process.env.MREV_CONFIG;
    const originalLegacyConfigEnv = process.env.AI_CONDUCTOR_CONFIG;

    try {
      process.env.MREV_CONFIG = join(cwd, ".mrev", "config.yaml");
      const config = await loadProjectConfig(cwd);
      expect(config.presets).toEqual({});
      expect(config.prompts).toEqual({});
    } finally {
      restoreConfigEnv(originalConfigEnv, originalLegacyConfigEnv);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("saves and reloads config content", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));
    const originalConfigEnv = process.env.MREV_CONFIG;
    const originalLegacyConfigEnv = process.env.AI_CONDUCTOR_CONFIG;

    try {
      process.env.MREV_CONFIG = join(cwd, ".mrev", "config.yaml");
      await saveProjectConfig(cwd, {
        default_pipeline: "execute:codex",
        presets: {
          quick: {
            pipeline: "execute:codex",
            description: "Fast path",
          },
        },
        agent_models: {
          claude: "claude-opus-4-6",
          codex: "gpt-5.4",
          gemini: "gemini-3-pro-preview",
        },
        prompts: {
          review: "Be strict.",
        },
      });

      const config = await loadProjectConfig(cwd);
      expect(config.default_pipeline).toBe("execute:codex");
      expect(config.presets.quick?.description).toBe("Fast path");
      expect(config.agent_models.claude).toBe("claude-opus-4-6");
      expect(config.agent_models.codex).toBe("gpt-5.4");
      expect(config.agent_models.gemini).toBe("gemini-3-pro-preview");
      expect(config.prompts.review).toBe("Be strict.");
    } finally {
      restoreConfigEnv(originalConfigEnv, originalLegacyConfigEnv);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy config env var", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));
    const originalConfigEnv = process.env.MREV_CONFIG;
    const originalLegacyConfigEnv = process.env.AI_CONDUCTOR_CONFIG;

    try {
      delete process.env.MREV_CONFIG;
      process.env.AI_CONDUCTOR_CONFIG = join(cwd, ".conductor", "config.yaml");
      await mkdir(join(cwd, ".conductor"), { recursive: true });
      await writeFile(
        join(cwd, ".conductor", "config.yaml"),
        ["presets: {}"].join("\n"),
        "utf8",
      );

      const config = await loadProjectConfig(cwd);
      expect(config.presets).toEqual({});
    } finally {
      restoreConfigEnv(originalConfigEnv, originalLegacyConfigEnv);
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("merges configured and explicit agent models", async () => {
    const config = {
      presets: {},
      agent_models: {
        claude: "claude-opus-4-6",
        codex: "gpt-5.4",
      },
      prompts: {},
    };

    expect(resolveAgentModels(config)).toEqual({
      claude: "claude-opus-4-6",
      codex: "gpt-5.4",
      gemini: "gemini-3.1-pro",
    });

    expect(resolveAgentModels(config, {
      codex: "gpt-5.4",
      gemini: "gemini-3.1-pro",
    })).toEqual({
      claude: "claude-opus-4-6",
      codex: "gpt-5.4",
      gemini: "gemini-3.1-pro",
    });
  });

  it("uses configured prompts and falls back to built-in prompts", () => {
    const config = {
      presets: {},
      agent_models: {},
      prompts: {
        review: "Configured review prompt.",
      },
    };

    expect(getRolePrompt(config, "review")).toBe("Configured review prompt.");
    expect(getRolePrompt(config, "architect")).toBe(SYSTEM_PROMPTS.architect);
  });

  it("loads repo-local review launcher settings from the reviewed repo", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));

    try {
      await mkdir(join(cwd, ".mrev"), { recursive: true });
      await writeFile(
        join(cwd, ".mrev", "config.yaml"),
        [
          "review_launcher:",
          "  investigations_folder: docs/investigations",
          "  plans_folder: docs/plans",
          "  reviews_folder: docs/reviews",
          "  profiles:",
          "    investigation:",
          "      description: Investigation review flow",
          "      mode: investigation",
          "      default_reviewers: [codex, gemini]",
          "    review:",
          "      description: Standard review flow",
          "      default_reviewers: [codex, gemini]",
        ].join("\n"),
        "utf8",
      );

      const config = await loadRepoReviewLauncherConfig(cwd);
      expect(config).toEqual({
        investigations_folder: "docs/investigations",
        plans_folder: "docs/plans",
        reviews_folder: "docs/reviews",
        profiles: {
          investigation: {
            description: "Investigation review flow",
            mode: "investigation",
            default_reviewers: ["codex", "gemini"],
          },
          review: {
            description: "Standard review flow",
            default_reviewers: ["codex", "gemini"],
          },
        },
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("falls back to legacy repo-local .conductor/config.yaml", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));

    try {
      await mkdir(join(cwd, ".conductor"), { recursive: true });
      await writeFile(
        join(cwd, ".conductor", "config.yaml"),
        [
          "review_launcher:",
          "  reviews_folder: docs/reviews",
        ].join("\n"),
        "utf8",
      );

      const config = await loadRepoReviewLauncherConfig(cwd);
      expect(config.reviews_folder).toBe("docs/reviews");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("persists repo-local last-used review launcher models", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "conductor-config-"));

    try {
      await mkdir(join(cwd, ".mrev"), { recursive: true });
      await writeFile(
        join(cwd, ".mrev", "config.yaml"),
        [
          "review_launcher:",
          "  reviews_folder: docs/reviews",
          "  profiles:",
          "    review:",
          "      description: Standard review flow",
        ].join("\n"),
        "utf8",
      );

      await saveRepoReviewLauncherLastUsed(cwd, {
        reviewer_models: ["claude-sonnet-4-6", "gpt-5.2-codex"],
      });

      const config = await loadRepoReviewLauncherConfig(cwd);
      expect(config.last_used).toEqual({
        reviewer_models: ["claude-sonnet-4-6", "gpt-5.2-codex"],
      });
      expect(config.reviews_folder).toBe("docs/reviews");
      expect(config.profiles.review?.description).toBe("Standard review flow");
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
    return;
  }

  process.env.AI_CONDUCTOR_CONFIG = legacyValue;
}

