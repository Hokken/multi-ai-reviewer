import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

const GEMINI_PROMPT_PRIMER =
  "JSON_ONLY";

export class GeminiAdapter implements AgentAdapter {
  readonly agent = "gemini" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.gemini);
    const invocation = buildGeminiInvocation(input.prompt, input.model);

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
    };
  }
}

export function buildGeminiInvocation(
  prompt: string,
  model?: string | undefined,
): { args: string[]; stdin: string } {
  const args = [`--prompt=${GEMINI_PROMPT_PRIMER}`];

  if (model) {
    args.push("--model", model);
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
