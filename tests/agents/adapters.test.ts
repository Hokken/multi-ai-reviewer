import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildClaudeArgs,
  extractClaudeResult,
  extractClaudeTokenUsage,
} from "../../src/agents/adapters/claude.js";
import {
  buildCodexArgs,
  extractCodexLastMessage,
  extractCodexTokenUsage,
  extractCodexSessionId,
  resolveCodexSessionId,
} from "../../src/agents/adapters/codex.js";
import {
  buildGeminiInvocation,
  extractGeminiResult,
  extractGeminiTokenUsage,
  resolveGeminiSessionId,
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

  it("builds Claude args with a stable session id", () => {
    expect(buildClaudeArgs("claude-opus-4-6", {
      sessionId: "11111111-1111-4111-8111-111111111111",
    })).toEqual([
      "--print",
      "--output-format",
      "json",
      "--session-id",
      "11111111-1111-4111-8111-111111111111",
      "--model",
      "claude-opus-4-6",
      "--dangerously-skip-permissions",
    ]);
  });

  it("builds Claude resume args for a prior session", () => {
    expect(buildClaudeArgs("claude-opus-4-6", {
      sessionId: "11111111-1111-4111-8111-111111111111",
      resume: true,
    })).toEqual([
      "--print",
      "--output-format",
      "json",
      "--resume",
      "11111111-1111-4111-8111-111111111111",
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

  it("extracts Claude token usage", () => {
    const usage = extractClaudeTokenUsage(
      "{\"type\":\"result\",\"usage\":{\"input_tokens\":2,\"cache_creation_input_tokens\":10,\"cache_read_input_tokens\":20,\"output_tokens\":5}}",
    );

    expect(usage).toEqual({
      inputTokens: 2,
      outputTokens: 5,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 10,
      totalTokens: 37,
    });
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

  it("builds Gemini invocation with a resume session id", () => {
    expect(
      buildGeminiInvocation(
        "review this",
        "gemini-3-pro-preview",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toEqual({
      args: [
        "--prompt=JSON_ONLY",
        "--model",
        "gemini-3-pro-preview",
        "--resume",
        "11111111-1111-4111-8111-111111111111",
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

  it("extracts Gemini token usage across models", () => {
    const usage = extractGeminiTokenUsage(
      JSON.stringify({
        stats: {
          models: {
            "gemini-a": {
              tokens: {
                input: 100,
                candidates: 20,
                cached: 5,
                thoughts: 7,
                tool: 1,
                total: 133,
              },
            },
            "gemini-b": {
              tokens: {
                input: 50,
                candidates: 10,
                cached: 2,
                thoughts: 3,
                tool: 0,
                total: 65,
              },
            },
          },
        },
      }),
    );

    expect(usage).toEqual({
      inputTokens: 150,
      outputTokens: 30,
      cachedInputTokens: 7,
      thoughtTokens: 10,
      toolTokens: 1,
      totalTokens: 198,
    });
  });

  it("resolves the latest Gemini session id for the current project", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "mrev-gemini-home-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const cwd = join(tempHome, "repo");

    try {
      process.env.HOME = tempHome;
      process.env.USERPROFILE = tempHome;
      await mkdir(cwd, { recursive: true });
      await mkdir(join(tempHome, ".gemini", "tmp", "repo-alpha", "chats"), { recursive: true });
      await writeFile(
        join(tempHome, ".gemini", "tmp", "repo-alpha", ".project_root"),
        cwd,
        "utf8",
      );
      await writeFile(
        join(tempHome, ".gemini", "tmp", "repo-alpha", "chats", "session-1.json"),
        JSON.stringify({
          sessionId: "11111111-1111-4111-8111-111111111111",
          startTime: "2026-03-19T18:00:00.000Z",
          lastUpdated: "2026-03-19T18:01:00.000Z",
        }),
        "utf8",
      );
      await writeFile(
        join(tempHome, ".gemini", "tmp", "repo-alpha", "chats", "session-2.json"),
        JSON.stringify({
          sessionId: "22222222-2222-4222-8222-222222222222",
          startTime: "2026-03-19T18:02:00.000Z",
          lastUpdated: "2026-03-19T18:03:00.000Z",
        }),
        "utf8",
      );

      const sessionId = await resolveGeminiSessionId(
        cwd,
        new Date("2026-03-19T18:01:30.000Z"),
      );

      expect(sessionId).toBe("22222222-2222-4222-8222-222222222222");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      await rm(tempHome, { recursive: true, force: true });
    }
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

  it("extracts the Codex session id from JSONL events", () => {
    const sessionId = extractCodexSessionId(
      [
        "{\"type\":\"session/started\",\"session_id\":\"11111111-1111-4111-8111-111111111111\"}",
        "{\"type\":\"turn/completed\",\"last_assistant_message\":\"{\\\"unified_diff\\\":\\\"\\\"}\"}",
      ].join("\n"),
    );

    expect(sessionId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("extracts Codex token usage from JSONL events", () => {
    const usage = extractCodexTokenUsage(
      [
        "{\"type\":\"turn.started\"}",
        "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":100,\"cached_input_tokens\":25,\"output_tokens\":7}}",
      ].join("\n"),
    );

    expect(usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 7,
      totalTokens: 132,
    });
  });

  it("resolves the latest Codex session id for the current project", async () => {
    const tempHome = await mkdtemp(join(tmpdir(), "mrev-codex-home-"));
    const previousHome = process.env.HOME;
    const previousUserProfile = process.env.USERPROFILE;
    const cwd = join(tempHome, "repo");
    const firstSessionDir = join(tempHome, ".codex", "sessions", "2026", "03", "19");

    try {
      process.env.HOME = tempHome;
      process.env.USERPROFILE = tempHome;
      await mkdir(cwd, { recursive: true });
      await mkdir(firstSessionDir, { recursive: true });
      await writeFile(
        join(firstSessionDir, "first.jsonl"),
        [
          JSON.stringify({
            type: "session_meta",
            payload: {
              id: "11111111-1111-4111-8111-111111111111",
              cwd,
              timestamp: "2026-03-19T18:00:00.000Z",
            },
          }),
          JSON.stringify({ type: "turn/completed" }),
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        join(firstSessionDir, "second.jsonl"),
        [
          JSON.stringify({
            type: "session_meta",
            payload: {
              id: "22222222-2222-4222-8222-222222222222",
              cwd,
              timestamp: "2026-03-19T18:03:00.000Z",
            },
          }),
          JSON.stringify({ type: "turn/completed" }),
        ].join("\n"),
        "utf8",
      );

      const sessionId = await resolveCodexSessionId(
        cwd,
        new Date("2026-03-19T18:01:30.000Z"),
      );

      expect(sessionId).toBe("22222222-2222-4222-8222-222222222222");
    } finally {
      process.env.HOME = previousHome;
      process.env.USERPROFILE = previousUserProfile;
      await rm(tempHome, { recursive: true, force: true });
    }
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

  it("builds Codex resume args when a prior session id is available", () => {
    expect(
      buildCodexArgs(
        "C:\\schema.json",
        "C:\\last-message.txt",
        "gpt-5.4",
        "11111111-1111-4111-8111-111111111111",
      ),
    ).toEqual([
      "exec",
      "resume",
      "--json",
      "--model",
      "gpt-5.4",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "--output-last-message",
      "C:\\last-message.txt",
      "11111111-1111-4111-8111-111111111111",
      "-",
    ]);
  });
});
