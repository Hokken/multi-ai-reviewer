export interface ContextFragment {
  label: string;
  content: string;
  source: string;
  path?: string | undefined;
}

export interface TruncatedContext {
  summary: string;
  truncated: boolean;
  includedFiles: Array<{ path: string; estimatedTokens: number }>;
}

export function estimateTokens(content: string): number {
  return Math.max(1, Math.ceil(content.length / 4));
}

export function truncateContext(
  fragments: ContextFragment[],
  tokenBudget: number,
): TruncatedContext {
  const selectedSections: string[] = [];
  const includedFiles: Array<{ path: string; estimatedTokens: number }> = [];
  let usedTokens = 0;
  let truncated = false;

  for (const fragment of fragments) {
    const formatted = `## ${fragment.label}\n${fragment.content.trim()}`;
    const fragmentTokens = estimateTokens(formatted);

    if (usedTokens + fragmentTokens <= tokenBudget) {
      selectedSections.push(formatted);
      usedTokens += fragmentTokens;

      if (fragment.path) {
        includedFiles.push({
          path: fragment.path,
          estimatedTokens: fragmentTokens,
        });
      }
      continue;
    }

    const remainingTokens = tokenBudget - usedTokens;
    if (remainingTokens > 32) {
      const allowedCharacters = Math.max(64, remainingTokens * 4);
      const truncatedContent =
        formatted.slice(0, allowedCharacters).trimEnd() +
        "\n...[truncated to fit token budget]";
      selectedSections.push(truncatedContent);

      if (fragment.path) {
        includedFiles.push({
          path: fragment.path,
          estimatedTokens: estimateTokens(truncatedContent),
        });
      }
    }

    truncated = true;
    break;
  }

  return {
    summary: selectedSections.join("\n\n").trim(),
    truncated,
    includedFiles,
  };
}

