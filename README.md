# Multi AI Reviewer

CLI tool that coordinates reviews across Claude Code, Codex CLI, and Gemini CLI.

## What It Does

You write something (an investigation, a plan, or an implementation). Up to three LLMs review it. You fix what they found. They validate your fixes. Repeat until done.

The output is a Markdown report saved to `.mrev/reports/`.

mrev is not an editor. It runs the reviews, collects the results, and writes the report.

## Quick Start

Run `mrev` from the repo you want to review.

**Interactive mode** (picks workflow, reviewers, and files for you):

```powershell
mrev review
```

This works best when the repo has a `.mrev/config.yaml` with folder paths configured (see [Repo Config](#repo-config)).

**Direct mode** (you already have a review artifact):

```powershell
mrev review .\docs\reviews\feature-review.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex
```

mrev reads the artifact, auto-detects whether it is an investigation, plan, or implementation, sends it to the reviewer models, and saves the report.

**Prerequisites:** The provider CLIs (claude, codex, gemini) must be installed and authenticated. Check with `mrev validate`. Common auth methods are API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) or login-based flows.

## Typical Workflow

1. Write an investigation
2. `mrev review` the investigation
3. Write an implementation plan
4. `mrev review` the plan
5. Implement from the validated plan
6. `mrev review` the implementation
7. Fix issues, update `FIXES APPLIED` in the artifact, add prior report paths under `Prior Reports`, and rerun until clean

First-pass reviews are broad. Later passes focus on validating the fixes you claimed in `FIXES APPLIED` against what the prior reports actually found.

## Common Commands

```powershell
# Interactive launcher
mrev review

# Review a specific file (auto-detects type, models must be explicit)
mrev review .\artifact.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex

# Force the review type with a subcommand
mrev review investigation .\docs\investigations\ambient-weather.md --reviewer-models claude=claude-sonnet-4-6 gemini=gemini-3-flash-preview
mrev review plan .\docs\plans\feature-plan.md --reviewer-models codex=gpt-5.2-codex gemini=gemini-3.1-pro-preview
mrev review implementation .\docs\reviews\feature-review.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex

# Add extra instructions to steer reviewers
mrev review .\artifact.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex --instructions "Focus on error handling."

# Check that CLIs are installed and meet minimum versions
mrev validate
```

## Outputs

Each review run saves two files:

| What | Where |
|------|-------|
| JSON session log | `.mrev/sessions/` |
| Markdown report | `.mrev/reports/` |

The Markdown report is the one you read. The JSON is for tooling and audit.

To chain validation passes, add the previous report path to your artifact under `Prior Reports`. mrev will include it in reviewer context on the next run.

## Install

```powershell
npm install
npm run build
```

To make `mrev` available globally:

```powershell
npm link
```

Then use it from any repo:

```powershell
cd C:\path\to\other-repo
mrev validate
mrev review .\artifact.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex
```

See [Install In Another Repo](#install-in-another-repo) for other methods (local dependency, tarball).

## Repo Config

The interactive launcher reads `.mrev/config.yaml` from the reviewed repo. This tells it where to find artifacts and what workflows to offer.

```yaml
review_launcher:
  investigations_folder: docs/investigations
  plans_folder: docs/plans
  reviews_folder: docs/reviews
  profiles:
    investigation:
      mode: investigation
    plan:
      mode: plan
    review:
      mode: implementation
```

With this in place, `mrev review` opens a terminal menu where you pick a workflow, select reviewers, and choose a file.

`mode` can be `investigation`, `plan`, or `implementation`. If omitted, mrev auto-detects from the file content. You can add `default_reviewers` if you want repo-specific defaults, but it is optional.

`files_folder` is a legacy fallback when mode-specific folders are not set.

## CLI Reference

### `mrev review`

The main command. Without a file argument (or with `--interactive`), it starts the interactive launcher. With a file, it runs the review directly.

For direct CLI review runs, reviewer models must be explicit. Use `--reviewer-models` or the per-provider model flags for every active reviewer. The interactive launcher already prompts for this.

**Subcommands** (force the review type instead of auto-detecting):
- `mrev review investigation <file>`
- `mrev review plan <file>`
- `mrev review implementation <file>`

**Flags** (work on all review subcommands):

| Flag | Description |
|------|-------------|
| `--reviewers <agents...>` | Which agents review. If omitted, review runs use all three providers, so you must provide a model for each one. |
| `--reviewer-models <entries...>` | Per-reviewer model overrides, e.g. `claude=claude-sonnet-4-6`. |
| `--instructions <text>` | Extra instructions appended to the reviewer task. |
| `--mode <kind>` | Force review mode without using a subcommand. |
| `--files <paths...>` | Extra files to include as context. |
| `--repo-summary <text>` | Short description of the repo for context. |
| `--tech-stack <items...>` | Tech stack hints (e.g. `TypeScript Vitest`). |
| `--claude-model <model>` | Override the Claude model for this run. |
| `--codex-model <model>` | Override the Codex model for this run. |
| `--gemini-model <model>` | Override the Gemini model for this run. |
| `--dry-run` | Print the prompts that would be sent, without calling any CLI. |
| `--verbose` | Stream raw agent output instead of showing a spinner. |
| `--gemini-strict` | Fail the run if Gemini structured output parsing fails. |
| `--interactive` | Force the interactive launcher even if a file is provided. |

### `mrev run`

Advanced command for raw pipeline execution. Most users should use `mrev review` instead.

```powershell
mrev run --task "Review auth middleware" --pipeline "review:claude > review:gemini"
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--task <text>` | Task description. |
| `--task-file <path>` | Read the task from a file instead of the command line. |
| `--pipeline <dsl>` | Pipeline DSL (see [Pipelines](#pipelines)). |
| `--preset <name>` | Load a saved pipeline preset. |
| `--files <paths...>` | Files to include as context. |
| `--diff` | Include staged git diff in context. |
| `--symbol <name>` | Symbol name to search for in context. |
| `--repo-summary <text>` | Short repo description. |
| `--tech-stack <items...>` | Tech stack hints. |
| `--claude-model <model>` | Override the Claude model. |
| `--codex-model <model>` | Override the Codex model. |
| `--gemini-model <model>` | Override the Gemini model. |
| `--dry-run` | Print prompts without running. |
| `--verbose` | Stream raw agent output. |
| `--gemini-strict` | Fail if Gemini parsing fails. |

If no explicit context is provided, mrev falls back to staged diff. If there is no staged diff, it warns and runs with task-only context.

### `mrev validate`

Checks that the agent CLIs are installed and meet minimum version requirements.

```powershell
mrev validate
```

You can also validate a pipeline string:

```powershell
mrev validate --pipeline "architect:claude > execute:codex > review:gemini"
```

### `mrev audit`

Inspect past review sessions.

```powershell
mrev audit list                  # List all sessions
mrev audit show <session-id>     # Show full session JSON
mrev audit diff <session-id>     # Show diffs from a session
mrev audit search "keyword"      # Search sessions by task keyword
```

### `mrev preset`

Save and manage reusable pipeline configurations.

```powershell
mrev preset save quick --pipeline "execute:codex" --description "Fast single-step executor"
mrev preset list
mrev preset show quick
mrev preset delete quick
```

Use a saved preset with `mrev run`:

```powershell
mrev run --task "Review the code." --preset quick
```

## Pipelines

Pipelines describe which models run which roles, and in what order.

**Format:** `role:agent`, separated by `>` (sequential) or `|` (parallel).

**Roles:** `architect`, `execute`, `review`, `revise`, `summarise`

**Agents:** `claude`, `codex`, `gemini`

**Examples:**

```text
review:claude > review:gemini              # Claude reviews, then Gemini reviews
review:codex | review:gemini               # Codex and Gemini review in parallel
architect:claude > execute:codex > review:gemini   # Plan, build, review
review:codex | review:gemini > summarise:claude     # Parallel reviews, then summary
```

The `|` separator runs steps at the same time. The `>` separator waits for the previous group to finish before starting the next.

If you do not want to think about pipelines, use `mrev review <file>` and pass the reviewer models explicitly.

## Project Config

Global defaults for the `run` command live in the mrev install directory at `.mrev/config.yaml`:

```yaml
default_pipeline: "architect:claude > execute:codex > review:claude"

agent_models:
  claude: "claude-opus-4-6"
  codex: "gpt-5.4"
  gemini: "gemini-3.1-pro"

prompts:
  architect: |
    You are the architect for a headless, read-only orchestration pipeline.
    Reason concisely, name tradeoffs explicitly, and propose a clear implementation approach.
    Do not output markdown fences.
    Return only a valid JSON object.
```

All fields are optional. If `prompts` is omitted, built-in role prompts are used.

This is separate from the repo-local `.mrev/config.yaml` in the target repo, which only controls the interactive review launcher (see [Repo Config](#repo-config)).

## Install In Another Repo

Always run `mrev` from the target repo root. It uses the current working directory for reading files, staged diffs, and config, and writes session/report output to `.mrev/` in that repo.

### Global install (recommended for development)

```powershell
# From the mrev repo:
npm install && npm run build && npm link

# From any other repo:
cd C:\path\to\other-repo
mrev validate
mrev review .\artifact.md --reviewer-models claude=claude-sonnet-4-6 codex=gpt-5.2-codex
```

### Local dependency

```powershell
npm install --save-dev C:\path\to\multi-ai-reviewer
npx mrev validate
```

### Packed tarball

```powershell
# From the mrev repo:
npm pack

# From another repo:
npm install --save-dev .\multi-ai-reviewer-0.1.0.tgz
```

## Development

```powershell
npm run build       # Build
npm test            # Run tests
npm run typecheck   # Type-check without emitting
npm run dev         # Run from source via tsx
```

The root handoff file is [AGENTS.md](C:/ai-conductor/AGENTS.md).
