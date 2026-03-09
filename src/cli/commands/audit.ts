import { getSessionDiff } from "../../audit/diff.js";
import { getSessionById, listSessions, searchSessions } from "../../audit/reader.js";
import { formatCompactTask } from "../display.js";

export interface AuditCommandOptions {
  sessionId?: string;
  keyword?: string;
}

export async function runAuditListCommand(cwd: string): Promise<number> {
  const sessions = await listSessions(cwd);
  if (sessions.length === 0) {
    process.stdout.write("No saved sessions found.\n");
    return 0;
  }

  for (const session of sessions) {
    process.stdout.write(
      `- ${session.log.sessionId} | ${session.log.timestamp} | ${session.log.finalRecommendation} | ${formatCompactTask(session.log.request.task)}\n`,
    );
  }

  return 0;
}

export async function runAuditShowCommand(cwd: string, sessionId: string): Promise<number> {
  const session = await getSessionById(cwd, sessionId);
  if (!session) {
    process.stderr.write(`Session not found: ${sessionId}\n`);
    return 1;
  }

  process.stdout.write(`${JSON.stringify(session.log, null, 2)}\n`);
  return 0;
}

export async function runAuditSearchCommand(cwd: string, keyword: string): Promise<number> {
  const matches = await searchSessions(cwd, keyword);
  if (matches.length === 0) {
    process.stdout.write("No matching sessions found.\n");
    return 0;
  }

  for (const match of matches) {
    process.stdout.write(
      `- ${match.log.sessionId} | ${match.log.timestamp} | ${formatCompactTask(match.log.request.task)}\n`,
    );
  }

  return 0;
}

export async function runAuditDiffCommand(cwd: string, sessionId: string): Promise<number> {
  const session = await getSessionById(cwd, sessionId);
  if (!session) {
    process.stderr.write(`Session not found: ${sessionId}\n`);
    return 1;
  }

  const diff = getSessionDiff(session.log);
  const executorDiff = diff.executorDiff?.trim() ?? "";
  const revisedDiff = diff.revisedDiff?.trim() ?? "";

  process.stdout.write("=== EXECUTOR DIFF ===\n");
  process.stdout.write(`${executorDiff.length > 0 ? executorDiff : "[none]"}\n\n`);
  process.stdout.write("=== REVISED DIFF ===\n");
  process.stdout.write(`${revisedDiff.length > 0 ? revisedDiff : "[none]"}\n`);
  return 0;
}
