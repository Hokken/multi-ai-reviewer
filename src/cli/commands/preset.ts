import { loadProjectConfig, saveProjectConfig } from "../../config/project.js";
import { parsePipeline, PipelineParseError } from "../../orchestrator/pipeline/parser.js";
import { validatePipeline } from "../../orchestrator/pipeline/validator.js";

export async function runPresetSaveCommand(
  cwd: string,
  name: string,
  pipeline: string,
  description: string,
): Promise<number> {
  try {
    const parsed = parsePipeline(pipeline);
    const validation = validatePipeline(parsed);

    if (validation.errors.length > 0) {
      for (const error of validation.errors) {
        process.stderr.write(`${error.message}\n`);
      }
      return 1;
    }
  } catch (error) {
    if (error instanceof PipelineParseError) {
      process.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }

  const config = await loadProjectConfig(cwd);
  config.presets[name] = { pipeline, description };
  await saveProjectConfig(cwd, config);
  process.stdout.write(`Saved preset: ${name}\n`);
  return 0;
}

export async function runPresetListCommand(cwd: string): Promise<number> {
  const config = await loadProjectConfig(cwd);
  const names = Object.keys(config.presets).sort();

  if (names.length === 0) {
    process.stdout.write("No presets found.\n");
    return 0;
  }

  for (const name of names) {
    const preset = config.presets[name];
    if (!preset) {
      continue;
    }
    process.stdout.write(`${name} ${preset.pipeline} ${preset.description}\n`);
  }

  return 0;
}

export async function runPresetShowCommand(cwd: string, name: string): Promise<number> {
  const config = await loadProjectConfig(cwd);
  const preset = config.presets[name];
  if (!preset) {
    process.stderr.write(`Preset not found: ${name}\n`);
    return 1;
  }

  process.stdout.write(`${JSON.stringify({ name, ...preset }, null, 2)}\n`);
  return 0;
}

export async function runPresetDeleteCommand(cwd: string, name: string): Promise<number> {
  const config = await loadProjectConfig(cwd);
  if (!config.presets[name]) {
    process.stderr.write(`Preset not found: ${name}\n`);
    return 1;
  }

  delete config.presets[name];
  await saveProjectConfig(cwd, config);
  process.stdout.write(`Deleted preset: ${name}\n`);
  return 0;
}
