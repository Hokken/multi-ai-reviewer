import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { DEFAULT_AGENT_MODELS } from "./agents.js";
import {
  getConfigEnvOverride,
  getPreferredRepoConfigPath,
  resolveRepoConfigPath,
} from "./storage.js";
import { SYSTEM_PROMPTS } from "../roles/system-prompts.js";
import YAML from "yaml";
import { z } from "zod";

import type {
  AgentModelConfig,
  ProjectConfig,
  ReviewLauncherConfig,
  ReviewLauncherLastUsedConfig,
  RoleId,
} from "../types/index.js";

const agentIdSchema = z.enum(["claude", "codex", "gemini"]);
const presetSchema = z.object({
  pipeline: z.string(),
  description: z.string(),
});

const reviewLauncherProfileSchema = z.object({
  description: z.string().optional(),
  mode: z.enum(["investigation", "plan", "implementation"]).optional(),
  default_reviewers: z.array(agentIdSchema).optional(),
});

const reviewLauncherSchema = z.object({
  files_folder: z.string().optional(),
  investigations_folder: z.string().optional(),
  plans_folder: z.string().optional(),
  reviews_folder: z.string().optional(),
  profiles: z.record(z.string(), reviewLauncherProfileSchema).default({}),
  last_used: z.object({
    reviewer_models: z.array(z.string()).optional(),
  }).optional(),
});

const reviewDefaultsSchema = z.object({
  mode: z.enum(["investigation", "plan", "implementation"]).optional(),
  instructions: z.string().optional(),
  repo_summary: z.string().optional(),
  tech_stack: z.array(z.string()).optional(),
  files: z.array(z.string()).optional(),
  verbose: z.boolean().optional(),
  gemini_strict: z.boolean().optional(),
});

const projectConfigSchema = z.object({
  default_pipeline: z.string().optional(),
  presets: z.record(z.string(), presetSchema).default({}),
  agent_models: z
    .object({
      claude: z.string().optional(),
      codex: z.string().optional(),
      gemini: z.string().optional(),
    })
    .default({}),
  prompts: z
    .object({
      architect: z.string().optional(),
      execute: z.string().optional(),
      review: z.string().optional(),
      revise: z.string().optional(),
      summarise: z.string().optional(),
    })
    .default({}),
  review_defaults: reviewDefaultsSchema.optional(),
  review_launcher: reviewLauncherSchema.optional(),
});

export async function loadProjectConfig(cwd: string): Promise<ProjectConfig> {
  const configPath = getProjectConfigPath(cwd);

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = YAML.parse(raw) ?? {};
    const config = projectConfigSchema.parse(parsed);

    return {
      default_pipeline: config.default_pipeline,
      presets: config.presets,
      agent_models: config.agent_models,
      prompts: config.prompts,
      review_defaults: config.review_defaults,
      review_launcher: config.review_launcher,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        presets: {},
        agent_models: {},
        prompts: {},
        review_defaults: undefined,
        review_launcher: undefined,
      };
    }

    if (error instanceof z.ZodError) {
      throw new Error(`Invalid .mrev/config.yaml: ${error.message}`);
    }

    throw error;
  }
}

export async function saveProjectConfig(cwd: string, config: ProjectConfig): Promise<string> {
  const configPath = getProjectConfigWritePath(cwd);
  const conductorDir = dirname(configPath);
  await mkdir(conductorDir, { recursive: true });

  const serialized = YAML.stringify({
    default_pipeline: config.default_pipeline,
    presets: config.presets,
    agent_models: config.agent_models,
    prompts: config.prompts,
    review_defaults: config.review_defaults,
    review_launcher: config.review_launcher,
  });

  await writeFile(configPath, serialized, "utf8");
  return configPath;
}

export function getProjectConfigPath(cwd: string): string {
  const override = getConfigEnvOverride();
  if (override) {
    return override;
  }

  return resolveRepoConfigPath(cwd);
}

function getProjectConfigWritePath(cwd: string): string {
  const override = getConfigEnvOverride();
  if (override) {
    return override;
  }

  return getPreferredRepoConfigPath(cwd);
}

export { loadProjectConfig as loadRepoProjectConfig };

export async function loadRepoReviewLauncherConfig(cwd: string): Promise<ReviewLauncherConfig> {
  const configPath = getRepoLocalConfigPath(cwd);

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = YAML.parse(raw) ?? {};
    const config = projectConfigSchema.parse(parsed);
    return config.review_launcher ?? { profiles: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { profiles: {} };
    }

    if (error instanceof z.ZodError) {
      throw new Error(`Invalid ${configPath}: ${error.message}`);
    }

    throw error;
  }
}

export async function saveRepoReviewLauncherLastUsed(
  cwd: string,
  lastUsed: ReviewLauncherLastUsedConfig,
): Promise<string> {
  const configPath = getRepoLocalConfigWritePath(cwd);
  const conductorDir = dirname(configPath);
  await mkdir(conductorDir, { recursive: true });

  let parsed: Record<string, unknown> = {};
  try {
    const raw = await readFile(getRepoLocalConfigPath(cwd), "utf8");
    const loaded = YAML.parse(raw);
    if (loaded && typeof loaded === "object" && !Array.isArray(loaded)) {
      parsed = loaded as Record<string, unknown>;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const currentReviewLauncher = (
    parsed.review_launcher
    && typeof parsed.review_launcher === "object"
    && !Array.isArray(parsed.review_launcher)
  )
    ? parsed.review_launcher as Record<string, unknown>
    : {};

  const nextConfig = projectConfigSchema.parse({
    ...parsed,
    review_launcher: {
      ...currentReviewLauncher,
      last_used: lastUsed,
    },
  });

  await writeFile(configPath, YAML.stringify(nextConfig), "utf8");
  return configPath;
}

export function getRepoLocalConfigPath(cwd: string): string {
  return resolveRepoConfigPath(cwd);
}

function getRepoLocalConfigWritePath(cwd: string): string {
  return getPreferredRepoConfigPath(cwd);
}

export function getRolePrompt(
  config: ProjectConfig,
  role: RoleId,
): string {
  const configuredPrompt = config.prompts[role];
  if (configuredPrompt && configuredPrompt.trim().length > 0) {
    return configuredPrompt.trim();
  }

  return SYSTEM_PROMPTS[role];
}

export function resolveAgentModels(
  config: ProjectConfig,
  override?: AgentModelConfig | undefined,
): AgentModelConfig {
  return {
    claude:
      normalizeModelName(override?.claude) ??
      normalizeModelName(config.agent_models.claude) ??
      DEFAULT_AGENT_MODELS.claude,
    codex:
      normalizeModelName(override?.codex) ??
      normalizeModelName(config.agent_models.codex) ??
      DEFAULT_AGENT_MODELS.codex,
    gemini:
      normalizeModelName(override?.gemini) ??
      normalizeModelName(config.agent_models.gemini) ??
      DEFAULT_AGENT_MODELS.gemini,
  };
}

function normalizeModelName(value?: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

