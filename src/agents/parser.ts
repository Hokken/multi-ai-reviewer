import type { z } from "zod";

import { getRoleOutputSchema } from "../roles/index.js";
import type { ParsedAgentResponse, RoleId } from "../types/index.js";

export function parseAgentResponse<TRole extends RoleId>(
  role: TRole,
  rawOutput: string,
): ParsedAgentResponse<z.infer<ReturnType<typeof getRoleOutputSchema>>> {
  const extractedJson = extractJsonObject(rawOutput);

  if (!extractedJson) {
    return {
      ok: false,
      data: null,
      extractedJson: null,
      error: "No JSON object found in agent output.",
    };
  }

  let parsedUnknown: unknown;
  try {
    parsedUnknown = JSON.parse(extractedJson);
  } catch (error) {
    return {
      ok: false,
      data: null,
      extractedJson,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const schema = getRoleOutputSchema(role);
  const result = schema.safeParse(parsedUnknown);

  if (!result.success) {
    return {
      ok: false,
      data: null,
      extractedJson,
      error: result.error.message,
    };
  }

  return {
    ok: true,
    data: result.data,
    extractedJson,
    error: null,
  };
}

export function extractJsonObject(rawOutput: string): string | null {
  const withoutFences = stripCodeFences(rawOutput).trim();
  const startIndex = withoutFences.indexOf("{");

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < withoutFences.length; index += 1) {
    const character = withoutFences[index];

    if (!character) {
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (character === "\\") {
      escaped = true;
      continue;
    }

    if (character === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return withoutFences.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function stripCodeFences(rawOutput: string): string {
  const trimmed = rawOutput.trim();
  const fenceMatch = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenceMatch?.[1] ?? trimmed;
}

