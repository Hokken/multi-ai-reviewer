import { access, readFile, readdir } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as readline from "node:readline";
import { extname, relative, resolve } from "node:path";

import {
  getRepoLocalConfigPath,
  loadRepoReviewLauncherConfig,
  loadProjectConfig,
  resolveAgentModels,
  saveRepoReviewLauncherLastUsed,
} from "../config/project.js";
import {
  analyzeReviewFile,
  prepareInvestigationReviewWorkflow,
  prepareImplementationReviewWorkflow,
  preparePlanReviewWorkflow,
  runAutoReviewCommand,
  type AutoReviewWorkflowOptions,
  type PreparedReviewWorkflow,
} from "./commands/review.js";

import type { Key } from "node:readline";
import type {
  AgentId,
  ReviewLauncherConfig,
  ReviewLauncherLastUsedConfig,
  ReviewLauncherProfileConfig,
} from "../types/index.js";
import { ensureWorkspace, getReportPathPattern } from "../config/storage.js";

const ALL_AGENTS: AgentId[] = ["claude", "codex", "gemini"];
const SUPPORTED_REVIEW_FILE_EXTENSIONS = new Set([".md", ".mdx", ".markdown", ".txt"]);

interface PromptChoice<TValue> {
  value: TValue;
  label: string;
  hint?: string | undefined;
  keywords?: string[] | undefined;
}

export interface ReviewLauncherProfile {
  key: string;
  label: string;
  description: string;
  mode?: "investigation" | "plan" | "implementation" | undefined;
  defaultReviewers?: AgentId[] | undefined;
}

export interface ReviewLauncherFile {
  path: string;
  displayPath: string;
  heading?: string | undefined;
}

type PostRunAction = "restart" | "exit";
type LauncherStep = "profile" | "reviewers" | "file" | "confirm";
type ConfirmationAction = "run" | "back" | "cancel";
const BACK_ACTION = Symbol("review-launcher-back");

interface SelectableModel {
  provider: AgentId;
  model: string;
}

const SELECTABLE_MODELS: SelectableModel[] = [
  {
    provider: "claude",
    model: "claude-opus-4-6",
  },
  {
    provider: "claude",
    model: "claude-sonnet-4-6",
  },
  {
    provider: "claude",
    model: "claude-haiku-4-5-20251001",
  },
  {
    provider: "codex",
    model: "gpt-5.4",
  },
  {
    provider: "codex",
    model: "gpt-5.2",
  },
  {
    provider: "codex",
    model: "gpt-5.2-codex",
  },
  {
    provider: "codex",
    model: "gpt-5.1-codex-mini",
  },
  {
    provider: "gemini",
    model: "gemini-3.1-pro-preview",
  },
  {
    provider: "gemini",
    model: "gemini-3-flash-preview",
  },
  {
    provider: "gemini",
    model: "gemini-2.5-flash",
  },
];

export async function runInteractiveReviewLauncher(
  options: AutoReviewWorkflowOptions,
): Promise<number> {
  ensureInteractiveTerminal();

  const cwd = process.cwd();
  await ensureWorkspace(cwd);
  const launcherConfig = await loadRepoReviewLauncherConfig(cwd);
  const configPath = getRepoLocalConfigPath(cwd);
  const profiles = resolveReviewLauncherProfiles(launcherConfig);
  const lastUsedReviewerModels = resolveLastUsedReviewerModels(launcherConfig.last_used);
  const globalConfig = await loadProjectConfig(cwd);
  const defaultAgentModels = resolveAgentModels(globalConfig);
  const defaultProfile = profiles[0];
  if (!defaultProfile) {
    throw new Error("Interactive review launcher could not resolve any profiles.");
  }

  const promptSession = new InteractivePromptSession();
  let currentProfile: ReviewLauncherProfile = defaultProfile;
  let currentReviewerModels = resolveInitialReviewerModels(
    options.reviewers,
    options.reviewerModels,
    lastUsedReviewerModels,
    currentProfile,
    defaultAgentModels,
  );
  let currentFilePath: string | undefined;
  let lastExitCode = 0;
  let currentStep: LauncherStep = profiles.length === 1 ? "reviewers" : "profile";

  promptSession.enterMenuScreen();
  try {
    while (true) {
      if (currentStep === "profile") {
        const profile = await promptSession.select("Select workflow", profiles.map((entry) => ({
          value: entry,
          label: entry.label,
          keywords: [entry.key, entry.label, entry.description],
        })), currentProfile);
        currentProfile = profile;
        currentStep = "reviewers";
        continue;
      }

      if (currentStep === "reviewers") {
        const reviewerDefaults = resolveDefaultReviewerModels(
          currentReviewerModels,
          currentProfile,
          defaultAgentModels,
        );
        const reviewerChoices = SELECTABLE_MODELS
          .map((entry) => ({
            value: entry,
            label: entry.model,
            hint: reviewerDefaults.some((item) => item.model === entry.model) ? "default" : undefined,
            keywords: [entry.provider, entry.model],
          }));
        const selectedReviewerModels = profiles.length > 1
          ? await promptSession.multiSelectWithBack(
            "Select reviewer models",
            reviewerChoices,
            reviewerDefaults,
          )
          : await promptSession.multiSelect(
            "Select reviewer models",
            reviewerChoices,
            reviewerDefaults,
          );
        if (selectedReviewerModels === BACK_ACTION) {
          if (profiles.length > 1) {
            currentStep = "profile";
            continue;
          }
          continue;
        }

        currentReviewerModels = ensureUniqueReviewerProviders(selectedReviewerModels);
        currentStep = "file";
        continue;
      }

      if (currentStep === "file") {
        const filesFolder = resolveReviewLauncherFilesFolder(launcherConfig, currentProfile.mode);
        if (!filesFolder) {
          throw new Error(
            `Interactive review launcher requires ${describeMissingFolderKeys(currentProfile.mode)} in ${configPath}.`,
          );
        }

        const absoluteFolder = resolve(cwd, filesFolder);
        try {
          await access(absoluteFolder, fsConstants.F_OK);
        } catch {
          throw new Error(
            `Configured launcher folder does not exist: ${absoluteFolder}`,
          );
        }

        const files = await listReviewLauncherFiles(cwd, filesFolder);
        if (files.length === 0) {
          throw new Error(
            `No launcher files found under ${filesFolder}. Supported extensions: ${Array.from(SUPPORTED_REVIEW_FILE_EXTENSIONS).join(", ")}`,
          );
        }

        const selectedFile = await promptSession.selectWithBack(
          buildFileSelectionTitle(currentProfile.mode, filesFolder),
          files.map((file) => ({
            value: file,
            label: file.displayPath,
            keywords: [file.path, file.displayPath, ...(file.heading ? [file.heading] : [])],
          })),
          currentFilePath
            ? files.find((file) => file.path === currentFilePath)
            : undefined,
        );
        if (selectedFile === BACK_ACTION) {
          currentStep = "reviewers";
          continue;
        }

        currentFilePath = selectedFile.path;
        currentStep = "confirm";
        continue;
      }

      const reviewers = currentReviewerModels.map((entry) => entry.provider);
      const selectedMode = currentProfile.mode ?? options.mode;
      const reviewerModelMap = Object.fromEntries(
        currentReviewerModels.map((entry) => [entry.provider, entry.model]),
      );
      const filesFolder = resolveReviewLauncherFilesFolder(launcherConfig, currentProfile.mode);
      if (!filesFolder) {
        throw new Error(
          `Interactive review launcher requires ${describeMissingFolderKeys(currentProfile.mode)} in ${configPath}.`,
        );
      }

      const files = await listReviewLauncherFiles(cwd, filesFolder);
      const selectedFile = files.find((file) => file.path === currentFilePath);
      if (!selectedFile) {
        currentStep = "file";
        continue;
      }

      const analysis = await analyzeReviewFile(
        selectedFile.path,
        selectedMode,
      );
      const preparedWorkflow = analysis.mode === "investigation"
        ? await prepareInvestigationReviewWorkflow(cwd, selectedFile.path, {
          reviewers,
          reviewerModels: reviewerModelMap,
          instructions: options.instructions,
          claudeModel: options.claudeModel,
          codexModel: options.codexModel,
          geminiModel: options.geminiModel,
          repoSummary: options.repoSummary,
          techStack: options.techStack,
          verbose: options.verbose,
          geminiStrict: options.geminiStrict,
          dryRun: options.dryRun,
          extraFiles: options.extraFiles,
        })
        : analysis.mode === "plan"
          ? await preparePlanReviewWorkflow(cwd, selectedFile.path, {
          reviewers,
          reviewerModels: reviewerModelMap,
          instructions: options.instructions,
          claudeModel: options.claudeModel,
          codexModel: options.codexModel,
          geminiModel: options.geminiModel,
          repoSummary: options.repoSummary,
          techStack: options.techStack,
          verbose: options.verbose,
          geminiStrict: options.geminiStrict,
          dryRun: options.dryRun,
          extraFiles: options.extraFiles,
        })
          : await prepareImplementationReviewWorkflow(cwd, selectedFile.path, {
          reviewers,
          reviewerModels: reviewerModelMap,
          instructions: options.instructions,
          claudeModel: options.claudeModel,
          codexModel: options.codexModel,
          geminiModel: options.geminiModel,
          repoSummary: options.repoSummary,
          techStack: options.techStack,
          verbose: options.verbose,
          geminiStrict: options.geminiStrict,
          dryRun: options.dryRun,
          extraFiles: options.extraFiles,
        });
      const commandPreview = buildInteractiveReviewCommandPreview({
        file: selectedFile.path,
        reviewers,
        reviewerModels: reviewerModelMap,
        options: {
          ...options,
          mode: selectedMode,
        },
      });
      const confirmation = await promptSession.confirmWithBack(
        "Run review",
        buildReviewLauncherConfirmationLines({
          profileLabel: currentProfile.label,
          reviewerModels: currentReviewerModels.map((entry) => entry.model),
          reviewFile: selectedFile.path,
          detectedMode: analysis.mode,
          validationPass: analysis.validationPass,
          detectedAuthor: analysis.detectedAuthor,
          preparedWorkflow,
          commandPreview,
        }),
      );

      if (confirmation === "back") {
        currentStep = "file";
        continue;
      }

      if (confirmation === "cancel") {
        promptSession.exitMenuScreen();
        process.stdout.write("Interactive review launcher cancelled.\n");
        return lastExitCode;
      }

      promptSession.exitMenuScreen();
      await saveRepoReviewLauncherLastUsed(cwd, {
        reviewer_models: currentReviewerModels.map((entry) => entry.model),
      });
      clearInteractiveLauncherTerminal();
      lastExitCode = await runAutoReviewCommand(selectedFile.path, {
        ...options,
        mode: selectedMode,
        reviewers,
        reviewerModels: reviewerModelMap,
      });

      promptSession.enterMenuScreen();
      const nextAction = await promptSession.selectPostRunActionResilient({
        exitCode: lastExitCode,
        reviewFile: selectedFile.path,
      });
      if (nextAction === "exit") {
        return lastExitCode;
      }

      clearInteractiveLauncherTerminal();
      currentStep = "file";
    }
  } catch (error) {
    if (error instanceof Error && error.message === "Interactive review launcher cancelled.") {
      promptSession.exitMenuScreen();
      return lastExitCode;
    }
    throw error;
  } finally {
    promptSession.exitMenuScreen();
  }
}

export function resolveReviewLauncherProfiles(
  config: ReviewLauncherConfig,
): ReviewLauncherProfile[] {
  const configuredProfiles = Object.entries(config.profiles)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => buildProfile(key, value));

  if (configuredProfiles.length > 0) {
    return configuredProfiles;
  }

  return [
    {
      key: "review",
      label: "review (Review workflow)",
      description: "Review workflow",
    },
  ];
}

export async function listReviewLauncherFiles(
  cwd: string,
  filesFolder: string,
): Promise<ReviewLauncherFile[]> {
  const root = resolve(cwd, filesFolder);
  const matches: ReviewLauncherFile[] = [];
  await walkReviewFiles(cwd, root, root, matches);

  return matches.sort((left, right) => left.displayPath.localeCompare(right.displayPath));
}

export function buildInteractiveReviewCommandPreview(input: {
  file: string;
  reviewers: AgentId[];
  reviewerModels?: Partial<Record<AgentId, string | undefined>> | undefined;
  options: AutoReviewWorkflowOptions;
}): string {
  const args = ["review", input.file];

  if (input.reviewers.length > 0) {
    args.push("--reviewers", ...input.reviewers);
  }
  if (input.reviewerModels) {
    const entries = Object.entries(input.reviewerModels)
      .filter((entry): entry is [AgentId, string] => Boolean(entry[1]))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([agent, model]) => `${agent}=${model}`);

    if (entries.length > 0) {
      args.push("--reviewer-models", ...entries);
    }
  }
  if (input.options.mode) {
    args.push("--mode", input.options.mode);
  }
  if (input.options.instructions) {
    args.push("--instructions", input.options.instructions);
  }
  if (input.options.repoSummary) {
    args.push("--repo-summary", input.options.repoSummary);
  }
  if (input.options.techStack && input.options.techStack.length > 0) {
    args.push("--tech-stack", ...input.options.techStack);
  }
  if (input.options.claudeModel) {
    args.push("--claude-model", input.options.claudeModel);
  }
  if (input.options.codexModel) {
    args.push("--codex-model", input.options.codexModel);
  }
  if (input.options.geminiModel) {
    args.push("--gemini-model", input.options.geminiModel);
  }
  if (input.options.extraFiles && input.options.extraFiles.length > 0) {
    args.push("--files", ...input.options.extraFiles);
  }
  if (input.options.dryRun) {
    args.push("--dry-run");
  }
  if (input.options.verbose) {
    args.push("--verbose");
  }
  if (input.options.geminiStrict) {
    args.push("--gemini-strict");
  }

  return ["mrev", ...args].map(quoteShellArg).join(" ");
}

export function buildReviewLauncherConfirmationLines(input: {
  profileLabel: string;
  reviewerModels: string[];
  reviewFile: string;
  detectedMode: "investigation" | "plan" | "implementation";
  validationPass: boolean;
  detectedAuthor?: AgentId | undefined;
  preparedWorkflow: PreparedReviewWorkflow;
  commandPreview: string;
}): string[] {
  const lines = [
    `Workflow: ${input.profileLabel}`,
    `Reviewers: ${input.reviewerModels.join(", ")}`,
    `Review file: ${input.reviewFile}`,
    `Detected mode: ${input.detectedMode}${input.validationPass ? " (validation pass)" : ""}`,
  ];

  if (input.detectedAuthor) {
    lines.push(`Detected file author: ${input.detectedAuthor}`);
  }

  if (input.preparedWorkflow.validationPass) {
    const priorReportCount = input.preparedWorkflow.files.filter((file) =>
      getReportPathPattern().test(file)
    ).length;
    lines.push(`Prior reports: ${priorReportCount} included`);
    if (input.preparedWorkflow.missingReferencedReports.length > 0) {
      lines.push(
        `Missing prior reports: ${input.preparedWorkflow.missingReferencedReports.join(", ")}`,
      );
    }
  }

  lines.push(`Command: ${input.commandPreview}`);
  return lines;
}

function buildProfile(key: string, profile: ReviewLauncherProfileConfig): ReviewLauncherProfile {
  const defaultDescription = profile.mode === "investigation"
    ? "Review investigation"
    : profile.mode === "plan"
      ? "Review plan"
      : profile.mode === "implementation"
        ? "Review implementation"
        : "Review workflow";
  const description = profile.description?.trim() || defaultDescription;

  return {
    key,
    label: `${key} (${description})`,
    description,
    mode: profile.mode,
    defaultReviewers: profile.default_reviewers,
  };
}

export function resolveReviewLauncherFilesFolder(
  config: ReviewLauncherConfig,
  mode?: "investigation" | "plan" | "implementation" | undefined,
): string | undefined {
  const candidates = mode === "investigation"
    ? [config.investigations_folder, config.files_folder]
    : mode === "plan"
      ? [config.plans_folder, config.files_folder]
      : [config.reviews_folder, config.files_folder];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed && trimmed.length > 0) {
      return trimmed;
    }
  }

  return undefined;
}

function resolveInitialReviewerModels(
  requestedReviewers?: AgentId[] | undefined,
  requestedReviewerModels?: Partial<Record<AgentId, string | undefined>> | undefined,
  lastUsedReviewerModels?: SelectableModel[] | undefined,
  profile?: ReviewLauncherProfile | undefined,
  defaultAgentModels?: Partial<Record<AgentId, string | undefined>> | undefined,
): SelectableModel[] {
  if (requestedReviewerModels) {
    const explicit = Object.entries(requestedReviewerModels)
      .map(([provider, model]) => (model ? findSelectableModel(provider as AgentId, model) : undefined))
      .filter((entry): entry is SelectableModel => Boolean(entry));

    if (explicit.length > 0) {
      return explicit;
    }
  }

  if (lastUsedReviewerModels && lastUsedReviewerModels.length > 0) {
    return lastUsedReviewerModels;
  }

  const providers = requestedReviewers && requestedReviewers.length > 0
    ? requestedReviewers
    : (profile?.defaultReviewers ?? []);

  return providers
    .map((provider) => (
      (defaultAgentModels?.[provider] ? findSelectableModel(provider, defaultAgentModels[provider] ?? "") : undefined)
      ?? SELECTABLE_MODELS.find((entry) => entry.provider === provider)
    ))
    .filter((entry): entry is SelectableModel => Boolean(entry));
}

function resolveDefaultReviewerModels(
  requestedReviewerModels: SelectableModel[],
  profile: ReviewLauncherProfile,
  defaultAgentModels?: Partial<Record<AgentId, string | undefined>> | undefined,
): SelectableModel[] {
  const preferred = requestedReviewerModels.length > 0
    ? requestedReviewerModels
    : resolveInitialReviewerModels(
      undefined,
      undefined,
      undefined,
      profile,
      defaultAgentModels,
    );
  if (preferred.length > 0) {
    return preferred;
  }

  return [];
}

function ensureUniqueReviewerProviders(models: SelectableModel[]): SelectableModel[] {
  const uniqueByProvider = new Map<AgentId, SelectableModel>();
  for (const model of models) {
    if (!uniqueByProvider.has(model.provider)) {
      uniqueByProvider.set(model.provider, model);
      continue;
    }

    throw new Error(
      `Only one reviewer per provider is currently supported. You selected multiple ${model.provider} reviewer models.`,
    );
  }

  const values = Array.from(uniqueByProvider.values());
  if (values.length === 0) {
    throw new Error("Select at least one reviewer model.");
  }

  return values;
}

function findSelectableModel(provider: AgentId, model: string): SelectableModel | undefined {
  return SELECTABLE_MODELS.find((entry) => entry.provider === provider && entry.model === model);
}

function findSelectableModelById(model: string): SelectableModel | undefined {
  return SELECTABLE_MODELS.find((entry) => entry.model === model);
}

function resolveLastUsedReviewerModels(
  lastUsed?: ReviewLauncherLastUsedConfig | undefined,
): SelectableModel[] {
  return (lastUsed?.reviewer_models ?? [])
    .map((model) => findSelectableModelById(model))
    .filter((entry): entry is SelectableModel => Boolean(entry));
}

async function walkReviewFiles(
  cwd: string,
  root: string,
  current: string,
  matches: ReviewLauncherFile[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
      continue;
    }

    const absolutePath = resolve(current, entry.name);
    if (entry.isDirectory()) {
      await walkReviewFiles(cwd, root, absolutePath, matches);
      continue;
    }

    if (!entry.isFile() || !SUPPORTED_REVIEW_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      continue;
    }

    const content = await readFile(absolutePath, "utf8");
    const displayPath = relative(root, absolutePath).replaceAll("\\", "/");
    matches.push({
      path: relative(cwd, absolutePath).replaceAll("\\", "/"),
      displayPath,
      heading: extractHeading(content),
    });
  }
}

function extractHeading(content: string): string | undefined {
  const match = content.match(/^\s{0,3}#{1,3}\s+(.+?)\s*$/m);
  return match?.[1]?.trim();
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_=./:\\-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

function buildFileSelectionTitle(
  mode: "investigation" | "plan" | "implementation" | undefined,
  filesFolder: string,
): string {
  if (mode === "investigation") {
    return `Select investigation file from ${filesFolder}`;
  }

  if (mode === "plan") {
    return `Select plan file from ${filesFolder}`;
  }

  return `Select review file from ${filesFolder}`;
}

function describeMissingFolderKeys(
  mode: "investigation" | "plan" | "implementation" | undefined,
): string {
  if (mode === "investigation") {
    return "review_launcher.investigations_folder or review_launcher.files_folder";
  }

  if (mode === "plan") {
    return "review_launcher.plans_folder or review_launcher.files_folder";
  }

  return "review_launcher.reviews_folder or review_launcher.files_folder";
}

function ensureInteractiveTerminal(): void {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive review launcher requires a TTY terminal.");
  }
}

class InteractivePromptSession {
  private menuScreenActive = false;

  enterMenuScreen(): void {
    if (this.menuScreenActive || !process.stdout.isTTY) {
      return;
    }

    // Alternate-screen switching was causing intermittent terminal shutdowns in
    // real use. Keep the launcher in the normal terminal buffer and let the
    // prompt renderer repaint in place instead.
    this.menuScreenActive = true;
  }

  exitMenuScreen(): void {
    if (!this.menuScreenActive || !process.stdout.isTTY) {
      return;
    }

    this.menuScreenActive = false;
  }

  async selectWithBack<TValue>(
    title: string,
    choices: PromptChoice<TValue>[],
    defaultValue?: TValue | undefined,
    allowBack = true,
  ): Promise<TValue | typeof BACK_ACTION> {
    return this.selectInternal(title, choices, defaultValue, allowBack);
  }

  async select<TValue>(
    title: string,
    choices: PromptChoice<TValue>[],
    defaultValue?: TValue | undefined,
  ): Promise<TValue> {
    const result = await this.selectInternal(title, choices, defaultValue, false);
    if (result === BACK_ACTION) {
      throw new Error("Back action is unavailable for this prompt.");
    }
    return result;
  }

  private async selectInternal<TValue>(
    title: string,
    choices: PromptChoice<TValue>[],
    defaultValue: TValue | undefined,
    allowBack: boolean,
  ): Promise<TValue | typeof BACK_ACTION> {
    let filter = "";
    let highlightedIndex = defaultValue === undefined
      ? 0
      : Math.max(choices.findIndex((choice) => choice.value === defaultValue), 0);

    return this.runPrompt(() => {
      const filteredChoices = withBackChoice(filterChoices(choices, filter), allowBack);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);
      return renderChoicePrompt({
        title,
        help: allowBack
          ? "Up/Down to move, type to filter, Enter to select, choose Back to return, Esc to cancel."
          : "Up/Down to move, type to filter, Enter to select, Esc to cancel.",
        filter,
        highlightedIndex,
        choices: filteredChoices,
      });
    }, (text, key) => {
      const filteredChoices = withBackChoice(filterChoices(choices, filter), allowBack);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);

      if (key.name === "up") {
        highlightedIndex -= 1;
        return undefined;
      }
      if (key.name === "down") {
        highlightedIndex += 1;
        return undefined;
      }
      if (key.name === "return") {
        const selected = filteredChoices[highlightedIndex];
        return selected?.value;
      }
      if (key.name === "backspace") {
        filter = filter.slice(0, -1);
        highlightedIndex = 0;
        return undefined;
      }
      if (isSearchCharacter(text, key)) {
        filter += text;
        highlightedIndex = 0;
      }

      return undefined;
    });
  }

  async multiSelectWithBack<TValue>(
    title: string,
    choices: PromptChoice<TValue>[],
    defaultValues: TValue[],
  ): Promise<TValue[] | typeof BACK_ACTION> {
    let filter = "";
    let highlightedIndex = 0;
    const selected = new Set(defaultValues);

    return this.runPrompt(() => {
      const filteredChoices = withBackChoice(filterChoices(choices, filter), true);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);
      return renderChoicePrompt({
        title,
        help: "Up/Down to move, Space to toggle, Enter to confirm, choose Back to return, Esc to cancel.",
        filter,
        highlightedIndex,
        choices: filteredChoices,
        selected,
      });
    }, (text, key) => {
      const filteredChoices = withBackChoice(filterChoices(choices, filter), true);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);

      if (key.name === "up") {
        highlightedIndex -= 1;
        return undefined;
      }
      if (key.name === "down") {
        highlightedIndex += 1;
        return undefined;
      }
      const choice = filteredChoices[highlightedIndex];
      if (key.name === "space") {
        if (choice && choice.value !== BACK_ACTION) {
          if (selected.has(choice.value as TValue)) {
            selected.delete(choice.value as TValue);
          } else {
            selected.add(choice.value as TValue);
          }
        }
        return undefined;
      }
      if (key.name === "return") {
        if (choice?.value === BACK_ACTION) {
          return BACK_ACTION;
        }
        if (selected.size === 0) {
          return undefined;
        }

        return choices
          .filter((entry) => selected.has(entry.value))
          .map((entry) => entry.value);
      }
      if (key.name === "backspace") {
        filter = filter.slice(0, -1);
        highlightedIndex = 0;
        return undefined;
      }
      if (isSearchCharacter(text, key)) {
        filter += text;
        highlightedIndex = 0;
      }

      return undefined;
    });
  }

  async multiSelect<TValue>(
    title: string,
    choices: PromptChoice<TValue>[],
    defaultValues: TValue[],
  ): Promise<TValue[]> {
    let filter = "";
    let highlightedIndex = 0;
    const selected = new Set(defaultValues);

    return this.runPrompt(() => {
      const filteredChoices = filterChoices(choices, filter);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);
      return renderChoicePrompt({
        title,
        help: "Up/Down to move, Space to toggle, type to filter, Enter to confirm.",
        filter,
        highlightedIndex,
        choices: filteredChoices,
        selected,
      });
    }, (text, key) => {
      const filteredChoices = filterChoices(choices, filter);
      highlightedIndex = normalizeHighlightedIndex(highlightedIndex, filteredChoices.length);

      if (key.name === "up") {
        highlightedIndex -= 1;
        return undefined;
      }
      if (key.name === "down") {
        highlightedIndex += 1;
        return undefined;
      }
      if (key.name === "space") {
        const choice = filteredChoices[highlightedIndex];
        if (choice) {
          if (selected.has(choice.value)) {
            selected.delete(choice.value);
          } else {
            selected.add(choice.value);
          }
        }
        return undefined;
      }
      if (key.name === "return") {
        if (selected.size === 0) {
          return undefined;
        }

        return choices
          .filter((choice) => selected.has(choice.value))
          .map((choice) => choice.value);
      }
      if (key.name === "backspace") {
        filter = filter.slice(0, -1);
        highlightedIndex = 0;
        return undefined;
      }
      if (isSearchCharacter(text, key)) {
        filter += text;
        highlightedIndex = 0;
      }

      return undefined;
    });
  }

  async confirmWithBack(title: string, summaryLines: string[]): Promise<ConfirmationAction> {
    let selected = 0;
    const actions: ConfirmationAction[] = ["run", "back", "cancel"];

    return this.runPrompt(() => {
      const lines = [
        title,
        "Left/Right or Up/Down to choose, Enter to confirm, Esc to cancel.",
        "",
        ...summaryLines,
        "",
        `${selected === 0 ? ">" : " "} Run now`,
        `${selected === 1 ? ">" : " "} Back`,
        `${selected === 2 ? ">" : " "} Cancel`,
      ];

      return `${lines.join("\n")}\n`;
    }, (_text, key) => {
      if (key.name === "left" || key.name === "up") {
        selected = selected === 0 ? actions.length - 1 : selected - 1;
        return undefined;
      }
      if (key.name === "right" || key.name === "down") {
        selected = (selected + 1) % actions.length;
        return undefined;
      }
      if (key.name === "return") {
        return actions[selected];
      }

      return undefined;
    });
  }

  async confirm(title: string, summaryLines: string[]): Promise<boolean> {
    let selected = true;

    return this.runPrompt(() => {
      const lines = [
        title,
        "Left/Right or Up/Down to choose, Enter to confirm, Esc to cancel.",
        "",
        ...summaryLines,
        "",
        `${selected ? ">" : " "} Run now`,
        `${selected ? " " : ">"} Cancel`,
      ];

      return `${lines.join("\n")}\n`;
    }, (_text, key) => {
      if (key.name === "left" || key.name === "right" || key.name === "up" || key.name === "down") {
        selected = !selected;
        return undefined;
      }
      if (key.name === "return") {
        return selected;
      }

      return undefined;
    });
  }

  async selectPostRunAction(input: {
    exitCode: number;
    reviewFile: string;
  }): Promise<PostRunAction> {
    return this.select(
      input.exitCode === 0 ? "Review completed" : "Review completed with issues",
      [
        {
          value: "restart",
          label: "Start another review",
          keywords: ["new session", "another", "again", "restart"],
        },
        {
          value: "exit",
          label: "Exit",
          keywords: ["exit", "quit", "close"],
        },
      ],
      "restart",
    );
  }

  async selectPostRunActionPlain(input: {
    exitCode: number;
    reviewFile: string;
  }): Promise<PostRunAction> {
    const stdout = process.stdout;

    stdout.write(
      `${input.exitCode === 0 ? "Review completed." : "Review completed with issues."}\n`,
    );
    stdout.write(`File: ${input.reviewFile}\n`);
    stdout.write("1. Start another review\n");
    stdout.write("2. Exit\n");
    stdout.write("Choice [1/2]: ");

    return new Promise<PostRunAction>((resolve, reject) => {
      const stdin = process.stdin;
      const restoreRawMode = Boolean(stdin.isRaw);

      const cleanup = () => {
        stdin.off("data", onData);
        restorePromptInputState(stdin, restoreRawMode);
      };

      const onData = (chunk: Buffer | string) => {
        const text = chunk.toString();
        if (text === "\u0003") {
          cleanup();
          reject(new Error("Interactive review launcher cancelled."));
          return;
        }

        const choice = text.trim().toLowerCase();
        if (choice === "" || choice === "1") {
          stdout.write("\n");
          cleanup();
          resolve("restart");
          return;
        }
        if (choice === "2") {
          stdout.write("\n");
          cleanup();
          resolve("exit");
          return;
        }

        stdout.write("\nEnter 1 to start another review or 2 to exit.\n");
        stdout.write("Choice [1/2]: ");
      };

      if (stdin.isTTY) {
        try {
          stdin.setRawMode(true);
        } catch {
          // Ignore raw-mode failures and continue with normal data mode.
        }
      }
      stdin.resume();
      stdin.on("data", onData);
    });
  }

  async selectPostRunActionResilient(input: {
    exitCode: number;
    reviewFile: string;
  }): Promise<PostRunAction> {
    try {
      return await this.selectPostRunAction(input);
    } catch (error) {
      this.exitMenuScreen();
      process.stdout.write(
        `\nPost-run prompt failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.stdout.write("Press 1 to start another review or 2 to exit.\n");
      return this.selectPostRunActionLastResort();
    }
  }

  private async selectPostRunActionLastResort(): Promise<PostRunAction> {
    return new Promise<PostRunAction>((resolve) => {
      const stdin = process.stdin;
      const restoreRawMode = Boolean(stdin.isRaw);

      const cleanup = () => {
        stdin.off("data", onData);
        restorePromptInputState(stdin, restoreRawMode);
      };

      const onData = (chunk: Buffer | string) => {
        const text = chunk.toString().trim().toLowerCase();
        if (text === "" || text === "1") {
          cleanup();
          process.stdout.write("\n");
          resolve("restart");
          return;
        }
        if (text === "2") {
          cleanup();
          process.stdout.write("\n");
          resolve("exit");
          return;
        }
      };

      if (stdin.isTTY) {
        try {
          stdin.setRawMode(true);
        } catch {
          // Ignore raw-mode failures and continue with normal data mode.
        }
      }
      stdin.resume();
      stdin.on("data", onData);
    });
  }

  private async runPrompt<TValue>(
    render: () => string,
    handleKey: (text: string, key: Key) => TValue | undefined,
  ): Promise<TValue> {
    return new Promise<TValue>((resolve, reject) => {
      const stdin = process.stdin;
      const stdout = process.stdout;
      let renderedLineCount = 0;
      const restoreRawMode = Boolean(stdin.isRaw);

      const repaint = () => {
        if (renderedLineCount > 0) {
          readline.moveCursor(stdout, 0, -renderedLineCount);
          readline.cursorTo(stdout, 0);
          readline.clearScreenDown(stdout);
        }

        const frame = render();
        stdout.write(frame);
        renderedLineCount = countRenderedPromptLines(frame);
      };

      const cleanup = () => {
        stdin.off("keypress", onKeypress);
        restorePromptInputState(stdin, restoreRawMode);
        stdout.write("\x1B[?25h");

        if (renderedLineCount > 0) {
          readline.moveCursor(stdout, 0, -renderedLineCount);
          readline.cursorTo(stdout, 0);
          readline.clearScreenDown(stdout);
        }
      };

      const onKeypress = (text: string, key: Key) => {
        if ((key.ctrl && key.name === "c") || key.name === "escape") {
          cleanup();
          reject(new Error("Interactive review launcher cancelled."));
          return;
        }

        const result = handleKey(text, key);
        if (result !== undefined) {
          cleanup();
          resolve(result);
          return;
        }

        repaint();
      };

      try {
        readline.emitKeypressEvents(stdin);
        if (stdin.isTTY) {
          stdin.setRawMode(true);
        }
        stdin.resume();
        stdout.write("\x1B[?25l");
        stdin.on("keypress", onKeypress);
        repaint();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
}

function restorePromptInputState(
  stdin: NodeJS.ReadStream,
  restoreRawMode: boolean,
): void {
  if (stdin.isTTY) {
    try {
      stdin.setRawMode(restoreRawMode);
    } catch {
      // Ignore raw-mode restoration failures and continue cleanup.
    }
  }

  try {
    stdin.pause();
  } catch {
    // Ignore pause failures and continue cleanup.
  }
}

export function countRenderedPromptLines(
  frame: string,
  columns = process.stdout.columns ?? 80,
): number {
  if (frame.length === 0) {
    return 0;
  }

  const safeColumns = Number.isFinite(columns) && columns > 0 ? columns : 80;
  const logicalLines = frame.endsWith("\n")
    ? frame.slice(0, -1).split("\n")
    : frame.split("\n");

  return logicalLines.reduce((total, line) => {
    const occupiedRows = line.length === 0 ? 1 : Math.ceil(line.length / safeColumns);
    return total + occupiedRows;
  }, 0);
}

export function clearInteractiveLauncherTerminal(
  stdout: Pick<NodeJS.WriteStream, "isTTY" | "write"> = process.stdout,
): void {
  if (!stdout.isTTY) {
    return;
  }

  stdout.write("\x1B[2J\x1B[3J\x1B[H");
}

function withBackChoice<TValue>(
  choices: PromptChoice<TValue>[],
  allowBack: boolean,
): PromptChoice<TValue | typeof BACK_ACTION>[] {
  if (!allowBack) {
    return choices;
  }

  return [
    ...choices,
    {
      value: BACK_ACTION,
      label: "Back",
      keywords: ["back", "previous", "return"],
    },
  ];
}

function renderChoicePrompt<TValue>(input: {
  title: string;
  help: string;
  filter: string;
  highlightedIndex: number;
  choices: PromptChoice<TValue>[];
  selected?: Set<TValue> | undefined;
}): string {
  const lines = [
    input.title,
    input.help,
  ];

  if (input.filter.trim().length > 0) {
    lines.push(`Filter: ${input.filter}`);
  }

  lines.push("");

  if (input.choices.length === 0) {
    lines.push("  No matches.");
    return `${lines.join("\n")}\n`;
  }

  for (const [absoluteIndex, choice] of input.choices.entries()) {
    const cursor = absoluteIndex === input.highlightedIndex ? ">" : " ";
    const isBackChoice = choice.value === BACK_ACTION;
    const selectedMarker = isBackChoice
      ? "<-"
      : input.selected
        ? (input.selected.has(choice.value) ? "[x]" : "[ ]")
        : "   ";
    const inlineHint = choice.hint && choice.hint.length <= 24
      ? ` (${choice.hint})`
      : "";
    lines.push(`${cursor} ${selectedMarker} ${choice.label}${inlineHint}`);

    if (choice.hint && inlineHint.length === 0) {
      lines.push(`      ${choice.hint}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function filterChoices<TValue>(
  choices: PromptChoice<TValue>[],
  filter: string,
): PromptChoice<TValue>[] {
  const normalizedFilter = filter.trim().toLowerCase();
  if (normalizedFilter.length === 0) {
    return choices;
  }

  return choices.filter((choice) => {
    const searchable = [
      choice.label,
      choice.hint,
      ...(choice.keywords ?? []),
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();

    return searchable.includes(normalizedFilter);
  });
}

function normalizeHighlightedIndex(index: number, count: number): number {
  if (count <= 0) {
    return 0;
  }

  if (index < 0) {
    return count - 1;
  }
  if (index >= count) {
    return 0;
  }

  return index;
}

function isSearchCharacter(text: string, key: Key): boolean {
  return Boolean(
    text
    && text.length === 1
    && !key.ctrl
    && !key.meta
    && text >= " "
    && text !== "\u007f",
  );
}
