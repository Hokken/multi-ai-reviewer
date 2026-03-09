# Multi AI Reviewer Workspace Guide

## Purpose

This repository is building **Multi AI Reviewer v1**:

- headless
- advisory-only

It is now scoped as a CLI-first multi-LLM author/reviewer workflow tool for Claude Code, Codex CLI, and Gemini CLI.
The canonical product workflow is now staged:

1. investigation
2. review investigation
3. implementation plan
4. review plan
5. implementation
6. review implementation
7. validation passes until ready to commit

V1 does **not**:

- edit the workspace
- apply diffs
- use hooks
- orchestrate interactive sessions

The canonical executor artifact is a **unified diff** returned as text.

## Source of Truth

Primary product guide:

- [README.md](C:/ai-conductor/README.md)

When resuming work, read the README first and keep this workspace guide aligned with the shipped product.

## Current Status

Completed on 2026-03-07:

- Phase 1: scaffold, types, config, validate command, initial tests
- Phase 2: role prompts, context budgets, structured response parsing, `run --dry-run`
- Phase 3: agent adapters and real headless execution
- Phase 4: real context builder and fixture repo tests
- Phase 5: consensus, session logging, and audit commands
- Phase 6: config loading, presets, display helpers, and README alignment

Next phase:

- Planned V1 phases are complete
- Post-V1 workflow shortcuts are available for plan review and implementation review
- Post-V1 scope correction is to keep the product CLI-only and headless
- Post-V1 terminal review launcher is available through `mrev review`
- Post-V1 product refactor is to make the staged author/reviewer workflow the primary model and demote generic pipelines to advanced/internal usage

## Key Decisions

These are load-bearing. Do not drift from them without updating the plan.

1. The product runs directly in the real workspace.
2. `execute` returns a unified diff, not file writes.
3. Hooks are deferred to V2.
4. Session logs are step-based, not round-based.
5. Consensus aggregates across all `review` steps.
6. Auto-context fallback is staged diff only, otherwise warn and run task-only.
7. Minimum supported CLI versions are:
   - Claude: `2.1.71`
   - Codex: `0.111.0`
   - Gemini: `0.32.1`
8. Built-in review workflow shortcuts now exist:
   - `mrev review investigation <investigationFile>`
   - `mrev review plan <planFile>`
   - `mrev review implementation <instructionsFile>`
9. The product surface is CLI-only. Do not reintroduce a local web UI without an explicit spec update.
10. `mrev review` with no file may start a terminal launcher that reads `review_launcher` from the reviewed repo's `.mrev/config.yaml`.
    Launcher profiles may force `mode: investigation|plan|implementation`.
11. Review workflows support provider-specific reviewer model overrides, but still allow only one reviewer per provider in a single run.
12. Investigation review, plan review, implementation review, and validation passes now define the intended product surface more than the raw pipeline DSL does.

## Important Files

Core types:

- [`src/types/index.ts`](C:/ai-conductor/src/types/index.ts)

CLI:

- [`src/cli/index.ts`](C:/ai-conductor/src/cli/index.ts)
- [`src/cli/review-launcher.ts`](C:/ai-conductor/src/cli/review-launcher.ts)
- [`src/cli/commands/validate.ts`](C:/ai-conductor/src/cli/commands/validate.ts)
- [`src/cli/commands/run.ts`](C:/ai-conductor/src/cli/commands/run.ts)
- [`src/cli/commands/review.ts`](C:/ai-conductor/src/cli/commands/review.ts)

Pipeline:

- [`src/orchestrator/pipeline/parser.ts`](C:/ai-conductor/src/orchestrator/pipeline/parser.ts)
- [`src/orchestrator/pipeline/validator.ts`](C:/ai-conductor/src/orchestrator/pipeline/validator.ts)

Roles and parsing:

- [`src/roles/index.ts`](C:/ai-conductor/src/roles/index.ts)
- [`src/roles/system-prompts.ts`](C:/ai-conductor/src/roles/system-prompts.ts)
- [`src/roles/context-budgets.ts`](C:/ai-conductor/src/roles/context-budgets.ts)
- [`src/agents/prompts.ts`](C:/ai-conductor/src/agents/prompts.ts)
- [`src/agents/parser.ts`](C:/ai-conductor/src/agents/parser.ts)

Agent CLI detection:

- [`src/config/agents.ts`](C:/ai-conductor/src/config/agents.ts)

Tests:

- [`tests/pipeline/validate.test.ts`](C:/ai-conductor/tests/pipeline/validate.test.ts)
- [`tests/agents/prompts.test.ts`](C:/ai-conductor/tests/agents/prompts.test.ts)
- [`tests/agents/parser.test.ts`](C:/ai-conductor/tests/agents/parser.test.ts)
- [`tests/agents/adapters.test.ts`](C:/ai-conductor/tests/agents/adapters.test.ts)
- [`tests/cli/review-launcher.test.ts`](C:/ai-conductor/tests/cli/review-launcher.test.ts)
- [`tests/cli/run.test.ts`](C:/ai-conductor/tests/cli/run.test.ts)
- [`tests/context/builder.test.ts`](C:/ai-conductor/tests/context/builder.test.ts)

Execution:

- [`src/agents/runner.ts`](C:/ai-conductor/src/agents/runner.ts)
- [`src/agents/adapters/types.ts`](C:/ai-conductor/src/agents/adapters/types.ts)
- [`src/agents/adapters/claude.ts`](C:/ai-conductor/src/agents/adapters/claude.ts)
- [`src/agents/adapters/codex.ts`](C:/ai-conductor/src/agents/adapters/codex.ts)
- [`src/agents/adapters/gemini.ts`](C:/ai-conductor/src/agents/adapters/gemini.ts)
- [`src/execution/workspace.ts`](C:/ai-conductor/src/execution/workspace.ts)
- [`src/orchestrator/pipeline/executor.ts`](C:/ai-conductor/src/orchestrator/pipeline/executor.ts)

Context:

- [`src/context/builder.ts`](C:/ai-conductor/src/context/builder.ts)
- [`src/context/files.ts`](C:/ai-conductor/src/context/files.ts)
- [`src/context/git.ts`](C:/ai-conductor/src/context/git.ts)
- [`src/context/ripgrep.ts`](C:/ai-conductor/src/context/ripgrep.ts)
- [`src/context/tokenguard.ts`](C:/ai-conductor/src/context/tokenguard.ts)

Consensus and audit:

- [`src/consensus/engine.ts`](C:/ai-conductor/src/consensus/engine.ts)
- [`src/consensus/report.ts`](C:/ai-conductor/src/consensus/report.ts)
- [`src/audit/logger.ts`](C:/ai-conductor/src/audit/logger.ts)
- [`src/audit/reader.ts`](C:/ai-conductor/src/audit/reader.ts)
- [`src/audit/diff.ts`](C:/ai-conductor/src/audit/diff.ts)
- [`src/cli/commands/audit.ts`](C:/ai-conductor/src/cli/commands/audit.ts)

## Working Commands

Install:

```powershell
npm install
```

Build:

```powershell
npm run build
```

Test:

```powershell
npm test
```

Validate pipeline:

```powershell
node .\dist\src\cli\index.js validate --pipeline "execute:codex"
```

Validate installed CLIs:

```powershell
node .\dist\src\cli\index.js validate
```

Dry-run pipeline:

```powershell
node .\dist\src\cli\index.js run --task "Refactor auth middleware" --pipeline "architect:claude > execute:codex > review:gemini" --dry-run --repo-summary "TypeScript service" --tech-stack TypeScript Vitest
```

Live pipeline:

```powershell
node .\dist\src\cli\index.js run --task "Investigate the implementation and return only the structured review JSON." --pipeline "review:claude > review:gemini" --repo-summary "TypeScript service"
```

Shortcut plan review:

```powershell
node .\dist\src\cli\index.js review plan .\docs\IMPLEMENTATION_PLAN.md
```

Shortcut investigation review:

```powershell
node .\dist\src\cli\index.js review investigation .\docs\investigations\ambient-weather.md
```

Shortcut implementation review:

```powershell
node .\dist\src\cli\index.js review implementation .\review-instructions.md
```

Interactive review launcher:

```powershell
node .\dist\src\cli\index.js review
```

## Environment Notes

- This workspace is on Windows.
- CLI detection in [`src/config/agents.ts`](C:/ai-conductor/src/config/agents.ts) resolves Windows npm shims via `where.exe`.
- The repository may not be a Git repo yet. Do not assume `.git` exists during early phases.
- Each provider CLI must be authenticated in whatever way that CLI expects. In this workspace, local Gemini live verification was blocked by missing auth; `GEMINI_API_KEY` is one common setup path, but not the only possible one.
- Real `run` executions now persist session logs under `.mrev/sessions/`.
- Real `run` executions now persist Markdown reports under `.mrev/reports/`.
- `.mrev/config.yaml` is now live and may contain real local presets/defaults.
- The reviewed repo may also define `review_launcher.investigations_folder`, `review_launcher.plans_folder`, and `review_launcher.reviews_folder` in its own `.mrev/config.yaml` for the terminal workflow picker. `review_launcher.files_folder` still works as a fallback.
- The global config currently pins:
  - Claude: `claude-opus-4-6`
  - Codex: `gpt-5.4`
  - Gemini: `gemini-3-pro-preview`

## Post-V1 Guidance

If continuing after the planned V1 phases:

1. Treat the current repository as a working V1 baseline.
2. Prefer features that strengthen the staged author/reviewer workflow over features that preserve generic orchestration flexibility.
3. Keep V2-only features isolated from the V1 execution path.
4. Re-read the implementation plan and AGENTS file before changing scope.
5. Keep the product headless and CLI-only unless the spec is explicitly revised.

## Resume Checklist

If starting a fresh session:

1. Read [README.md](C:/ai-conductor/README.md).
2. Read this file.
3. Run:
   - `npm install`
   - `npm run build`
   - `npm test`
4. Confirm current phase from the plan.
5. Continue from the next incomplete phase only.
