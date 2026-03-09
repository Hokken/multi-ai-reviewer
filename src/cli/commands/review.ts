import { runRunCommand } from "./run.js";
import { access, readFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { basename, relative, resolve } from "node:path";

import type { AgentId } from "../../types/index.js";
import { getReportPathPattern, getReportPathScanner } from "../../config/storage.js";

const ALL_AGENTS: AgentId[] = ["claude", "codex", "gemini"];
const REPO_INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"] as const;
const PLAN_REVIEW_SIGNALS = [
  "implementation plan",
  "test matrix",
  "milestone",
  "phase 1",
  "phase 2",
  "phase 3",
  "pipeline",
  "architecture context",
] as const;
const INVESTIGATION_REVIEW_SIGNALS = [
  "investigation",
  "problem statement",
  "constraints",
  "unknowns",
  "candidate approaches",
  "open questions",
  "findings",
] as const;
const IMPLEMENTATION_REVIEW_SIGNALS = [
  "changed files",
  "review checklist",
  "potential concerns",
  "testing steps",
  "files to read",
  "fixes applied",
  "staged diff",
] as const;

export type ReviewWorkflowKind = "investigation" | "plan" | "implementation";

export interface ReviewFileAnalysis {
  mode: ReviewWorkflowKind;
  validationPass: boolean;
  detectedAuthor?: AgentId | undefined;
}

export interface ReviewWorkflowOptions {
  reviewers?: AgentId[] | undefined;
  reviewerModels?: Partial<Record<AgentId, string | undefined>> | undefined;
  instructions?: string | undefined;
  claudeModel?: string | undefined;
  codexModel?: string | undefined;
  geminiModel?: string | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
  verbose?: boolean | undefined;
  geminiStrict?: boolean | undefined;
  dryRun?: boolean | undefined;
  extraFiles?: string[] | undefined;
}

export interface AutoReviewWorkflowOptions
  extends ReviewWorkflowOptions {
  mode?: ReviewWorkflowKind | undefined;
}

export interface PreparedReviewWorkflow {
  kind: ReviewWorkflowKind;
  task: string;
  pipeline: string;
  files: string[];
  reviewers: AgentId[];
  validationPass: boolean;
  hasPriorReportContext: boolean;
  missingReferencedReports: string[];
  modelOverrides: {
    claudeModel?: string | undefined;
    codexModel?: string | undefined;
    geminiModel?: string | undefined;
  };
}

export async function runAutoReviewCommand(
  reviewFile: string,
  options: AutoReviewWorkflowOptions,
): Promise<number> {
  const analysis = await analyzeReviewFile(reviewFile, options.mode, process.cwd());

  const suffix = analysis.validationPass ? " (validation pass detected)" : "";
  process.stdout.write(`Detected review mode: ${analysis.mode}${suffix}\n`);
  process.stdout.write(`${formatReviewArtifactLine(reviewFile)}\n`);

  if (analysis.mode === "plan") {
    return runPlanReviewCommand(reviewFile, options);
  }

  if (analysis.mode === "investigation") {
    return runInvestigationReviewCommand(reviewFile, options);
  }

  return runImplementationReviewCommand(reviewFile, options);
}

export function formatReviewArtifactLine(reviewFile: string): string {
  return `File: ${reviewFile}`;
}

export async function runInvestigationReviewCommand(
  investigationFile: string,
  options: ReviewWorkflowOptions,
): Promise<number> {
  const prepared = await prepareInvestigationReviewWorkflow(
    process.cwd(),
    investigationFile,
    options,
  );
  return runRunCommand(
    buildRunOptions({
      task: prepared.task,
      pipeline: prepared.pipeline,
      files: prepared.files,
      repoSummary: options.repoSummary,
      techStack: options.techStack,
      claudeModel: prepared.modelOverrides.claudeModel,
      codexModel: prepared.modelOverrides.codexModel,
      geminiModel: prepared.modelOverrides.geminiModel,
      verbose: options.verbose,
      geminiStrict: options.geminiStrict,
      dryRun: options.dryRun,
      interactiveProgress: false,
    }),
  );
}

export async function runPlanReviewCommand(
  planFile: string,
  options: ReviewWorkflowOptions,
): Promise<number> {
  const prepared = await preparePlanReviewWorkflow(process.cwd(), planFile, options);
  return runRunCommand(
    buildRunOptions({
      task: prepared.task,
      pipeline: prepared.pipeline,
      files: prepared.files,
      repoSummary: options.repoSummary,
      techStack: options.techStack,
      claudeModel: prepared.modelOverrides.claudeModel,
      codexModel: prepared.modelOverrides.codexModel,
      geminiModel: prepared.modelOverrides.geminiModel,
      verbose: options.verbose,
      geminiStrict: options.geminiStrict,
      dryRun: options.dryRun,
      interactiveProgress: false,
    }),
  );
}

export async function runImplementationReviewCommand(
  instructionsFile: string,
  options: ReviewWorkflowOptions,
): Promise<number> {
  const prepared = await prepareImplementationReviewWorkflow(
    process.cwd(),
    instructionsFile,
    options,
  );
  if (prepared.missingReferencedReports.length > 0) {
    process.stdout.write(
      `Warning: referenced prior review report(s) were not found: ${prepared.missingReferencedReports.join(", ")}\n`,
    );
  }
  return runRunCommand(
    buildRunOptions({
      task: prepared.task,
      pipeline: prepared.pipeline,
      files: prepared.files,
      diff: true,
      repoSummary: options.repoSummary,
      techStack: options.techStack,
      claudeModel: prepared.modelOverrides.claudeModel,
      codexModel: prepared.modelOverrides.codexModel,
      geminiModel: prepared.modelOverrides.geminiModel,
      verbose: options.verbose,
      geminiStrict: options.geminiStrict,
      dryRun: options.dryRun,
      interactiveProgress: false,
    }),
  );
}

export function resolveReviewers(
  reviewers?: AgentId[] | undefined,
  reviewerModels?: Partial<Record<AgentId, string | undefined>> | undefined,
): AgentId[] {
  const resolved = reviewers && reviewers.length > 0
    ? reviewers
    : reviewerModels
      ? Object.entries(reviewerModels)
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
        .map(([agent]) => parseAgentId(agent))
      : ALL_AGENTS;

  const unique = Array.from(new Set(resolved));

  if (unique.length === 0) {
    throw new Error("At least one reviewer is required.");
  }

  return unique;
}

export function buildParallelReviewPipeline(reviewers: AgentId[]): string {
  return reviewers.map((reviewer) => `review:${reviewer}`).join(" | ");
}

export async function preparePlanReviewWorkflow(
  cwd: string,
  planFile: string,
  options: ReviewWorkflowOptions,
): Promise<PreparedReviewWorkflow> {
  const modelOverrides = resolveReviewerModelOverrides(options);
  const reviewers = resolveReviewers(
    options.reviewers,
    options.reviewerModels,
  );
  assertExplicitReviewerModels(reviewers, modelOverrides);
  const analysis = await analyzeReviewFile(planFile, "plan", cwd);
  const workflowContext = await resolveReviewWorkflowContext(
    cwd,
    planFile,
    options.extraFiles,
    analysis.validationPass,
  );

  return {
    kind: "plan",
    task: buildPlanReviewTask(
      planFile,
      analysis.detectedAuthor,
      options.instructions,
      analysis.validationPass,
      workflowContext.hasPriorReportContext,
    ),
    pipeline: buildParallelReviewPipeline(reviewers),
    files: workflowContext.files,
    reviewers,
    validationPass: analysis.validationPass,
    hasPriorReportContext: workflowContext.hasPriorReportContext,
    missingReferencedReports: workflowContext.missingReferencedReports,
    modelOverrides,
  };
}

export async function prepareInvestigationReviewWorkflow(
  cwd: string,
  investigationFile: string,
  options: ReviewWorkflowOptions,
): Promise<PreparedReviewWorkflow> {
  const modelOverrides = resolveReviewerModelOverrides(options);
  const reviewers = resolveReviewers(
    options.reviewers,
    options.reviewerModels,
  );
  assertExplicitReviewerModels(reviewers, modelOverrides);
  const analysis = await analyzeReviewFile(investigationFile, "investigation", cwd);
  const workflowContext = await resolveReviewWorkflowContext(
    cwd,
    investigationFile,
    options.extraFiles,
    analysis.validationPass,
  );

  return {
    kind: "investigation",
    task: buildInvestigationReviewTask(
      investigationFile,
      analysis.detectedAuthor,
      options.instructions,
      analysis.validationPass,
      workflowContext.hasPriorReportContext,
    ),
    pipeline: buildParallelReviewPipeline(reviewers),
    files: workflowContext.files,
    reviewers,
    validationPass: analysis.validationPass,
    hasPriorReportContext: workflowContext.hasPriorReportContext,
    missingReferencedReports: workflowContext.missingReferencedReports,
    modelOverrides,
  };
}

export async function prepareImplementationReviewWorkflow(
  cwd: string,
  instructionsFile: string,
  options: ReviewWorkflowOptions,
): Promise<PreparedReviewWorkflow> {
  const modelOverrides = resolveReviewerModelOverrides(options);
  const reviewers = resolveReviewers(
    options.reviewers,
    options.reviewerModels,
  );
  assertExplicitReviewerModels(reviewers, modelOverrides);
  const analysis = await analyzeReviewFile(instructionsFile, "implementation", cwd);
  const workflowContext = await resolveReviewWorkflowContext(
    cwd,
    instructionsFile,
    options.extraFiles,
    analysis.validationPass,
  );

  return {
    kind: "implementation",
    task: buildImplementationReviewTask(
      instructionsFile,
      analysis.detectedAuthor,
      options.instructions,
      analysis.validationPass,
      workflowContext.hasPriorReportContext,
    ),
    pipeline: buildParallelReviewPipeline(reviewers),
    files: workflowContext.files,
    reviewers,
    validationPass: analysis.validationPass,
    hasPriorReportContext: workflowContext.hasPriorReportContext,
    missingReferencedReports: workflowContext.missingReferencedReports,
    modelOverrides,
  };
}

export function buildPlanReviewTask(
  planFile: string,
  author?: AgentId | undefined,
  instructions?: string | undefined,
  validationPass?: boolean | undefined,
  hasPriorReportContext?: boolean | undefined,
): string {
  const parts = [
    validationPass
      ? `Validate the applied fixes in the implementation plan "${planFile}".`
      : `Review the implementation plan in "${planFile}".`,
    formatAuthorDescription("plan", author),
    hasPriorReportContext
      ? "One or more prior review reports are also included in context. Use them to preserve reviewer context across passes and verify whether each earlier finding was fully addressed."
      : undefined,
    validationPass
      ? "Start with the FIXES APPLIED section. Verify each listed fix against the plan and the related prior findings before raising anything new."
      : "Assess whether the plan is sound, feasible, properly sequenced, and complete.",
    validationPass
      ? "Only raise new issues when a claimed fix is incomplete, introduces a regression, or reveals a directly related gap in the same area."
      : "Look for missing assumptions, hidden risks, unrealistic sequencing, weak validation strategy, and testing gaps.",
    "Return structured review JSON only.",
  ].filter((part): part is string => Boolean(part));
  return appendInstructions(parts, instructions);
}

export function buildInvestigationReviewTask(
  investigationFile: string,
  author?: AgentId | undefined,
  instructions?: string | undefined,
  validationPass?: boolean | undefined,
  hasPriorReportContext?: boolean | undefined,
): string {
  const parts = [
    validationPass
      ? `Validate the applied fixes in the investigation "${investigationFile}".`
      : `Review the investigation in "${investigationFile}".`,
    formatAuthorDescription("investigation", author),
    hasPriorReportContext
      ? "One or more prior review reports are also included in context. Use them to preserve reviewer context across passes and verify whether each earlier finding was fully addressed."
      : undefined,
    validationPass
      ? "Start with the FIXES APPLIED section. Verify each listed fix against the investigation and the related prior findings before raising anything new."
      : "Assess whether the investigation frames the problem correctly, captures constraints, identifies meaningful unknowns, and explores plausible approaches.",
    validationPass
      ? "A populated FIXES APPLIED section was detected. Treat this as a validation pass and explicitly verify whether each listed fix is correctly reflected in the investigation."
      : "If the investigation file contains a FIXES APPLIED section, treat this as a validation pass and explicitly verify whether each listed fix appears correctly reflected.",
    validationPass
      ? "Only raise new issues when a claimed fix is incomplete, introduces a regression, or reveals a directly related gap in the same area."
      : "Look for weak assumptions, missing constraints, blind spots, and unclear decision framing.",
    "Return structured review JSON only.",
  ].filter((part): part is string => Boolean(part));
  return appendInstructions(parts, instructions);
}

export function buildImplementationReviewTask(
  instructionsFile: string,
  author?: AgentId | undefined,
  instructions?: string | undefined,
  validationPass?: boolean | undefined,
  hasPriorReportContext?: boolean | undefined,
): string {
  const parts = [
    validationPass
      ? `Validate the applied fixes using the review instructions file "${instructionsFile}".`
      : `Review the implementation using the review instructions file "${instructionsFile}".`,
    formatAuthorDescription("implementation", author),
    "Use the instructions file plus the current staged diff when available.",
    hasPriorReportContext
      ? "One or more prior review reports are also included in context. Use them to preserve reviewer context across passes and verify whether each earlier finding was fully addressed."
      : undefined,
    validationPass
      ? "Start with the FIXES APPLIED section. Verify each listed fix against the actual diff and the related prior findings before raising anything new."
      : "Audit correctness, regressions, spec drift, missing tests, and operational risk.",
    validationPass
      ? "A populated FIXES APPLIED section was detected. Treat this as a validation pass and explicitly verify whether each listed fix is correctly implemented."
      : "If the review instructions file contains a FIXES APPLIED section, treat this as a validation pass and explicitly verify whether each listed fix appears correctly implemented.",
    validationPass
      ? "Only raise new issues when a claimed fix is incomplete, introduces a regression, or reveals a directly related gap in the same area."
      : undefined,
    "Return structured review JSON only.",
  ].filter((part): part is string => Boolean(part));

  return appendInstructions(parts, instructions);
}

export function coerceReviewWorkflowOptions(input: {
  reviewers?: string[] | undefined;
  reviewerModels?: string[] | undefined;
  instructions?: string | undefined;
  claudeModel?: string | undefined;
  codexModel?: string | undefined;
  geminiModel?: string | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
  verbose?: boolean | undefined;
  geminiStrict?: boolean | undefined;
  dryRun?: boolean | undefined;
  files?: string[] | undefined;
}): ReviewWorkflowOptions {
  return {
    reviewers: input.reviewers?.map(parseAgentId),
    reviewerModels: parseReviewerModelEntries(input.reviewerModels),
    instructions: normalizeInstructions(input.instructions),
    claudeModel: normalizeInstructions(input.claudeModel),
    codexModel: normalizeInstructions(input.codexModel),
    geminiModel: normalizeInstructions(input.geminiModel),
    repoSummary: input.repoSummary,
    techStack: input.techStack,
    verbose: input.verbose,
    geminiStrict: input.geminiStrict,
    dryRun: input.dryRun,
    extraFiles: input.files,
  };
}

export function coerceAutoReviewWorkflowOptions(input: {
  reviewers?: string[] | undefined;
  reviewerModels?: string[] | undefined;
  instructions?: string | undefined;
  mode?: string | undefined;
  claudeModel?: string | undefined;
  codexModel?: string | undefined;
  geminiModel?: string | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
  verbose?: boolean | undefined;
  geminiStrict?: boolean | undefined;
  dryRun?: boolean | undefined;
  files?: string[] | undefined;
}): AutoReviewWorkflowOptions {
  return {
    reviewers: input.reviewers?.map(parseAgentId),
    reviewerModels: parseReviewerModelEntries(input.reviewerModels),
    instructions: normalizeInstructions(input.instructions),
    mode: input.mode ? parseReviewWorkflowMode(input.mode) : undefined,
    claudeModel: normalizeInstructions(input.claudeModel),
    codexModel: normalizeInstructions(input.codexModel),
    geminiModel: normalizeInstructions(input.geminiModel),
    repoSummary: input.repoSummary,
    techStack: input.techStack,
    verbose: input.verbose,
    geminiStrict: input.geminiStrict,
    dryRun: input.dryRun,
    extraFiles: input.files,
  };
}

export async function resolveReviewWorkflowFiles(
  cwd: string,
  primaryFile: string,
  extraFiles?: string[] | undefined,
  input?: {
    validationPass?: boolean | undefined;
  } | undefined,
): Promise<string[]> {
  const workflowContext = await resolveReviewWorkflowContext(
    cwd,
    primaryFile,
    extraFiles,
    input?.validationPass ?? false,
  );
  return workflowContext.files;
}

export async function resolveReviewWorkflowContext(
  cwd: string,
  primaryFile: string,
  extraFiles?: string[] | undefined,
  validationPass = false,
): Promise<{
  files: string[];
  hasPriorReportContext: boolean;
  missingReferencedReports: string[];
}> {
  const repoInstructionFiles = await findRepoInstructionFiles(cwd);
  const referencedReports = validationPass
    ? await resolveReferencedValidationReports(cwd, primaryFile)
    : {
      found: [],
      missing: [],
    };
  const prioritizedReports = validationPass
    ? [...referencedReports.found].reverse()
    : referencedReports.found;
  const combined = [
    primaryFile,
    ...repoInstructionFiles,
    ...prioritizedReports,
    ...(extraFiles ?? []),
  ];
  return {
    files: Array.from(new Set(combined)),
    hasPriorReportContext: referencedReports.found.length > 0,
    missingReferencedReports: referencedReports.missing,
  };
}

export async function analyzeReviewFile(
  reviewFile: string,
  forcedMode?: ReviewWorkflowKind | undefined,
  cwd = process.cwd(),
): Promise<ReviewFileAnalysis> {
  const content = await readReviewFile(reviewFile, cwd);

  return {
    mode: forcedMode ?? detectReviewWorkflowMode(reviewFile, content),
    validationPass: detectValidationPass(content),
    detectedAuthor: detectAuthoringAgent(content),
  };
}

export function detectReviewWorkflowMode(
  reviewFile: string,
  content: string,
): ReviewWorkflowKind {
  const normalized = content.toLowerCase();
  const investigationScore = countSignals(normalized, INVESTIGATION_REVIEW_SIGNALS);
  const planScore = countSignals(normalized, PLAN_REVIEW_SIGNALS);
  const implementationScore = countSignals(normalized, IMPLEMENTATION_REVIEW_SIGNALS);

  if (investigationScore > planScore && investigationScore > implementationScore) {
    return "investigation";
  }

  if (planScore > implementationScore) {
    return "plan";
  }

  if (implementationScore > planScore) {
    return "implementation";
  }

  const fileName = basename(reviewFile).toLowerCase();
  if (fileName.includes("investigation")) {
    return "investigation";
  }

  if (fileName.includes("plan")) {
    return "plan";
  }

  if (fileName.includes("review")) {
    return "implementation";
  }

  throw new Error(
    `Unable to infer review mode for "${reviewFile}". Use --mode plan or --mode implementation.`,
  );
}

export function detectValidationPass(content: string): boolean {
  const lines = content.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^\s*#+\s*FIXES APPLIED\b/i.test(line));
  if (headingIndex === -1) {
    return false;
  }

  const headingMatch = lines[headingIndex]?.match(/^\s*(#+)\s*/);
  const sectionHeadingLevel = headingMatch?.[1]?.length ?? 2;
  const sectionLines: string[] = [];
  for (let index = headingIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextHeadingMatch = line.match(/^\s*(#+)\s+\S/);
    if (nextHeadingMatch?.[1] && nextHeadingMatch[1].length <= sectionHeadingLevel) {
      break;
    }
    sectionLines.push(line);
  }

  const section = sectionLines.join("\n");
  if (/####\s*Fix\b/i.test(section)) {
    return true;
  }

  if (/intentionally empty|first pass/i.test(section)) {
    return false;
  }

  return section
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line.length > 20);
}

export function detectAuthoringAgent(content: string): AgentId | undefined {
  const patterns = [
    /author(?:ing)?(?:\s+(?:agent|model))?\s*[:\-]\s*(claude|codex|gemini)\b/i,
    /the (?:plan|implementation) was authored by\s+(claude|codex|gemini)\b/i,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match?.[1]) {
      return parseAgentId(match[1]);
    }
  }

  return undefined;
}

export function detectReferencedReviewReports(content: string): string[] {
  const matches = content.match(getReportPathScanner()) ?? [];

  return Array.from(new Set(matches));
}

function parseAgentId(value: string): AgentId {
  if (ALL_AGENTS.includes(value as AgentId)) {
    return value as AgentId;
  }

  throw new Error(`Unknown agent "${value}". Valid agents: ${ALL_AGENTS.join(", ")}.`);
}

function parseReviewWorkflowMode(value: string): ReviewWorkflowKind {
  if (value === "investigation" || value === "plan" || value === "implementation") {
    return value;
  }

  throw new Error(`Unknown review mode "${value}". Valid modes: investigation, plan, implementation.`);
}

function parseReviewerModelEntries(
  entries?: string[] | undefined,
): Partial<Record<AgentId, string | undefined>> | undefined {
  if (!entries || entries.length === 0) {
    return undefined;
  }

  const parsed: Partial<Record<AgentId, string | undefined>> = {};

  for (const entry of entries) {
    const match = /^(claude|codex|gemini)=(.+)$/.exec(entry.trim());
    if (!match?.[1] || !match[2]) {
      throw new Error(
        `Invalid reviewer model "${entry}". Expected agent=model, for example claude=claude-sonnet-4-6.`,
      );
    }

    parsed[parseAgentId(match[1])] = normalizeInstructions(match[2]);
  }

  return parsed;
}

function formatAuthorDescription(
  artifact: "investigation" | "plan" | "implementation",
  author?: AgentId | undefined,
): string | undefined {
  if (!author) {
    return undefined;
  }

  return `The ${artifact} was authored by ${author}.`;
}

function appendInstructions(
  parts: string[],
  instructions?: string | undefined,
): string {
  const normalized = normalizeInstructions(instructions);
  if (!normalized) {
    return parts.join(" ");
  }

  return [...parts, `Additional review instructions: ${normalized}`].join(" ");
}

function normalizeInstructions(value?: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function findRepoInstructionFiles(cwd: string): Promise<string[]> {
  const found: string[] = [];

  for (const fileName of REPO_INSTRUCTION_FILES) {
    const absolutePath = resolve(cwd, fileName);
    try {
      await access(absolutePath, fsConstants.F_OK);
      found.push(fileName);
    } catch {
      continue;
    }
  }

  return found;
}

async function resolveReferencedValidationReports(
  cwd: string,
  reviewFile: string,
): Promise<{
  found: string[];
  missing: string[];
}> {
  const content = await readReviewFile(reviewFile, cwd);
  const references = detectReferencedReviewReports(content);
  const found: string[] = [];
  const missing: string[] = [];

  for (const reference of references) {
    const absolutePath = resolve(cwd, reference);
    try {
      await access(absolutePath, fsConstants.F_OK);
      found.push(relative(cwd, absolutePath).replaceAll("\\", "/"));
    } catch {
      missing.push(reference);
      continue;
    }
  }

  return {
    found,
    missing,
  };
}

async function readReviewFile(reviewFile: string, cwd: string): Promise<string> {
  const absolutePath = resolve(cwd, reviewFile);
  return readFile(absolutePath, "utf8");
}

function isReferencedReviewReportPath(filePath: string): boolean {
  return getReportPathPattern().test(filePath);
}

function countSignals(normalized: string, signals: readonly string[]): number {
  return signals.reduce(
    (count, signal) => count + (normalized.includes(signal) ? 1 : 0),
    0,
  );
}

function resolveReviewerModelOverrides(
  options: ReviewWorkflowOptions,
): PreparedReviewWorkflow["modelOverrides"] {
  return {
    claudeModel: options.reviewerModels?.claude ?? options.claudeModel,
    codexModel: options.reviewerModels?.codex ?? options.codexModel,
    geminiModel: options.reviewerModels?.gemini ?? options.geminiModel,
  };
}

function assertExplicitReviewerModels(
  reviewers: AgentId[],
  modelOverrides: PreparedReviewWorkflow["modelOverrides"],
): void {
  const missing = reviewers.filter((reviewer) => {
    if (reviewer === "claude") {
      return !modelOverrides.claudeModel;
    }
    if (reviewer === "codex") {
      return !modelOverrides.codexModel;
    }
    return !modelOverrides.geminiModel;
  });

  if (missing.length === 0) {
    return;
  }

  throw new Error(
    "Review runs require explicit reviewer models. " +
    `Missing model selection for: ${missing.join(", ")}. ` +
    "Use --reviewer-models agent=model or the matching --claude-model/--codex-model/--gemini-model flags.",
  );
}

function buildRunOptions(input: {
  task: string;
  pipeline: string;
  files: string[];
  diff?: boolean | undefined;
  repoSummary?: string | undefined;
  techStack?: string[] | undefined;
  claudeModel?: string | undefined;
  codexModel?: string | undefined;
  geminiModel?: string | undefined;
  verbose?: boolean | undefined;
  geminiStrict?: boolean | undefined;
  dryRun?: boolean | undefined;
  interactiveProgress?: boolean | undefined;
}) {
  return {
    task: input.task,
    pipeline: input.pipeline,
    files: input.files,
    reportOnly: true,
    ...(input.interactiveProgress !== undefined
      ? { interactiveProgress: input.interactiveProgress }
      : {}),
    ...(input.diff ? { diff: true } : {}),
    ...(input.repoSummary ? { repoSummary: input.repoSummary } : {}),
    ...(input.techStack ? { techStack: input.techStack } : {}),
    ...(input.claudeModel ? { claudeModel: input.claudeModel } : {}),
    ...(input.codexModel ? { codexModel: input.codexModel } : {}),
    ...(input.geminiModel ? { geminiModel: input.geminiModel } : {}),
    ...(input.verbose ? { verbose: true } : {}),
    ...(input.geminiStrict ? { geminiStrict: true } : {}),
    ...(input.dryRun ? { dryRun: true } : {}),
  };
}
