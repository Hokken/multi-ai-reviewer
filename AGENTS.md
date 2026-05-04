# Multi AI Reviewer Workspace Guide

## Purpose

This repository contains **Multi AI Reviewer**, a CLI-first multi-LLM author/reviewer workflow tool for Claude Code, Codex CLI, and Gemini CLI.

The primary workflow is staged:

1. investigation
2. review investigation
3. implementation plan
4. review plan
5. implementation
6. review implementation
7. validation passes until ready to commit

Core product constraints:

- advisory-only
- CLI-only
- headless execution for the review engine
- `execute` returns a unified diff as text, not workspace edits

The terminal review launcher exposed by `mrev review` is part of the shipped CLI surface. Do not describe the product as having no interactive workflow support.

## Source Of Truth

Primary product guide:

- [README.md](README.md)

When resuming work, read the README first and keep this file aligned with the shipped behavior.

## Current Status

Planned V1 phases are complete.

Current direction:

- keep the product CLI-only and advisory-only
- treat staged author/reviewer workflows as the primary product surface
- keep raw pipelines available, but position them as advanced/internal usage
- keep V2-only ideas isolated from the V1 execution path

## Key Decisions

These are load-bearing:

1. The product runs directly in the real workspace.
2. `execute` returns a unified diff, not file writes.
3. Hooks remain deferred to V2.
4. Session logs are step-based, not round-based.
5. Consensus aggregates across all `review` steps.
6. Auto-context fallback is staged diff only; otherwise warn and run task-only.
7. Minimum supported CLI versions are:
   - Claude: `2.1.71`
   - Codex: `0.111.0`
   - Gemini: `0.32.1`
8. Built-in review shortcuts are:
   - `mrev review investigation <investigationFile>`
   - `mrev review plan <planFile>`
   - `mrev review implementation <instructionsFile>`
9. The product surface is CLI-only. Do not reintroduce a local web UI without an explicit spec update.
10. `mrev review` with no file may start a terminal launcher that reads `review_launcher` from the reviewed repo's `.mrev/config.yaml`.
11. Review workflows support provider-specific reviewer model overrides, but only one reviewer per provider in a single run.
12. Investigation review, plan review, implementation review, and validation passes matter more than the raw pipeline DSL for the main product experience.

## Important Files

Core types:

- [`src/types/index.ts`](src/types/index.ts)

CLI:

- [`src/cli/index.ts`](src/cli/index.ts)
- [`src/cli/review-launcher.ts`](src/cli/review-launcher.ts)
- [`src/cli/commands/review.ts`](src/cli/commands/review.ts)
- [`src/cli/commands/run.ts`](src/cli/commands/run.ts)
- [`src/cli/commands/validate.ts`](src/cli/commands/validate.ts)
- [`src/cli/commands/audit.ts`](src/cli/commands/audit.ts)
- [`src/cli/commands/preset.ts`](src/cli/commands/preset.ts)

Pipeline and execution:

- [`src/orchestrator/pipeline/parser.ts`](src/orchestrator/pipeline/parser.ts)
- [`src/orchestrator/pipeline/validator.ts`](src/orchestrator/pipeline/validator.ts)
- [`src/orchestrator/pipeline/executor.ts`](src/orchestrator/pipeline/executor.ts)
- [`src/execution/workspace.ts`](src/execution/workspace.ts)

Roles and agent integration:

- [`src/roles/index.ts`](src/roles/index.ts)
- [`src/roles/system-prompts.ts`](src/roles/system-prompts.ts)
- [`src/roles/context-budgets.ts`](src/roles/context-budgets.ts)
- [`src/agents/prompts.ts`](src/agents/prompts.ts)
- [`src/agents/parser.ts`](src/agents/parser.ts)
- [`src/agents/runner.ts`](src/agents/runner.ts)
- [`src/agents/adapters/claude.ts`](src/agents/adapters/claude.ts)
- [`src/agents/adapters/codex.ts`](src/agents/adapters/codex.ts)
- [`src/agents/adapters/gemini.ts`](src/agents/adapters/gemini.ts)
- [`src/config/agents.ts`](src/config/agents.ts)

Context:

- [`src/context/builder.ts`](src/context/builder.ts)
- [`src/context/files.ts`](src/context/files.ts)
- [`src/context/git.ts`](src/context/git.ts)
- [`src/context/ripgrep.ts`](src/context/ripgrep.ts)
- [`src/context/tokenguard.ts`](src/context/tokenguard.ts)

Consensus and audit:

- [`src/consensus/engine.ts`](src/consensus/engine.ts)
- [`src/consensus/report.ts`](src/consensus/report.ts)
- [`src/audit/logger.ts`](src/audit/logger.ts)
- [`src/audit/reader.ts`](src/audit/reader.ts)
- [`src/audit/diff.ts`](src/audit/diff.ts)

Key tests:

- [`tests/pipeline/validate.test.ts`](tests/pipeline/validate.test.ts)
- [`tests/agents/prompts.test.ts`](tests/agents/prompts.test.ts)
- [`tests/agents/parser.test.ts`](tests/agents/parser.test.ts)
- [`tests/agents/adapters.test.ts`](tests/agents/adapters.test.ts)
- [`tests/cli/review.test.ts`](tests/cli/review.test.ts)
- [`tests/cli/review-launcher.test.ts`](tests/cli/review-launcher.test.ts)
- [`tests/cli/run.test.ts`](tests/cli/run.test.ts)
- [`tests/cli/preset.test.ts`](tests/cli/preset.test.ts)
- [`tests/cli/display.test.ts`](tests/cli/display.test.ts)
- [`tests/context/builder.test.ts`](tests/context/builder.test.ts)
- [`tests/audit/audit.test.ts`](tests/audit/audit.test.ts)

## Working Commands

Install:

```sh
npm install
```

Build:

```sh
npm run build
```

Test:

```sh
npm test
```

Type-check:

```sh
npm run typecheck
```

Validate installed CLIs:

```sh
node ./dist/src/cli/index.js validate
```

Validate a pipeline:

```sh
node ./dist/src/cli/index.js validate --pipeline "execute:codex"
```

Dry-run a raw pipeline:

```sh
node ./dist/src/cli/index.js run --task "Refactor auth middleware" --pipeline "architect:claude > execute:codex > review:gemini" --dry-run --repo-summary "TypeScript service" --tech-stack TypeScript Vitest
```

Start the interactive review launcher:

```sh
node ./dist/src/cli/index.js review
```

Direct review runs require explicit reviewer models:

```sh
node ./dist/src/cli/index.js review plan ./docs/IMPLEMENTATION_PLAN.md --reviewer-models claude=claude-opus-4-7 codex=gpt-5.5
node ./dist/src/cli/index.js review investigation ./docs/investigations/ambient-weather.md --reviewer-models claude=claude-opus-4-7 gemini=gemini-3.1-pro
node ./dist/src/cli/index.js review implementation ./review-instructions.md --reviewer-models codex=gpt-5.5 gemini=gemini-3.1-pro
```

## Environment Notes

- Do not assume the current dev environment is Windows. The codebase includes Windows-specific CLI resolution logic, but contributors may work from other environments.
- CLI detection in [`src/config/agents.ts`](src/config/agents.ts) resolves Windows npm shims via `where.exe` when running on Windows.
- Do not assume `.git` exists when reasoning about early setup or fixture repos.
- Each provider CLI must be installed and authenticated in the way that CLI expects.
- Review runs write session logs to `.mrev/sessions/` and Markdown reports to `.mrev/reports/` in the reviewed repo.
- Repo-local `.mrev/config.yaml` is optional. If present, it can configure the review launcher.
- Default agent models in code are currently:
  - Claude: `claude-opus-4-7`
  - Codex: `gpt-5.5`
  - Gemini: `gemini-3.1-pro`

## Post-V1 Guidance

If continuing product work:

1. Treat the current repository as a working V1 baseline.
2. Prefer features that strengthen the staged author/reviewer workflow over features that preserve generic orchestration flexibility.
3. Keep V2-only features isolated from the V1 execution path.
4. Re-read [README.md](README.md) and this file before changing scope.
5. Keep the product CLI-only unless the spec is explicitly revised.

## Resume Checklist

If starting a fresh session:

1. Read [README.md](README.md).
2. Read this file.
3. Run `npm install`.
4. Run `npm run build`.
5. Run `npm test`.
6. Confirm current scope before making product changes.
