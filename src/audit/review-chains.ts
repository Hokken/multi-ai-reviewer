import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { getReviewChainsDir } from "../config/storage.js";

import type {
  AgentId,
  ReviewChainRecord,
  ReviewWorkflowKind,
  SessionLog,
} from "../types/index.js";

export interface WriteReviewChainRecordInput {
  cwd: string;
  kind: ReviewWorkflowKind;
  artifactPath: string;
  reportPath: string;
  sessionLogPath: string;
  sessionLog: SessionLog;
}

export async function readReviewChainRecord(
  cwd: string,
  kind: ReviewWorkflowKind,
  artifactPath: string,
): Promise<ReviewChainRecord | null> {
  const filePath = getReviewChainFilePath(cwd, kind, artifactPath);

  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as ReviewChainRecord;
  } catch {
    return null;
  }
}

export async function writeReviewChainRecord(
  input: WriteReviewChainRecordInput,
): Promise<ReviewChainRecord> {
  const normalizedArtifactPath = normalizeRepoRelativePath(input.artifactPath);
  const reviewKey = createReviewKey(input.kind, normalizedArtifactPath);
  const filePath = getReviewChainFilePath(input.cwd, input.kind, normalizedArtifactPath);
  const existing = await readReviewChainRecord(
    input.cwd,
    input.kind,
    normalizedArtifactPath,
  );
  const timestamp = input.sessionLog.timestamp;
  const providerSessions = extractResumableReviewSessions(input.sessionLog);
  const record: ReviewChainRecord = {
    version: 1,
    reviewKey,
    kind: input.kind,
    artifactPath: normalizedArtifactPath,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp,
    latestReportPath: toRepoRelativePath(input.cwd, input.reportPath),
    latestSessionLogPath: toRepoRelativePath(input.cwd, input.sessionLogPath),
    providerSessions,
  };

  await mkdir(getReviewChainsDir(input.cwd), { recursive: true });
  await writeFile(filePath, JSON.stringify(record, null, 2), "utf8");

  return record;
}

function extractResumableReviewSessions(
  sessionLog: SessionLog,
): Partial<Record<AgentId, string>> {
  const providerSessions: Partial<Record<AgentId, string>> = {};

  for (const step of sessionLog.steps) {
    if (
      step.role !== "review"
      || step.status !== "completed"
      || step.parsedOutput === null
      || step.parsedOutput === undefined
      || typeof step.providerSessionId !== "string"
      || step.providerSessionId.trim().length === 0
    ) {
      continue;
    }

    providerSessions[step.agent] = step.providerSessionId;
  }

  return providerSessions;
}

function getReviewChainFilePath(
  cwd: string,
  kind: ReviewWorkflowKind,
  artifactPath: string,
): string {
  const normalizedArtifactPath = normalizeRepoRelativePath(artifactPath);
  const reviewKey = createReviewKey(kind, normalizedArtifactPath);
  return join(getReviewChainsDir(cwd), `${reviewKey}.json`);
}

function createReviewKey(kind: ReviewWorkflowKind, artifactPath: string): string {
  return createHash("sha1")
    .update(`${kind}:${normalizeRepoRelativePath(artifactPath)}`)
    .digest("hex");
}

function toRepoRelativePath(cwd: string, path: string): string {
  return normalizeRepoRelativePath(relative(cwd, resolve(cwd, path)));
}

function normalizeRepoRelativePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}
