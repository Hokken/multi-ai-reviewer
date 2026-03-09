import { describe, expect, it } from "vitest";

import { buildPrompt } from "../../src/agents/prompts.js";
import { SYSTEM_PROMPTS } from "../../src/roles/system-prompts.js";
import type { CodeContext, PipelineStep, PriorStepOutput } from "../../src/types/index.js";

describe("buildPrompt", () => {
  const step: PipelineStep = {
    role: "review",
    agent: "gemini",
    raw: "review:gemini",
  };

  const context: CodeContext = {
    summary: "Repo summary: TypeScript monorepo",
    sources: ["--repo-summary"],
    techStack: ["TypeScript", "Vitest"],
    tokenBudget: 32_000,
    warnings: [],
    truncated: false,
    includedFiles: [],
  };

  it("renders the expected section order", () => {
    const prompt = buildPrompt({
      step,
      task: "Review the unified diff for correctness.",
      context,
      priorOutputs: [],
      systemPrompt: SYSTEM_PROMPTS.review,
    });

    expect(prompt).toContain("=== ROLE ===");
    expect(prompt).toContain("=== SYSTEM PROMPT ===");
    expect(prompt).toContain("=== TASK ===");
    expect(prompt).toContain("=== CONTEXT ===");
    expect(prompt).toContain("=== PRIOR OUTPUTS ===");
    expect(prompt).toContain("=== OUTPUT CONTRACT ===");
    expect(prompt.indexOf("=== ROLE ===")).toBeLessThan(prompt.indexOf("=== SYSTEM PROMPT ==="));
    expect(prompt.indexOf("=== SYSTEM PROMPT ===")).toBeLessThan(prompt.indexOf("=== TASK ==="));
    expect(prompt.indexOf("=== TASK ===")).toBeLessThan(prompt.indexOf("=== CONTEXT ==="));
  });

  it("renders prior outputs when available", () => {
    const priorOutputs: PriorStepOutput[] = [
      {
        stepIndex: 1,
        role: "execute",
        agent: "codex",
        content: "{\"unified_diff\":\"diff --git a/file.ts b/file.ts\"}",
      },
    ];

    const prompt = buildPrompt({
      step,
      task: "Review the unified diff for correctness.",
      context,
      priorOutputs,
      systemPrompt: SYSTEM_PROMPTS.review,
    });

    expect(prompt).toContain("[Step 1] execute:codex");
    expect(prompt).toContain("diff --git");
  });
});
