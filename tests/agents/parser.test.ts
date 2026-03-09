import { describe, expect, it } from "vitest";

import { extractJsonObject, parseAgentResponse } from "../../src/agents/parser.js";

describe("extractJsonObject", () => {
  it("extracts plain JSON", () => {
    const extracted = extractJsonObject("{\"rationale\":\"ok\",\"proposed_approach\":\"x\",\"confidence\":0.8,\"concerns\":[],\"suggested_tests\":[]}");
    expect(extracted).toContain("\"rationale\"");
  });

  it("extracts fenced JSON", () => {
    const extracted = extractJsonObject(
      "```json\n{\"rationale\":\"ok\",\"proposed_approach\":\"x\",\"confidence\":0.8,\"concerns\":[],\"suggested_tests\":[]}\n```",
    );
    expect(extracted).toContain("\"proposed_approach\"");
  });

  it("extracts JSON surrounded by prose", () => {
    const extracted = extractJsonObject(
      "Here is the result:\n{\"rationale\":\"ok\",\"proposed_approach\":\"x\",\"confidence\":0.8,\"concerns\":[],\"suggested_tests\":[]}\nThanks.",
    );
    expect(extracted).toContain("\"confidence\":0.8");
  });
});

describe("parseAgentResponse", () => {
  it("parses a valid architect payload", () => {
    const result = parseAgentResponse(
      "architect",
      "{\"rationale\":\"ok\",\"proposed_approach\":\"x\",\"confidence\":0.8,\"concerns\":[],\"suggested_tests\":[]}",
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      rationale: "ok",
      proposed_approach: "x",
    });
  });

  it("rejects malformed payloads", () => {
    const result = parseAgentResponse(
      "execute",
      "{\"unified_diff\":123,\"files_affected\":[],\"shell_commands\":[],\"edge_cases\":[],\"confidence\":0.5}",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("fails when no JSON object exists", () => {
    const result = parseAgentResponse("review", "No structured output here.");

    expect(result.ok).toBe(false);
    expect(result.error).toContain("No JSON object found");
  });
});
