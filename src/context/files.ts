import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";

import { getReportPathPattern } from "../config/storage.js";
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
    const preparedContent = prepareContextFileContent(repoRelativePath, rawContent);

    fragments.push({
      label: `FILE: ${repoRelativePath}`,
      source: "--files",
      path: repoRelativePath,
      content: preparedContent,
    });
  }

  return fragments;
}

function prepareContextFileContent(
  repoRelativePath: string,
  rawContent: string,
): string {
  if (isPriorReviewReport(repoRelativePath)) {
    return condensePriorReviewReport(rawContent);
  }

  return rawContent;
}

function isPriorReviewReport(repoRelativePath: string): boolean {
  return getReportPathPattern().test(repoRelativePath);
}

function condensePriorReviewReport(content: string): string {
  const preferredSections = new Set([
    "review summary",
    "validation context",
    "key findings",
    "consensus",
  ]);
  const extracted = extractMarkdownSections(content, preferredSections);

  if (extracted.trim().length > 0) {
    return [
      extracted.trim(),
      "",
      "[Detailed per-step outputs and diffs omitted to reduce repeated reviewer context.]",
    ].join("\n");
  }

  return truncateSupportMarkdown(
    content,
    3_500,
    100,
    "[Report context truncated to reduce repeated reviewer context.]",
  );
}

function extractMarkdownSections(
  content: string,
  preferredSections: Set<string>,
): string {
  const lines = content.split(/\r?\n/);
  const selected: string[] = [];
  let currentHeading = "";
  let currentSection: string[] = [];

  const flush = () => {
    if (currentSection.length === 0) {
      return;
    }

    if (currentHeading.length === 0 || preferredSections.has(currentHeading)) {
      selected.push(currentSection.join("\n").trimEnd());
    }

    currentSection = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^\s*##+\s+(.*)$/);
    if (headingMatch?.[1]) {
      flush();
      currentHeading = normalizeHeading(headingMatch[1]);
    }

    currentSection.push(line);
  }

  flush();
  return selected.join("\n\n").trim();
}

function normalizeHeading(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function truncateSupportMarkdown(
  content: string,
  maxCharacters: number,
  maxLines: number,
  notice: string,
): string {
  const lines = content.split(/\r?\n/);
  const truncatedByLines = lines.length > maxLines;
  const byLines = truncatedByLines
    ? `${lines.slice(0, maxLines).join("\n").trimEnd()}\n${notice}`
    : content;

  if (byLines.length <= maxCharacters) {
    return byLines;
  }

  return `${byLines.slice(0, maxCharacters).trimEnd()}\n${notice}`;
}
