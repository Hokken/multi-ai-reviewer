import { describe, expect, it } from "vitest";

import {
  buildClaudeArgs,
  extractClaudeResult,
} from "../../src/agents/adapters/claude.js";
import {
  buildCodexArgs,
  extractCodexLastMessage,
} from "../../src/agents/adapters/codex.js";
import {
  buildGeminiInvocation,
  extractGeminiResult,
} from "../../src/agents/adapters/gemini.js";

describe("adapter output extraction", () => {
  it("builds Claude args with an explicit model", () => {
    expect(buildClaudeArgs("claude-opus-4-6")).toEqual([
      "--print",
      "--output-format",
      "json",
      "--model",
      "claude-opus-4-6",
      "--dangerously-skip-permissions",
    ]);
  });

  it("builds Claude args", () => {
    expect(buildClaudeArgs()).toEqual([
      "--print",
      "--output-format",
      "json",
      "--dangerously-skip-permissions",
    ]);
  });

  it("extracts the Claude result field", () => {
    const output = extractClaudeResult(
      "{\"type\":\"result\",\"result\":\"{\\\"rationale\\\":\\\"ok\\\"}\"}",
    );

    expect(output).toBe("{\"rationale\":\"ok\"}");
  });

  it("extracts the Gemini response field", () => {
    const output = extractGeminiResult(
      "{\"response\":\"{\\\"verdict\\\":\\\"approve\\\"}\",\"stats\":{}}",
    );

    expect(output).toBe("{\"verdict\":\"approve\"}");
  });

  it("builds Gemini invocation", () => {
    expect(buildGeminiInvocation("review this")).toEqual({
      args: [
        "--prompt=JSON_ONLY",
        "--yolo",
        "--output-format",
        "json",
      ],
      stdin: "\n\nreview this",
    });
  });

  it("builds Gemini invocation with an explicit model", () => {
    expect(buildGeminiInvocation("review this", "gemini-3-pro-preview")).toEqual({
      args: [
        "--prompt=JSON_ONLY",
        "--model",
        "gemini-3-pro-preview",
        "--yolo",
        "--output-format",
        "json",
      ],
      stdin: "\n\nreview this",
    });
  });

  it("extracts the Gemini response field", () => {
    const output = extractGeminiResult(
      "{\"response\":\"{\\\"verdict\\\":\\\"approve\\\"}\",\"stats\":{}}",
    );

    expect(output).toBe("{\"verdict\":\"approve\"}");
  });

  it("extracts the Gemini text field fallback", () => {
    const output = extractGeminiResult(
      "{\"text\":\"{\\\"verdict\\\":\\\"approve\\\"}\",\"stats\":{}}",
    );

    expect(output).toBe("{\"verdict\":\"approve\"}");
  });

  it("extracts the last Codex message from JSONL", () => {
    const output = extractCodexLastMessage(
      [
        "{\"type\":\"turn/started\"}",
        "{\"type\":\"turn/completed\",\"last_assistant_message\":\"{\\\"unified_diff\\\":\\\"\\\"}\"}",
      ].join("\n"),
    );

    expect(output).toBe("{\"unified_diff\":\"\"}");
  });

  it("builds Codex args", () => {
    expect(
      buildCodexArgs("C:\\schema.json", "C:\\last-message.txt"),
    ).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--output-schema",
      "C:\\schema.json",
      "--output-last-message",
      "C:\\last-message.txt",
      "-",
    ]);
  });

  it("builds Codex args with an explicit model", () => {
    expect(
      buildCodexArgs("C:\\schema.json", "C:\\last-message.txt", "gpt-5.4"),
    ).toEqual([
      "exec",
      "--json",
      "--model",
      "gpt-5.4",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--output-schema",
      "C:\\schema.json",
      "--output-last-message",
      "C:\\last-message.txt",
      "-",
    ]);
  });

  it("builds Codex args with direct access flags", () => {
    expect(
      buildCodexArgs("C:\\schema.json", "C:\\last-message.txt"),
    ).toEqual([
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--output-schema",
      "C:\\schema.json",
      "--output-last-message",
      "C:\\last-message.txt",
      "-",
    ]);
  });
});
