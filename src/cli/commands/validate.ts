import { detectAllAgentClis } from "../../config/agents.js";
import { parsePipeline, PipelineParseError } from "../../orchestrator/pipeline/parser.js";
import { validatePipeline } from "../../orchestrator/pipeline/validator.js";

export interface ValidateCommandOptions {
  pipeline?: string;
}

export async function runValidateCommand(options: ValidateCommandOptions): Promise<number> {
  if (options.pipeline) {
    return validatePipelineString(options.pipeline);
  }

  return validateInstalledClis();
}

async function validateInstalledClis(): Promise<number> {
  const statuses = await detectAllAgentClis();

  let exitCode = 0;

  for (const status of statuses) {
    if (!status.installed) {
      exitCode = 1;
      process.stdout.write(
        `${status.agent}: missing (${status.binary} --version failed: ${status.error})\n`,
      );
      continue;
    }

    if (!status.detectedVersion) {
      exitCode = 1;
      process.stdout.write(
        `${status.agent}: installed but version parsing failed (${status.error ?? "unknown error"})\n`,
      );
      continue;
    }

    const versionState = status.meetsMinimumVersion ? "ok" : "upgrade required";
    if (!status.meetsMinimumVersion) {
      exitCode = 1;
    }

    process.stdout.write(
      `${status.agent}: ${status.detectedVersion} (minimum ${status.minimumVersion}) - ${versionState}\n`,
    );
  }

  return exitCode;
}

function validatePipelineString(rawPipeline: string): number {
  try {
    const parsedPipeline = parsePipeline(rawPipeline);
    const result = validatePipeline(parsedPipeline);

    for (const warning of result.warnings) {
      process.stdout.write(`${warning.message}\n`);
    }

    if (result.errors.length > 0) {
      for (const error of result.errors) {
        process.stderr.write(`${error.message}\n`);
      }
      return 1;
    }

    process.stdout.write("Pipeline is valid.\n");
    return 0;
  } catch (error) {
    if (error instanceof PipelineParseError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }

    throw error;
  }
}

