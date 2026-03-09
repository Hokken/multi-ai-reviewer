import { CONTEXT_TOKEN_BUDGETS } from "../roles/context-budgets.js";
import type { CodeContext, RoleId } from "../types/index.js";
import { readContextFiles } from "./files.js";
import { readStagedDiff } from "./git.js";
import { findSymbolContext } from "./ripgrep.js";
import type { ContextFragment } from "./tokenguard.js";
import { truncateContext } from "./tokenguard.js";

export interface BuildContextOptions {
  cwd: string;
  role: RoleId;
  files?: string[] | undefined;
  diff?: boolean | undefined;
  symbol?: string | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
}

export async function buildContext(options: BuildContextOptions): Promise<CodeContext> {
  const fragments: ContextFragment[] = [];
  const warnings: string[] = [];
  const explicitContextRequested =
    Boolean(options.files && options.files.length > 0) ||
    Boolean(options.diff) ||
    Boolean(options.symbol) ||
    Boolean(options.repoSummary && options.repoSummary.trim().length > 0);

  if (options.files && options.files.length > 0) {
    const fileFragments = await readContextFiles(options.cwd, options.files);
    fragments.push(...fileFragments);
  }

  if (options.diff) {
    const diffFragment = await readStagedDiff(options.cwd);
    if (diffFragment) {
      fragments.push(diffFragment);
    } else {
      warnings.push("Requested staged diff context, but no staged diff was found.");
    }
  }

  if (options.symbol) {
    const symbolFragment = await findSymbolContext(options.cwd, options.symbol);
    if (symbolFragment) {
      fragments.push(symbolFragment);
    } else {
      warnings.push(`No matches found for symbol "${options.symbol}".`);
    }
  }

  if (options.repoSummary && options.repoSummary.trim().length > 0) {
    fragments.push({
      label: "REPOSITORY SUMMARY",
      source: "--repo-summary",
      content: options.repoSummary.trim(),
    });
  }

  if (!explicitContextRequested) {
    const autoDiff = await readStagedDiff(options.cwd);
    if (autoDiff) {
      fragments.push(autoDiff);
      warnings.push("No explicit context flags provided. Falling back to staged diff.");
    } else {
      warnings.push(
        "No context provided. Running with task description only - results may be less accurate.",
      );
    }
  }

  const tokenBudget = CONTEXT_TOKEN_BUDGETS[options.role];
  const truncated = truncateContext(fragments, tokenBudget);

  return {
    summary:
      truncated.summary.length > 0
        ? truncated.summary
        : "No context provided beyond the task description.",
    sources: Array.from(new Set(fragments.map((fragment) => fragment.source))),
    techStack: options.techStack ?? [],
    tokenBudget,
    warnings,
    truncated: truncated.truncated,
    includedFiles: truncated.includedFiles,
  };
}
