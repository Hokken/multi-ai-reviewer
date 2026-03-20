import type { TokenUsage } from "../../types/index.js";
import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly agent = "claude" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.claude);
    const providerSessionId = input.resumeSessionId ?? crypto.randomUUID();
    const args = buildClaudeArgs(input.model, {
      sessionId: providerSessionId,
      resume: Boolean(input.resumeSessionId),
    });

    const result = await runCommand(executable, args, {
      cwd: input.cwd,
      stdin: input.prompt,
      verbose: input.verbose,
      label: "claude",
    });

    return {
      agent: this.agent,
      command: [executable, ...args],
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      normalizedOutput: extractClaudeResult(result.stdout),
      providerSessionId,
      tokenUsage: extractClaudeTokenUsage(result.stdout),
    };
  }
}

export function buildClaudeArgs(
  model?: string | undefined,
  input?: {
    sessionId?: string | undefined;
    resume?: boolean | undefined;
  } | undefined,
): string[] {
  const args = [
    "--print",
    "--output-format",
    "json",
  ];

  if (input?.resume && input.sessionId) {
    args.push("--resume", input.sessionId);
  } else if (input?.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  if (model) {
    args.push("--model", model);
  }

  args.push("--dangerously-skip-permissions");
  return args;
}

export function extractClaudeResult(stdout: string): string {
  try {
    const parsed = JSON.parse(stdout) as Record<string, unknown>;

    if (typeof parsed.result === "string") {
      return parsed.result;
    }

    if (typeof parsed.message === "string") {
      return parsed.message;
    }
  } catch {
    return stdout;
  }

  return stdout;
}

export function extractClaudeTokenUsage(stdout: string): TokenUsage | undefined {
  try {
    const parsed = JSON.parse(stdout) as {
      usage?: {
        input_tokens?: unknown;
        output_tokens?: unknown;
        cache_read_input_tokens?: unknown;
        cache_creation_input_tokens?: unknown;
      };
    };

    if (!parsed.usage || typeof parsed.usage !== "object") {
      return undefined;
    }

    const inputTokens = toOptionalNumber(parsed.usage.input_tokens);
    const outputTokens = toOptionalNumber(parsed.usage.output_tokens);
    const cachedInputTokens = toOptionalNumber(parsed.usage.cache_read_input_tokens);
    const cacheCreationInputTokens = toOptionalNumber(parsed.usage.cache_creation_input_tokens);
    const totalTokens = sumTokenUsage([
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
    ]);

    if (
      inputTokens === undefined
      && outputTokens === undefined
      && cachedInputTokens === undefined
      && cacheCreationInputTokens === undefined
    ) {
      return undefined;
    }

    return {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheCreationInputTokens,
      totalTokens,
    };
  } catch {
    return undefined;
  }
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
