import { spawn } from "node:child_process";
import type { AgentCliStatus, AgentId } from "../types/index.js";
import type { AgentModelConfig } from "../types/index.js";

interface CommandResult {
  stdout: string;
  stderr: string;
}

function execCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(stderr.trim() || `Command exited with code ${code}`));
    });
  });
}

export const MINIMUM_CLI_VERSIONS = {
  claude: "2.1.71",
  codex: "0.111.0",
  gemini: "0.32.1",
} as const;

export const AGENT_BINARIES: Record<AgentId, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

export const DEFAULT_AGENT_MODELS: Required<AgentModelConfig> = {
  claude: "claude-opus-4-7",
  codex: "gpt-5.5",
  gemini: "gemini-3.1-pro",
};

export function extractVersion(rawOutput: string): string | null {
  const match = rawOutput.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? `${match[1]}.${match[2]}.${match[3]}` : null;
}

export function meetsMinimumVersion(
  detectedVersion: string | null,
  minimumVersion: string,
): boolean {
  if (!detectedVersion) {
    return false;
  }

  const detectedParts = detectedVersion.split(".").map((part) => Number(part));
  const minimumParts = minimumVersion.split(".").map((part) => Number(part));
  const maxLength = Math.max(detectedParts.length, minimumParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const detected = detectedParts[index] ?? 0;
    const minimum = minimumParts[index] ?? 0;

    if (detected > minimum) {
      return true;
    }

    if (detected < minimum) {
      return false;
    }
  }

  return true;
}

export async function detectAgentCli(agent: AgentId): Promise<AgentCliStatus> {
  const binary = AGENT_BINARIES[agent];
  const minimumVersion = MINIMUM_CLI_VERSIONS[agent];

  try {
    const executable = await resolveExecutable(binary);
    const result = await execCommand(executable, ["--version"]);
    const combinedOutput = `${result.stdout}\n${result.stderr}`.trim();
    const detectedVersion = extractVersion(combinedOutput);

    return {
      agent,
      binary,
      installed: true,
      detectedVersion,
      minimumVersion,
      meetsMinimumVersion: meetsMinimumVersion(detectedVersion, minimumVersion),
      error: detectedVersion === null ? "Unable to parse CLI version output." : null,
    };
  } catch (error) {
    return {
      agent,
      binary,
      installed: false,
      detectedVersion: null,
      minimumVersion,
      meetsMinimumVersion: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function detectAllAgentClis(): Promise<AgentCliStatus[]> {
  const agents: AgentId[] = ["claude", "codex", "gemini"];
  return Promise.all(agents.map((agent) => detectAgentCli(agent)));
}

export async function resolveExecutable(binary: string): Promise<string> {
  if (process.platform !== "win32") {
    return binary;
  }

  const result = await execCommand("where.exe", [binary]);
  const candidates = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const cmdCandidate = candidates.find((candidate) => candidate.toLowerCase().endsWith(".cmd"));
  return cmdCandidate ?? candidates[0] ?? binary;
}
