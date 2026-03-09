import { spawn } from "node:child_process";

import type { ContextFragment } from "./tokenguard.js";

export async function readStagedDiff(cwd: string): Promise<ContextFragment | null> {
  const result = await runGitCommand(cwd, [
    "diff",
    "--staged",
    "--no-ext-diff",
    "--unified=3",
  ]);

  if (result.exitCode !== 0) {
    return null;
  }

  const diff = result.stdout.trim();
  if (diff.length === 0) {
    return null;
  }

  return {
    label: "STAGED DIFF",
    source: "--diff",
    content: diff,
  };
}

async function runGitCommand(
  cwd: string,
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });

    child.on("error", () => {
      resolve({
        exitCode: 1,
        stdout,
        stderr,
      });
    });
  });
}

