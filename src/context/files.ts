import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";

import type { ContextFragment } from "./tokenguard.js";

export async function readContextFiles(
  cwd: string,
  filePaths: string[],
): Promise<ContextFragment[]> {
  const fragments: ContextFragment[] = [];

  for (const inputPath of filePaths) {
    const absolutePath = isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
    const rawContent = await readFile(absolutePath, "utf8");
    const repoRelativePath = normalize(relative(cwd, absolutePath));

    fragments.push({
      label: `FILE: ${repoRelativePath}`,
      source: "--files",
      path: repoRelativePath,
      content: rawContent,
    });
  }

  return fragments;
}

