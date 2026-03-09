import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { spawn } from "node:child_process";

import type { ContextFragment } from "./tokenguard.js";

export async function findSymbolContext(
  cwd: string,
  symbol: string,
): Promise<ContextFragment | null> {
  const rgResult = await tryRipgrep(cwd, symbol);
  if (rgResult !== null) {
    return rgResult;
  }

  const fallback = await fallbackSearch(cwd, symbol);
  if (!fallback) {
    return null;
  }

  return {
    label: `SYMBOL SEARCH: ${symbol}`,
    source: "--symbol",
    content: fallback,
  };
}

async function tryRipgrep(cwd: string, symbol: string): Promise<ContextFragment | null> {
  const result = await new Promise<{ exitCode: number; stdout: string }>((resolve) => {
    const child = spawn("rg", ["--line-number", "--no-heading", "--color", "never", symbol, "."], {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
    });

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout });
    });

    child.on("error", () => {
      resolve({ exitCode: 127, stdout: "" });
    });
  });

  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return null;
  }

  return {
    label: `SYMBOL SEARCH: ${symbol}`,
    source: "--symbol",
    content: result.stdout.trim(),
  };
}

async function fallbackSearch(cwd: string, symbol: string): Promise<string | null> {
  const matches: string[] = [];
  await walkDirectory(cwd, async (filePath) => {
    if (filePath.includes(`${join("", "node_modules")}`) || filePath.includes(`${join("", "dist")}`)) {
      return;
    }

    try {
      const content = await readFile(filePath, "utf8");
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.includes(symbol)) {
          matches.push(`${relative(cwd, filePath)}:${index + 1}:${line}`);
        }
      });
    } catch {
      // Ignore unreadable or binary files in fallback mode.
    }
  });

  if (matches.length === 0) {
    return null;
  }

  return matches.join("\n");
}

async function walkDirectory(
  directory: string,
  onFile: (filePath: string) => Promise<void>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }

    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(absolutePath, onFile);
      continue;
    }

    await onFile(absolutePath);
  }
}

