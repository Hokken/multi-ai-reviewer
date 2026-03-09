import { existsSync } from "node:fs";
import { join } from "node:path";

export const APP_STORAGE_DIR = ".mrev";
export const LEGACY_APP_STORAGE_DIR = ".conductor";
export const CONFIG_FILENAME = "config.yaml";
export const REPORTS_DIRNAME = "reports";
export const SESSIONS_DIRNAME = "sessions";
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

export function resolveExistingReportsDir(cwd: string): string {
  return join(resolveExistingStorageDir(cwd), REPORTS_DIRNAME);
}

export function resolveExistingSessionsDir(cwd: string): string {
  return join(resolveExistingStorageDir(cwd), SESSIONS_DIRNAME);
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

export function getReportPathPattern(): RegExp {
  return new RegExp(String.raw`(^|[\\/])${REPORT_PATH_PATTERN}$`, "i");
}

export function getReportPathScanner(): RegExp {
  return new RegExp(
    `(?:[A-Za-z]:)?[^"'\\\`\\s]*?${REPORT_PATH_PATTERN}\\b`,
    "g",
  );
}
