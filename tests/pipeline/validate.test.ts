import { describe, expect, it } from "vitest";

import { parsePipeline, PipelineParseError } from "../../src/orchestrator/pipeline/parser.js";
import { validatePipeline } from "../../src/orchestrator/pipeline/validator.js";

describe("parsePipeline", () => {
  it("parses a valid single-step pipeline", () => {
    const pipeline = parsePipeline("execute:codex");

    expect(pipeline.groups).toHaveLength(1);
    expect(pipeline.groups[0]?.steps).toHaveLength(1);
    expect(pipeline.groups[0]?.steps[0]).toMatchObject({
      role: "execute",
      agent: "codex",
    });
  });

  it("parses parallel groups", () => {
    const pipeline = parsePipeline("architect:claude | architect:gemini > execute:codex");

    expect(pipeline.groups).toHaveLength(2);
    expect(pipeline.groups[0]?.steps).toHaveLength(2);
    expect(pipeline.groups[1]?.steps).toHaveLength(1);
  });

  it("throws on unknown roles", () => {
    expect(() => parsePipeline("audit:claude")).toThrowError(PipelineParseError);
  });
});

describe("validatePipeline", () => {
  it("accepts a minimal execute-only pipeline with a warning", () => {
    const result = validatePipeline(parsePipeline("execute:codex"));

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "no_architect_before_execute",
    );
  });

  it("rejects duplicate agents in the same parallel group", () => {
    const result = validatePipeline(
      parsePipeline("review:claude | architect:claude > execute:codex"),
    );

    expect(result.errors.map((error) => error.code)).toContain(
      "duplicate_agent_in_parallel_group",
    );
  });

  it("warns on same-agent sequential review", () => {
    const result = validatePipeline(
      parsePipeline("execute:codex > review:gemini > review:gemini"),
    );

    expect(result.errors).toHaveLength(0);
    expect(result.warnings.map((warning) => warning.code)).toContain(
      "same_agent_sequential_review",
    );
  });
});
