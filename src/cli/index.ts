#!/usr/bin/env node

import {
  runAuditDiffCommand,
  runAuditListCommand,
  runAuditSearchCommand,
  runAuditShowCommand,
} from "./commands/audit.js";
import {
  runPresetDeleteCommand,
  runPresetListCommand,
  runPresetSaveCommand,
  runPresetShowCommand,
} from "./commands/preset.js";
import {
  coerceAutoReviewWorkflowOptions,
  runAutoReviewCommand,
} from "./commands/review.js";
import { Command } from "commander";

import { runInteractiveReviewLauncher } from "./review-launcher.js";
import { runRunCommand } from "./commands/run.js";
import { runValidateCommand } from "./commands/validate.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("mrev")
    .description("Multi AI Reviewer: CLI-first multi-LLM author/reviewer workflow tool.")
    .showHelpAfterError();

  program
    .command("preset")
    .description("Manage advanced raw-pipeline presets.")
    .action(function action(this: Command) {
      this.help();
    })
    .addCommand(
      new Command("save")
        .description("Save a preset to .mrev/config.yaml.")
        .argument("<name>", "Preset name.")
        .requiredOption("--pipeline <dsl>", "Pipeline DSL string.")
        .requiredOption("--description <text>", "Preset description.")
        .action(async (name: string, options: { pipeline: string; description: string }) => {
          process.exitCode = await runPresetSaveCommand(
            process.cwd(),
            name,
            options.pipeline,
            options.description,
          );
        }),
    )
    .addCommand(
      new Command("list")
        .description("List saved presets.")
        .action(async () => {
          process.exitCode = await runPresetListCommand(process.cwd());
        }),
    )
    .addCommand(
      new Command("show")
        .description("Show a saved preset.")
        .argument("<name>", "Preset name.")
        .action(async (name: string) => {
          process.exitCode = await runPresetShowCommand(process.cwd(), name);
        }),
    )
    .addCommand(
      new Command("delete")
        .description("Delete a saved preset.")
        .argument("<name>", "Preset name.")
        .action(async (name: string) => {
          process.exitCode = await runPresetDeleteCommand(process.cwd(), name);
        }),
    );

  program
    .command("audit")
    .description("Inspect saved review sessions and reports.")
    .action(function action(this: Command) {
      this.help();
    })
    .addCommand(
      new Command("list")
        .description("List saved sessions.")
        .action(async () => {
          process.exitCode = await runAuditListCommand(process.cwd());
        }),
    )
    .addCommand(
      new Command("show")
        .description("Show a saved session.")
        .argument("<sessionId>", "Session ID to display.")
        .action(async (sessionId: string) => {
          process.exitCode = await runAuditShowCommand(process.cwd(), sessionId);
        }),
    )
    .addCommand(
      new Command("search")
        .description("Search saved sessions by task keyword.")
        .argument("<keyword>", "Keyword to search for.")
        .action(async (keyword: string) => {
          process.exitCode = await runAuditSearchCommand(process.cwd(), keyword);
        }),
    )
    .addCommand(
      new Command("diff")
        .description("Show executor and revised diffs from a saved session.")
        .argument("<sessionId>", "Session ID to inspect.")
        .action(async (sessionId: string) => {
          process.exitCode = await runAuditDiffCommand(process.cwd(), sessionId);
        }),
    );

  program
    .command("review")
    .description("Run the primary multi-reviewer workflow. Starts an interactive launcher when no file is provided in a TTY.")
    .argument("[file]", "Path to an investigation, plan, or implementation review artifact.")
    .option("--mode <kind>", "Force review mode: investigation, plan, or implementation.")
    .option("--reviewers <agents...>", "Optional explicit reviewer agents.")
    .option(
      "--reviewer-models <entries...>",
      "Optional reviewer model overrides in agent=model form, for example claude=claude-opus-4-7.",
    )
    .option("--instructions <text>", "Extra reviewer instructions appended to the task.")
    .option("--files <paths...>", "Additional files to include as review context.")
    .option("--dry-run", "Print planned prompts without invoking any CLI.")
    .option("--repo-summary <text>", "Optional repository summary.")
    .option("--tech-stack <items...>", "Optional tech stack hints.")
    .option("--claude-model <model>", "Exact Claude model to use for Claude steps.")
    .option("--codex-model <model>", "Exact Codex model to use for Codex steps.")
    .option("--gemini-model <model>", "Exact Gemini model to use for Gemini steps.")
    .option("--verbose", "Stream raw agent CLI output as it arrives.")
    .option("--gemini-strict", "Fail the Gemini step if structured output parsing fails.")
    .option("--interactive", "Start the interactive review launcher.")
    .action(async function action(this: Command, file: string | undefined, options) {
      if (file && options.interactive) {
        throw new Error("Interactive review launcher does not accept a file argument.");
      }

      if (!file || options.interactive) {
        process.exitCode = await runInteractiveReviewLauncher(
          coerceAutoReviewWorkflowOptions(options),
        );
        return;
      }

      const exitCode = await runAutoReviewCommand(
        file,
        coerceAutoReviewWorkflowOptions(options),
      );
      process.exitCode = exitCode;
    })
    .addCommand(
      new Command("investigation")
        .description("Review an investigation artifact with up to 3 reviewer models.")
        .argument("<investigationFile>", "Path to the investigation file.")
        .option("--reviewers <agents...>", "Optional explicit reviewer agents.")
        .option(
          "--reviewer-models <entries...>",
          "Optional reviewer model overrides in agent=model form, for example claude=claude-opus-4-7.",
        )
        .option("--instructions <text>", "Extra reviewer instructions appended to the task.")
        .option("--files <paths...>", "Additional files to include as review context.")
        .option("--dry-run", "Print planned prompts without invoking any CLI.")
        .option("--repo-summary <text>", "Optional repository summary.")
        .option("--tech-stack <items...>", "Optional tech stack hints.")
        .option("--claude-model <model>", "Exact Claude model to use for Claude steps.")
        .option("--codex-model <model>", "Exact Codex model to use for Codex steps.")
        .option("--gemini-model <model>", "Exact Gemini model to use for Gemini steps.")
        .option("--verbose", "Stream raw agent CLI output as it arrives.")
        .option("--gemini-strict", "Fail the Gemini step if structured output parsing fails.")
        .action(async (investigationFile: string, options) => {
          const exitCode = await runAutoReviewCommand(
            investigationFile,
            {
              ...coerceAutoReviewWorkflowOptions(options),
              mode: "investigation",
            },
          );
          process.exitCode = exitCode;
        }),
    )
    .addCommand(
      new Command("plan")
        .description("Review an implementation plan with up to 3 reviewer models.")
        .argument("<planFile>", "Path to the implementation plan file.")
        .option("--reviewers <agents...>", "Optional explicit reviewer agents.")
        .option(
          "--reviewer-models <entries...>",
          "Optional reviewer model overrides in agent=model form, for example claude=claude-opus-4-7.",
        )
        .option("--instructions <text>", "Extra reviewer instructions appended to the task.")
        .option("--files <paths...>", "Additional files to include as review context.")
        .option("--dry-run", "Print planned prompts without invoking any CLI.")
        .option("--repo-summary <text>", "Optional repository summary.")
        .option("--tech-stack <items...>", "Optional tech stack hints.")
        .option("--claude-model <model>", "Exact Claude model to use for Claude steps.")
        .option("--codex-model <model>", "Exact Codex model to use for Codex steps.")
        .option("--gemini-model <model>", "Exact Gemini model to use for Gemini steps.")
        .option("--verbose", "Stream raw agent CLI output as it arrives.")
        .option("--gemini-strict", "Fail the Gemini step if structured output parsing fails.")
        .action(async (planFile: string, options) => {
          const exitCode = await runAutoReviewCommand(
            planFile,
            {
              ...coerceAutoReviewWorkflowOptions(options),
              mode: "plan",
            },
          );
          process.exitCode = exitCode;
        }),
    )
    .addCommand(
      new Command("implementation")
        .description("Review an implementation using a review-instructions file and staged diff.")
        .argument("<instructionsFile>", "Path to the implementation review instructions file.")
        .option("--reviewers <agents...>", "Optional explicit reviewer agents.")
        .option(
          "--reviewer-models <entries...>",
          "Optional reviewer model overrides in agent=model form, for example claude=claude-opus-4-7.",
        )
        .option("--instructions <text>", "Extra reviewer instructions appended to the task.")
        .option("--files <paths...>", "Additional files to include as review context.")
        .option("--dry-run", "Print planned prompts without invoking any CLI.")
        .option("--repo-summary <text>", "Optional repository summary.")
        .option("--tech-stack <items...>", "Optional tech stack hints.")
        .option("--claude-model <model>", "Exact Claude model to use for Claude steps.")
        .option("--codex-model <model>", "Exact Codex model to use for Codex steps.")
        .option("--gemini-model <model>", "Exact Gemini model to use for Gemini steps.")
        .option("--verbose", "Stream raw agent CLI output as it arrives.")
        .option("--gemini-strict", "Fail the Gemini step if structured output parsing fails.")
        .action(async (instructionsFile: string, options) => {
          const exitCode = await runAutoReviewCommand(
            instructionsFile,
            {
              ...coerceAutoReviewWorkflowOptions(options),
              mode: "implementation",
            },
          );
          process.exitCode = exitCode;
        }),
    );

  program
    .command("run")
    .description("Advanced: run a raw pipeline or print prompts in dry-run mode.")
    .option("--task <text>", "Task description.")
    .option("--task-file <path>", "Read the task description from a file.")
    .option("--pipeline <dsl>", "Pipeline DSL string.")
    .option("--preset <name>", "Load a pipeline preset from .mrev/config.yaml.")
    .option("--dry-run", "Print planned prompts without invoking any CLI.")
    .option("--repo-summary <text>", "Optional repository summary.")
    .option("--tech-stack <items...>", "Optional tech stack hints.")
    .option("--claude-model <model>", "Exact Claude model to use for Claude steps.")
    .option("--codex-model <model>", "Exact Codex model to use for Codex steps.")
    .option("--gemini-model <model>", "Exact Gemini model to use for Gemini steps.")
    .option("--files <paths...>", "Optional file hints for context planning.")
    .option("--diff", "Include staged diff in context planning.")
    .option("--symbol <name>", "Optional symbol hint for context planning.")
    .option("--verbose", "Stream raw agent CLI output as it arrives.")
    .option("--gemini-strict", "Fail the Gemini step if structured output parsing fails.")
    .action(async (options) => {
      const exitCode = await runRunCommand(options);
      process.exitCode = exitCode;
    });

  program
    .command("validate")
    .description("Validate advanced pipeline input or check installed CLI versions.")
    .option("--pipeline <dsl>", "Pipeline DSL string to validate.")
    .action(async (options: { pipeline?: string }) => {
      const exitCode = await runValidateCommand(options);
      process.exitCode = exitCode;
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
