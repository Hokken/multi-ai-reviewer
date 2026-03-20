import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import type { TokenUsage } from "../../types/index.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

const GEMINI_PROMPT_PRIMER =
  "JSON_ONLY";

export class GeminiAdapter implements AgentAdapter {
  readonly agent = "gemini" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.gemini);
    const sessionLookupStart = new Date();
    const sessionSnapshot = input.resumeSessionId
      ? undefined
      : await captureGeminiSessionSnapshot(input.cwd);
    const invocation = buildGeminiInvocation(
      input.prompt,
      input.model,
      input.resumeSessionId,
    );

    const result = await runCommand(executable, invocation.args, {
      cwd: input.cwd,
      stdin: invocation.stdin,
      verbose: input.verbose,
      label: "gemini",
    });

    return {
      agent: this.agent,
      command: [executable, ...invocation.args],
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      normalizedOutput: extractGeminiResult(result.stdout),
      providerSessionId: input.resumeSessionId
        ?? await resolveGeminiSessionId(input.cwd, sessionLookupStart, sessionSnapshot),
      tokenUsage: extractGeminiTokenUsage(result.stdout),
    };
  }
}

export function buildGeminiInvocation(
  prompt: string,
  model?: string | undefined,
  resumeSessionId?: string | undefined,
): { args: string[]; stdin: string } {
  const args = [`--prompt=${GEMINI_PROMPT_PRIMER}`];

  if (model) {
    args.push("--model", model);
  }

  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
  }

  args.push("--yolo");

  args.push("--output-format", "json");
  return {
    args,
    stdin: `\n\n${prompt}`,
  };
}

export function extractGeminiResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;

    if (typeof parsed.response === "string") {
      return parsed.response;
    }

    if (typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
    return stdout;
  }

  return stdout;
}

export function extractGeminiTokenUsage(stdout: string): TokenUsage | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      stats?: {
        models?: Record<string, {
          tokens?: {
            input?: unknown;
            candidates?: unknown;
            cached?: unknown;
            thoughts?: unknown;
            tool?: unknown;
            total?: unknown;
          };
        }>;
      };
    };

    const models = parsed.stats?.models;
    if (!models || typeof models !== "object") {
      return undefined;
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens = 0;
    let thoughtTokens = 0;
    let toolTokens = 0;
    let totalTokens = 0;
    let hasAny = false;

    for (const modelStats of Object.values(models)) {
      const tokens = modelStats?.tokens;
      if (!tokens || typeof tokens !== "object") {
        continue;
      }

      const modelInput = toOptionalNumber(tokens.input);
      const modelOutput = toOptionalNumber(tokens.candidates);
      const modelCached = toOptionalNumber(tokens.cached);
      const modelThoughts = toOptionalNumber(tokens.thoughts);
      const modelTool = toOptionalNumber(tokens.tool);
      const modelTotal = toOptionalNumber(tokens.total);

      if (
        modelInput !== undefined
        || modelOutput !== undefined
        || modelCached !== undefined
        || modelThoughts !== undefined
        || modelTool !== undefined
        || modelTotal !== undefined
      ) {
        hasAny = true;
      }

      inputTokens += modelInput ?? 0;
      outputTokens += modelOutput ?? 0;
      cachedInputTokens += modelCached ?? 0;
      thoughtTokens += modelThoughts ?? 0;
      toolTokens += modelTool ?? 0;
      totalTokens += modelTotal ?? 0;
    }

    if (!hasAny) {
      return undefined;
    }

    return {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      thoughtTokens,
      toolTokens,
      totalTokens,
    };
  } catch {
    return undefined;
  }
}

export async function resolveGeminiSessionId(
  cwd: string,
  notOlderThan: Date,
  snapshot?: Map<string, number> | undefined,
): Promise<string | undefined> {
  const candidates = await listGeminiSessionCandidates(cwd, notOlderThan);
  const changedCandidates = snapshot
    ? candidates.filter((candidate) => {
      const previousMtime = snapshot.get(candidate.file);
      return previousMtime === undefined || candidate.mtimeMs > previousMtime;
    })
    : candidates;

  changedCandidates.sort(compareGeminiCandidates);
  if (changedCandidates[0]) {
    return changedCandidates[0].sessionId;
  }

  candidates.sort(compareGeminiCandidates);
  return candidates[0]?.sessionId;
}

async function captureGeminiSessionSnapshot(cwd: string): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  const candidates = await listGeminiSessionCandidates(cwd, new Date(0));

  for (const candidate of candidates) {
    snapshot.set(candidate.file, candidate.mtimeMs);
  }

  return snapshot;
}

async function listGeminiSessionCandidates(
  cwd: string,
  notOlderThan: Date,
): Promise<Array<{ file: string; sessionId: string; updatedAt: number; mtimeMs: number }>> {
  const projectChatsDir = await findGeminiProjectChatsDir(cwd);
  if (!projectChatsDir) {
    return [];
  }

  const entries = await readdir(projectChatsDir, { withFileTypes: true });
  const sessionFiles = entries
    .filter((entry) => entry.isFile() && /^session-.*\.json$/i.test(entry.name))
    .map((entry) => join(projectChatsDir, entry.name));

  const candidates: Array<{ file: string; sessionId: string; updatedAt: number; mtimeMs: number }> = [];
  for (const sessionFile of sessionFiles) {
    try {
      const content = await readFile(sessionFile, "utf8");
      const parsed = JSON.parse(content) as {
        sessionId?: unknown;
        lastUpdated?: unknown;
        startTime?: unknown;
      };
      if (typeof parsed.sessionId !== "string" || parsed.sessionId.trim().length === 0) {
        continue;
      }

      const timestamp = parseGeminiSessionTimestamp(parsed.lastUpdated)
        ?? parseGeminiSessionTimestamp(parsed.startTime);
      if (timestamp === undefined || timestamp < notOlderThan.getTime() - 1_000) {
        continue;
      }

      const fileStat = await stat(sessionFile);
      candidates.push({
        file: sessionFile,
        sessionId: parsed.sessionId,
        updatedAt: timestamp,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch {
      continue;
    }
  }

  return candidates;
}

function compareGeminiCandidates(
  left: { updatedAt: number; mtimeMs: number },
  right: { updatedAt: number; mtimeMs: number },
): number {
  if (right.updatedAt !== left.updatedAt) {
    return right.updatedAt - left.updatedAt;
  }

  return right.mtimeMs - left.mtimeMs;
}

async function findGeminiProjectChatsDir(cwd: string): Promise<string | undefined> {
  const tmpDir = join(homedir(), ".gemini", "tmp");
  let entries;
  try {
    entries = await readdir(tmpDir, { withFileTypes: true });
  } catch {
    return undefined;
  }

  const normalizedCwd = normalizeProjectPath(cwd);

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const projectRootMarkerPath = join(tmpDir, entry.name, ".project_root");
    try {
      const projectRoot = await readFile(projectRootMarkerPath, "utf8");
      if (normalizeProjectPath(projectRoot) === normalizedCwd) {
        const chatsDir = join(tmpDir, entry.name, "chats");
        try {
          await readdir(chatsDir);
          return chatsDir;
        } catch {
          return undefined;
        }
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

function normalizeProjectPath(input: string): string {
  const resolved = normalize(resolve(input.trim()));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseGeminiSessionTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
