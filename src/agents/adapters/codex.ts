import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AGENT_BINARIES, resolveExecutable } from "../../config/agents.js";
import { OUTPUT_CONTRACTS } from "../../roles/index.js";
import { runCommand } from "../runner.js";
import type { AgentAdapter, AgentExecutionInput, AgentExecutionResult } from "./types.js";

export class CodexAdapter implements AgentAdapter {
  readonly agent = "codex" as const;

  async execute(input: AgentExecutionInput): Promise<AgentExecutionResult> {
    const executable = await resolveExecutable(AGENT_BINARIES.codex);
    const tempDir = await mkdtemp(join(tmpdir(), "conductor-codex-"));
    const outputPath = join(tempDir, "last-message.txt");
    const schemaPath = join(tempDir, "output-schema.json");

    await writeFile(schemaPath, OUTPUT_CONTRACTS[input.step.role], "utf8");

    const args = buildCodexArgs(schemaPath, outputPath, input.model);

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
): string[] {
  const args = [
    "exec",
    "--json",
  ];

  if (model) {
    args.push("--model", model);
  }

  args.push("--dangerously-bypass-approvals-and-sandbox");

  args.push(
    "--skip-git-repo-check",
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath,
    "-",
  );

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
