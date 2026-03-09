import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SessionLog } from "../types/index.js";
import { resolveExistingSessionsDir } from "../config/storage.js";

export async function listSessions(cwd: string): Promise<Array<{ id: string; path: string; log: SessionLog }>> {
  const sessionsDir = resolveExistingSessionsDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch {
    return [];
  }

  const sessionFiles = entries.filter((entry) => entry.endsWith(".json")).sort().reverse();
  const sessions = await Promise.all(
    sessionFiles.map(async (entry) => {
      const path = join(sessionsDir, entry);
      const content = await readFile(path, "utf8");
      const log = JSON.parse(content) as SessionLog;
      return { id: log.sessionId, path, log };
    }),
  );

  return sessions;
}

export async function getSessionById(cwd: string, sessionId: string): Promise<{ path: string; log: SessionLog } | null> {
  const sessions = await listSessions(cwd);
  const found = sessions.find((session) => session.log.sessionId === sessionId);
  return found ? { path: found.path, log: found.log } : null;
}

export async function searchSessions(cwd: string, keyword: string): Promise<Array<{ path: string; log: SessionLog }>> {
  const sessions = await listSessions(cwd);
  const lowerKeyword = keyword.toLowerCase();
  return sessions.filter((session) =>
    session.log.request.task.toLowerCase().includes(lowerKeyword),
  );
}
