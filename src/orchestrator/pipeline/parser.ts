import type { AgentId, ParsedPipeline, PipelineGroup, PipelineStep, RoleId } from "../../types/index.js";

export class PipelineParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PipelineParseError";
  }
}

const VALID_ROLES = new Set<RoleId>([
  "architect",
  "execute",
  "review",
  "revise",
  "summarise",
]);

const VALID_AGENTS = new Set<AgentId>(["claude", "codex", "gemini"]);

export function parsePipeline(rawPipeline: string): ParsedPipeline {
  const trimmed = rawPipeline.trim();

  if (trimmed.length === 0) {
    throw new PipelineParseError("Pipeline cannot be empty.");
  }

  const groupStrings = trimmed
    .split(">")
    .map((group) => group.trim())
    .filter((group) => group.length > 0);

  if (groupStrings.length === 0) {
    throw new PipelineParseError("Pipeline must contain at least one step.");
  }

  const groups: PipelineGroup[] = groupStrings.map((groupString, groupIndex) => ({
    index: groupIndex,
    steps: parseGroup(groupString),
  }));

  return {
    raw: rawPipeline,
    groups,
  };
}

function parseGroup(groupString: string): PipelineStep[] {
  const stepStrings = groupString
    .split("|")
    .map((step) => step.trim())
    .filter((step) => step.length > 0);

  if (stepStrings.length === 0) {
    throw new PipelineParseError(`Pipeline group "${groupString}" does not contain any steps.`);
  }

  return stepStrings.map((rawStep) => parseStep(rawStep));
}

function parseStep(rawStep: string): PipelineStep {
  const match = /^(?<role>[a-z]+):(?<agent>[a-z]+)$/.exec(rawStep);

  if (!match?.groups) {
    throw new PipelineParseError(
      `Invalid step "${rawStep}". Expected the form "role:agent".`,
    );
  }

  const role = match.groups.role as RoleId;
  const agent = match.groups.agent as AgentId;

  if (!VALID_ROLES.has(role)) {
    throw new PipelineParseError(
      `Unknown role "${role}". Valid roles: architect, execute, review, revise, summarise.`,
    );
  }

  if (!VALID_AGENTS.has(agent)) {
    throw new PipelineParseError(
      `Unknown agent "${agent}". Valid agents: claude, codex, gemini.`,
    );
  }

  return {
    role,
    agent,
    raw: rawStep,
  };
}

