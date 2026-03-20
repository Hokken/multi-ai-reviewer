---
name: mrev-review
description: Create or update a workflow review artifact markdown file for the current session. Use when preparing investigation artifacts, implementation plans, or implementation review instructions for later multi-LLM review passes.
---

Create or update a workflow review artifact markdown file for the current session.

This applies to any software project, not just AI/LLM systems. Adapt the sections below to whatever was changed, including application code, libraries, scripts, migrations, infrastructure, configuration, docs, or mixed changes.

Treat this as a workflow artifact generator for one of these modes:

- `investigation`
- `plan`
- `implementation`

Determine the mode from the session context and the artifact being updated:

- use `investigation` when the session produced or updated an investigation artifact
- use `plan` when the session produced or updated an implementation plan
- use `implementation` when the session produced or updated implementation review instructions

If the mode is ambiguous, infer the best fit from the completed work instead of asking unless the ambiguity is material.

## Artifact Path

Resolve the target path from the reviewed repo's local config first:

`.mrev/config.yaml`

Look under:

```yaml
review_launcher:
  investigations_folder: docs/investigations
  plans_folder: docs/plans
  reviews_folder: docs/reviews
```

Use these folder rules:

- `investigation` -> `review_launcher.investigations_folder`
- `plan` -> `review_launcher.plans_folder`
- `implementation` -> `review_launcher.reviews_folder`

If the mode-specific folder is missing, fall back to `review_launcher.files_folder`.

If neither is configured, fall back to these conventional repo-relative folders:

- `investigation` -> `docs/investigations`
- `plan` -> `docs/plans`
- `implementation` -> `docs/reviews`

Name the file using a short kebab-case feature summary:

- `investigation` -> `<feature-name>-investigation.md`
- `plan` -> `<feature-name>-plan.md`
- `implementation` -> `<feature-name>-review.md`

If the user supplied a feature name in `$ARGUMENTS`, use it for `<feature-name>`.
If no feature name was provided, infer a reasonable kebab-case name from the work completed in this session.

For `implementation` mode, if the work has moved to a new phase, milestone, or materially different implementation slice, create a new review artifact instead of rewriting the earlier implementation review file. Reusing the older file can leave stale `FIXES APPLIED` and `PRIOR REPORTS` entries behind, which can make a fresh review look like a validation pass when it is really a new first pass for later work.

When creating a later implementation review artifact, preserve the earlier implementation review artifact and point to it from the new file so reviewers can recover the relevant prior phase context. Prefer filenames that make the slice obvious, such as `<feature-name>-phase-2-review.md` or `<feature-name>-step-2-review.md`.

If the target file already exists and it represents the same artifact for the same workflow slice:
- update it in place
- preserve the existing content
- refresh any sections that are now stale
- append new entries to the `FIXES APPLIED` section instead of creating a second artifact for the same work

## Goal

Produce a self-contained workflow artifact that another LLM can read without any session context.

The reviewer should be able to understand:
- what changed
- why it changed
- where to inspect
- what risks to validate
- how prior review findings were addressed on later passes
- which mode this artifact belongs to
- which model authored it
- which models are expected to review it

## What to include

### Header Metadata

Start the file with a compact metadata block that includes:

- `Mode: investigation | plan | implementation`
- `Author: <provider>`
- `Author Model: <full model id>` when known
- `Intended Reviewers: <provider/model list>` when known
- `Status: first pass | validation pass`

If the exact reviewer models are not yet fixed, record the intended reviewer providers at minimum.

### Summary

Write 2-3 sentences covering:
- what was changed and why
- which systems, prompt families, event paths, or workflows are affected
- whether the change is Python-only, C++ only, SQL only, config only, or mixed
- whether the behavior is gated by mode, config, feature flag, or always on

### Changed Files

For each modified file, describe:
- what changed
- which functions, classes, queries, constants, imports, or configs were added or modified
- design decisions worth scrutinizing
- any hardcoded values that may deserve configuration

Be precise about function names and file paths.

### Architecture Context

Explain how the investigation, plan, or implementation fits into the broader system.

Include, where relevant:
- what calls the changed code
- what the changed code calls
- the data flow across C++, SQL, Python, config, bridge logic, and message delivery
- which existing infrastructure is reused and which pieces are new

### Review Checklist

Organize the checklist into these sections when relevant:

- **Scope**
- **Correctness**
- **Prompt Quality**
- **Edge Cases**
- **Integration**

Focus on things like:
- whether the artifact is the right mode and at the right stage of the workflow
- SQL correctness
- type safety
- null / `None` handling
- map or dict key alignment
- prompt consistency and duplication
- empty or missing data
- first-actor / first-bot edge cases
- deployment or config implications
- whether compilation, DB migrations, or config changes are required

### Potential Concerns

Call out anything the reviewer should inspect carefully.

Include:
- unverified assumptions, clearly labeled as hypotheses
- cost implications such as extra LLM calls or token usage
- deviations from project conventions
- risks around hardcoded values, config drift, hidden coupling, or partial gating

### Testing Steps

List concrete validation steps.

Include:
- how to trigger the behavior
- what to verify at runtime or in the affected user/developer workflow
- what to inspect in logs
- edge-case scenarios worth testing
- whether automated coverage exists
- if no automated coverage exists, say so explicitly

### Files to Read

Provide a table of relevant files with a short purpose description.

Include:
- modified files
- important unmodified context files
- upstream or downstream integration files
- important supporting code or data files even if unchanged
- schema, migration, infrastructure, or config files needed to understand runtime behavior

### RELATED ARTIFACTS

When this artifact continues, supersedes, or depends on an earlier artifact from the same workflow, include a `RELATED ARTIFACTS` section before `PRIOR REPORTS`.

For multi-phase implementation work, always list the previous implementation review artifact path here so reviewers can recover the earlier phase context without mistaking the new artifact for a validation pass.

Use repo-relative paths.

Example:

```md
## RELATED ARTIFACTS

- docs/reviews/feature-phase-1-review.md
- docs/plans/feature-plan.md
```

Do not put prior review artifact paths in `PRIOR REPORTS` unless they are actual Multi AI Reviewer report files under `.mrev/reports/`.

### PRIOR REPORTS

If this is a validation pass, always include a `PRIOR REPORTS` section before `FIXES APPLIED`.

List the most recent generated Multi AI Reviewer report that should remain in reviewer context, using a repo-relative path under `.mrev/reports/`.

Example:

```md
## PRIOR REPORTS

- .mrev/reports/2026-03-08-first-pass.md
```

Replace older entries with the newest prior report as later passes occur. Do not accumulate every historical report in this section for standard validation passes.

If the artifact already contains a `PRIOR REPORTS` section:

- preserve it
- replace older `.mrev/reports/...` entries with the single most recent prior-pass report path

If this is not the first pass and the artifact does not yet contain `PRIOR REPORTS`, create the section automatically.

Treat this as required on later passes, not optional. Reviewers depend on this path to retain context from the immediately previous report.

## FIXES APPLIED

Always include a `FIXES APPLIED` section at the bottom of the artifact, including:

- investigation files
- plan files
- implementation review instruction files

This section must exist even on the first pass so later validation passes stay structurally consistent.

On the first pass, keep it present but intentionally empty.

Use this exact empty-first-pass form:

```md
## FIXES APPLIED

This section is intentionally empty on the first pass.
```

On later passes, populate it so reviewers can validate whether prior findings were correctly addressed.

### Mandatory: apply fixes to the codebase or artifact first

Before adding entries to this section, you MUST actually implement the reviewer's suggestions in the code or artifact. Do not just document the fix — apply it. The FIXES APPLIED section is a record of work you already did, not a plan for future work. If a reviewer says to rename a variable, rename it. If a reviewer says to add error handling, add it. If a reviewer says to restructure a section, restructure it. Skipping the actual fix and only updating this section defeats the entire purpose of the review workflow.

### Previous fix entries are immutable

Existing `#### Fix N:` entries from prior passes MUST NOT be altered, reworded, reordered, or removed. They are an append-only historical record. When adding new fixes after a new review pass, continue the numbering sequentially from where it left off (e.g., if Fix 1 through Fix 4 already exist, the next entry is Fix 5). Never renumber, merge, split, or edit earlier entries.

Reviewers should use this section to understand:
- what was fixed
- how it was fixed
- what was intentionally not fixed
- what may still remain partially unresolved

For each fix, use this format:

#### Fix N: <short description>
- **Reviewer**: <which LLM or reviewer raised it>
- **Severity**: <low|medium|high|critical>
- **Issue**: <what they identified>
- **Resolution**: <what changed and where>
- **Files Touched**: <file list>
- **Status**: fixed | partially fixed | not fixed
- **Notes**: <optional rationale, limitation, or follow-up>

Do not omit reviewer findings that were intentionally not implemented.
If a suggestion was declined, record it here with:
- `Status: not fixed`
- a short rationale for why it was not applied

If this is not the first pass and there are prior Multi AI Reviewer reports, make sure the `PRIOR REPORTS` section and the `FIXES APPLIED` entries agree with each other.

When updating an existing artifact after a review pass, always preserve or append the `PRIOR REPORTS` section before updating `FIXES APPLIED`.

## Writing Guidelines

- Be precise about file paths, line references when useful, and function names
- Do not assume the reviewer remembers the session
- Explain context clearly and compactly
- Frame unverified claims as hypotheses, not facts
- State the workflow mode explicitly and keep the artifact consistent with that mode
- If behavior is mode-gated, config-gated, or feature-flagged, say so explicitly
- If there is no automated test coverage, say so clearly
- Prefer concrete technical detail over vague summaries
- Prefer repo-relative paths inside the document
- Preserve prior-pass continuity instead of rewriting history

## Output Requirements

Write or update the markdown file at the required path.

After writing it, report:
- the final file path
- the selected mode
- the chosen feature-name
- whether the file was newly created or updated in place
