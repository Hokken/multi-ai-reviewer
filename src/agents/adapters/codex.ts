import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, normalize, resolve } from "node:path";

import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import { OUTPUT_CONTRACTS } from "../../roles/index.js";
import type { TokenUsage } from "../../types/index.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

export class CodexAdapter implements AgentAdapter {
  readonly agent = "codex" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.codex);
    const tempDir = await mkdtemp(join(tmpdir(), "conductor-codex-"));
    const outputPath = join(tempDir, "last-message.txt");
    const schemaPath = join(tempDir, "output-schema.json");
    const sessionLookupStart = new Date();
    const sessionSnapshot = input.resumeSessionId
      ? undefined
      : await captureCodexSessionSnapshot(input.cwd, sessionLookupStart);

    await writeFile(schemaPath, OUTPUT_CONTRACTS[input.step.role], "utf8");

    const args = buildCodexArgs(
      schemaPath,
      outputPath,
      input.model,
      input.resumeSessionId,
    );

    try {
      const result = await runCommand(executable, args, {
        cwd: input.cwd,
        stdin: input.prompt,
        verbose: input.verbose,
        label: "codex",
      });

      let normalizedOutput = "";
      try {
        normalizedOutput = await readFile(outputPath, "utf8");
      } catch {
        normalizedOutput = extractCodexLastMessage(result.stdout);
      }

      return {
        agent: this.agent,
        command: [executable, ...args],
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        normalizedOutput,
        providerSessionId: input.resumeSessionId
          ?? await resolveCodexSessionId(input.cwd, sessionLookupStart, sessionSnapshot)
          ?? extractCodexSessionId(result.stdout),
        tokenUsage: extractCodexTokenUsage(result.stdout),
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export function buildCodexArgs(
  schemaPath: string,
  outputPath: string,
  model?: string | undefined,
  resumeSessionId?: string | undefined,
): string[] {
  const args = [
    "exec",
  ];

  if (resumeSessionId) {
    args.push("resume");
  }

  args.push("--json");

  if (model) {
    args.push("--model", model);
  }

  args.push("--dangerously-bypass-approvals-and-sandbox");

  args.push("--skip-git-repo-check");

  if (!resumeSessionId) {
    args.push("--output-schema", schemaPath);
  }

  args.push("--output-last-message", outputPath);

  if (resumeSessionId) {
    args.push(resumeSessionId);
  }

  args.push("-");

  return args;
}

export function extractCodexLastMessage(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      if (typeof parsed.last_assistant_message === "string") {
        return parsed.last_assistant_message;
      }

      if (typeof parsed.text === "string") {
        return parsed.text;
      }
    } catch {
      continue;
    }
  }

  return "";
}

export function extractCodexSessionId(stdout: string): string | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const directMatch = findSessionIdInValue(parsed, parsed.type);
      if (directMatch) {
        return directMatch;
      }
    } catch {
      continue;
    }
  }

  return undefined;
}

export function extractCodexTokenUsage(stdout: string): TokenUsage | undefined {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        type?: unknown;
        usage?: {
          input_tokens?: unknown;
          cached_input_tokens?: unknown;
          output_tokens?: unknown;
        };
      };

      if (parsed.type !== "turn.completed" || !parsed.usage) {
        continue;
      }

      const inputTokens = toOptionalNumber(parsed.usage.input_tokens);
      const cachedInputTokens = toOptionalNumber(parsed.usage.cached_input_tokens);
      const outputTokens = toOptionalNumber(parsed.usage.output_tokens);
      const totalTokens = sumTokenUsage([inputTokens, cachedInputTokens, outputTokens]);

      if (inputTokens === undefined && cachedInputTokens === undefined && outputTokens === undefined) {
        continue;
      }

      return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        totalTokens,
      };
    } catch {
      continue;
    }
  }

  return undefined;
}

export async function resolveCodexSessionId(
  cwd: string,
  notOlderThan: Date,
  snapshot?: Map<string, number> | undefined,
): Promise<string | undefined> {
  const candidates = await listCodexSessionCandidates(cwd, notOlderThan, new Date());
  const changedCandidates = snapshot
    ? candidates.filter((candidate) => {
      const previousMtime = snapshot.get(candidate.file);
      return previousMtime === undefined || candidate.mtimeMs > previousMtime;
    })
    : candidates;

  changedCandidates.sort(compareSessionCandidates);
  if (changedCandidates[0]) {
    return changedCandidates[0].id;
  }

  candidates.sort(compareSessionCandidates);
  return candidates[0]?.id;
}

async function captureCodexSessionSnapshot(
  cwd: string,
  at: Date,
): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  const candidates = await listCodexSessionCandidates(cwd, new Date(at.getTime() - 24 * 60 * 60 * 1_000), at);

  for (const candidate of candidates) {
    snapshot.set(candidate.file, candidate.mtimeMs);
  }

  return snapshot;
}

async function listCodexSessionCandidates(
  cwd: string,
  start: Date,
  end: Date,
): Promise<Array<{ file: string; id: string; timestamp: number; mtimeMs: number }>> {
  const candidateDirs = buildCodexSessionDateDirectories(start, end);
  const files: string[] = [];

  for (const dir of candidateDirs) {
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          files.push(join(dir, entry.name));
        }
      }
    } catch {
      continue;
    }
  }

  const candidates: Array<{ file: string; id: string; timestamp: number; mtimeMs: number }> = [];
  for (const file of files) {
    try {
      const firstLine = (await readFile(file, "utf8")).split(/\r?\n/, 1)[0]?.trim();
      if (!firstLine) {
        continue;
      }

      const parsed = JSON.parse(firstLine) as {
        type?: unknown;
        payload?: {
          id?: unknown;
          cwd?: unknown;
          timestamp?: unknown;
        };
      };

      if (parsed.type !== "session_meta" || !parsed.payload) {
        continue;
      }

      if (
        typeof parsed.payload.id !== "string"
        || typeof parsed.payload.cwd !== "string"
        || normalizeProjectPath(parsed.payload.cwd) !== normalizeProjectPath(cwd)
      ) {
        continue;
      }

      const timestamp = parseCodexTimestamp(parsed.payload.timestamp);
      if (timestamp === undefined || timestamp < start.getTime() - 1_000) {
        continue;
      }

      const fileStat = await stat(file);
      candidates.push({
        file,
        id: parsed.payload.id,
        timestamp,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch {
      continue;
    }
  }

  return candidates;
}

function compareSessionCandidates(
  left: { timestamp: number; mtimeMs: number },
  right: { timestamp: number; mtimeMs: number },
): number {
  if (right.timestamp !== left.timestamp) {
    return right.timestamp - left.timestamp;
  }

  return right.mtimeMs - left.mtimeMs;
}

function buildCodexSessionDateDirectories(start: Date, end: Date): string[] {
  const dirs = new Set<string>();
  const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const finish = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));

  while (current.getTime() <= finish.getTime()) {
    dirs.add(
      join(
        homedir(),
        ".codex",
        "sessions",
        String(current.getUTCFullYear()),
        String(current.getUTCMonth() + 1).padStart(2, "0"),
        String(current.getUTCDate()).padStart(2, "0"),
      ),
    );
    current.setUTCDate(current.getUTCDate() + 1);
  }

  return Array.from(dirs);
}

function normalizeProjectPath(input: string): string {
  const resolved = normalize(resolve(input.trim()));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function parseCodexTimestamp(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function findSessionIdInValue(
  value: unknown,
  typeHint?: unknown,
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const [key, nested] of Object.entries(value)) {
    if (typeof nested === "string" && isLikelySessionIdKey(key, typeHint) && isUuid(nested)) {
      return nested;
    }
  }

  for (const nested of Object.values(value)) {
    if (Array.isArray(nested)) {
      for (const item of nested) {
        const found = findSessionIdInValue(item, typeHint);
        if (found) {
          return found;
        }
      }
      continue;
    }

    const found = findSessionIdInValue(nested, typeHint);
    if (found) {
      return found;
    }
  }

  return undefined;
}

function isLikelySessionIdKey(key: string, typeHint?: unknown): boolean {
  if (/(?:session|conversation|thread).*id$/i.test(key) || /^id$/i.test(key)) {
    if (!/^id$/i.test(key)) {
      return true;
    }

    return typeof typeHint === "string" && /session|conversation|thread/i.test(typeHint);
  }

  return false;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sumTokenUsage(values: Array<number | undefined>): number | undefined {
  const numeric = values.filter((value): value is number => value !== undefined);
  if (numeric.length === 0) {
    return undefined;
  }

  return numeric.reduce((sum, value) => sum + value, 0);
}
