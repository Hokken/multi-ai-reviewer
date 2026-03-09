import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

export class ClaudeAdapter implements AgentAdapter {
  readonly agent = "claude" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.claude);
    const args = buildClaudeArgs(input.model);

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
    };
  }
}

export function buildClaudeArgs(
  model?: string | undefined,
): string[] {
  const args = [
    "--print",
    "--output-format",
    "json",
  ];

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
