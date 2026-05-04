import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const APP_STORAGE_DIR = ".mrev";
export const LEGACY_APP_STORAGE_DIR = ".conductor";
export const CONFIG_FILENAME = "config.yaml";
export const REPORTS_DIRNAME = "reports";
export const SESSIONS_DIRNAME = "sessions";
export const REVIEW_CHAINS_DIRNAME = "chains";
export const MREV_CONFIG_ENV = "MREV_CONFIG";
export const LEGACY_CONFIG_ENV = "AI_CONDUCTOR_CONFIG";

const REPORT_PATH_PATTERN = String.raw`(?:\.mrev|\.conductor)[\\/]+reports[\\/].+\.md`;

export function getPreferredStorageDir(cwd: string): string {
  return join(cwd, APP_STORAGE_DIR);
}

export function getLegacyStorageDir(cwd: string): string {
  return join(cwd, LEGACY_APP_STORAGE_DIR);
}

export function resolveExistingStorageDir(cwd: string): string {
  const preferred = getPreferredStorageDir(cwd);
  if (existsSync(preferred)) {
    return preferred;
  }

  const legacy = getLegacyStorageDir(cwd);
  if (existsSync(legacy)) {
    return legacy;
  }

  return preferred;
}

export function getPreferredRepoConfigPath(cwd: string): string {
  return join(getPreferredStorageDir(cwd), CONFIG_FILENAME);
}

export function getLegacyRepoConfigPath(cwd: string): string {
  return join(getLegacyStorageDir(cwd), CONFIG_FILENAME);
}

export function resolveRepoConfigPath(cwd: string): string {
  const preferred = getPreferredRepoConfigPath(cwd);
  if (existsSync(preferred)) {
    return preferred;
  }

  const legacy = getLegacyRepoConfigPath(cwd);
  if (existsSync(legacy)) {
    return legacy;
  }

  return preferred;
}

export function getReportsDir(cwd: string): string {
  return join(getPreferredStorageDir(cwd), REPORTS_DIRNAME);
}

export function getSessionsDir(cwd: string): string {
  return join(getPreferredStorageDir(cwd), SESSIONS_DIRNAME);
}

export function getReviewChainsDir(cwd: string): string {
  return join(getPreferredStorageDir(cwd), REVIEW_CHAINS_DIRNAME);
}

export function resolveExistingReportsDir(cwd: string): string {
  return join(resolveExistingStorageDir(cwd), REPORTS_DIRNAME);
}

export function resolveExistingSessionsDir(cwd: string): string {
  return join(resolveExistingStorageDir(cwd), SESSIONS_DIRNAME);
}

export function resolveExistingReviewChainsDir(cwd: string): string {
  return join(resolveExistingStorageDir(cwd), REVIEW_CHAINS_DIRNAME);
}

export function getConfigEnvOverride(): string | undefined {
  const preferred = process.env[MREV_CONFIG_ENV];
  if (preferred && preferred.trim().length > 0) {
    return preferred.trim();
  }

  const legacy = process.env[LEGACY_CONFIG_ENV];
  if (legacy && legacy.trim().length > 0) {
    return legacy.trim();
  }

  return undefined;
}

const BASE_CONFIG_YAML = `# Multi AI Reviewer configuration
# See AGENTS.md for full documentation.

# Set agent_models to skip --reviewer-models on every command.
# Only declare the reviewers you want to use (1, 2, or all 3).
# agent_models:
#   claude: claude-opus-4-7
#   codex: gpt-5.5
#   gemini: gemini-3.1-pro

# Default values for review command flags.
# CLI flags always override these values.
# review_defaults:
#   mode: implementation
#   instructions: "Focus on security and performance"
#   repo_summary: "A TypeScript monorepo for..."
#   tech_stack:
#     - typescript
#     - node
#   files:
#     - src/core/schema.ts
#   verbose: false
#   gemini_strict: false

review_launcher:
  investigations_folder: docs/investigations
  plans_folder: docs/plans
  reviews_folder: docs/reviews
  profiles:
    investigation:
      mode: investigation
    plan:
      mode: plan
    review:
      mode: implementation
`;

export async function ensureWorkspace(cwd: string): Promise<void> {
  const storageDir = getPreferredStorageDir(cwd);
  const reportsDir = join(storageDir, REPORTS_DIRNAME);
  const sessionsDir = join(storageDir, SESSIONS_DIRNAME);
  const reviewChainsDir = join(storageDir, REVIEW_CHAINS_DIRNAME);
  const configPath = join(storageDir, CONFIG_FILENAME);

  await mkdir(reportsDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(reviewChainsDir, { recursive: true });

  try {
    await writeFile(configPath, BASE_CONFIG_YAML, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

export function getReportPathPattern(): RegExp {
  return new RegExp(String.raw`(^|[\\/])${REPORT_PATH_PATTERN}$`, "i");
}

export function getReportPathScanner(): RegExp {
  return new RegExp(
    `(?:[A-Za-z]:)?[^"'\\\`\\s]*?${REPORT_PATH_PATTERN}\\b`,
    "g",
  );
}
