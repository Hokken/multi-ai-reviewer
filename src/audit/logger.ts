import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { renderSessionMarkdown } from "./markdown.js";
import { getReportsDir, getSessionsDir } from "../config/storage.js";

import type {
  ConsensusReport,
  ExecutionStepResult,
  SessionLog,
  SessionStepLog,
} from "../types/index.js";

export interface WriteSessionLogInput {
  cwd: string;
  task: string;
  pipeline: string;
  options: Record<string, unknown>;
  steps: ExecutionStepResult[];
  consensus: ConsensusReport | null;
}

export async function writeSessionLog(input: WriteSessionLogInput): Promise<{
  sessionId: string;
  path: string;
  reportPath: string;
  log: SessionLog;
}> {
  const sessionId = createSessionId();
  const timestamp = new Date().toISOString();
  const sessionsDir = getSessionsDir(input.cwd);
  const reportsDir = getReportsDir(input.cwd);
  await mkdir(sessionsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  const startedAtMs = input.steps.length > 0
    ? Math.min(...input.steps.map((step) => Date.parse(step.startedAt)))
    : Date.now();
  const completedAtMs = input.steps.length > 0
    ? Math.max(...input.steps.map((step) => Date.parse(step.completedAt)))
    : startedAtMs;
  const durationMs = Math.max(0, completedAtMs - startedAtMs);
  const log: SessionLog = {
    sessionId,
    timestamp,
    durationMs,
    request: {
      task: input.task,
      pipeline: input.pipeline,
      options: input.options,
    },
    steps: input.steps.map(toSessionStepLog),
    consensus: input.consensus,
    finalRecommendation: input.consensus?.recommendation ?? "no_review_steps",
  };

  const filenameBase = `${timestamp.replace(/[:.]/g, "-")}-${sessionId}`;
  const filePath = join(sessionsDir, `${filenameBase}.json`);
  const reportPath = join(reportsDir, `${filenameBase}.md`);
  await writeFile(filePath, JSON.stringify(log, null, 2), "utf8");
  await writeFile(reportPath, renderSessionMarkdown(log), "utf8");

  return {
    sessionId,
    path: filePath,
    reportPath,
    log,
  };
}

function toSessionStepLog(step: ExecutionStepResult): SessionStepLog {
  return {
    index: step.stepIndex,
    role: step.role,
    agent: step.agent,
    status: step.status,
    startedAt: step.startedAt,
    completedAt: step.completedAt,
    durationMs: step.durationMs,
    promptSummary: {
      taskLength: step.prompt.length,
      contextSources: step.context.sources,
      includedFiles: step.context.includedFiles,
      truncated: step.context.truncated,
    },
    rawOutput: step.normalizedOutput || step.stdout || null,
    parsedOutput: step.parsedOutput,
    error: step.error,
  };
}

function createSessionId(): string {
  return Math.random().toString(36).slice(2, 10);
}
