---
name: mrev-plan
description: Create or update an implementation plan markdown artifact for the current session. Use when turning an investigation or scoped request into a sequenced plan that is meant to be reviewed later with mrev review plan.
argument-hint: "feature-name"
---

Create or update an implementation plan markdown artifact for the current session.

Use this after investigation and before implementation. The output should be a self-contained plan that another LLM can review with `mrev review plan <planFile>` without any extra session context.

If the user provided a feature name in `$ARGUMENTS`, use it. If not, infer it from the current session context. If the target subject is still materially ambiguous, ask the user.

## Artifact Path

Resolve the target path from the reviewed repo's local config first:

`.mrev/config.yaml`

Look under:

```yaml
review_launcher:
  plans_folder: docs/plans
```

Use these folder rules:

- prefer `review_launcher.plans_folder`
- if that is missing, fall back to `review_launcher.files_folder`
- if neither is configured, fall back to `docs/plans`

Name the file:

```text
<feature-name>-plan.md
```

Use a short kebab-case feature summary for `<feature-name>`.

If the target file already exists:

- update it in place
- preserve useful existing content
- refresh sections that are stale
- preserve `PRIOR REPORTS` only when the artifact already uses it for fallback/history
- append or update `FIXES APPLIED` instead of creating a duplicate artifact

## Goal

Produce a self-contained implementation plan that a reviewer can assess for:

- correctness
- feasibility
- sequencing
- risk coverage
- validation quality
- completeness

The reviewer should be able to understand:

- what is being built
- why it is being built
- what constraints shape the work
- what order the work should happen in
- which files and systems matter
- how success will be verified
- how prior review findings were addressed on later passes

## Planning Process

1. Read the relevant request, investigation, code, config, and any prior reports or related artifacts that are actually present
2. Define the outcome, scope boundaries, assumptions, and non-goals
3. Trace the affected architecture and identify dependencies or rollout constraints
4. Break the work into concrete phases and milestones in the safest order
5. Define validation steps, automated coverage, and manual checks
6. Document applied fixes in `FIXES APPLIED`, and update `PRIOR REPORTS` only when explicit fallback/history should remain in the artifact

## Required Structure

Use these headings so the artifact works cleanly with `mrev review plan` and is easy for reviewers to audit.

### Header Metadata

Start the file with a compact metadata block:

- `Mode: plan`
- `Feature: <feature summary>`
- `Author: <provider>` when known
- `Author Model: <full model id>` when known
- `Intended Reviewers: <provider/model list>` when known
- `Date: <YYYY-MM-DD>`
- `Status: first pass | validation pass`

### Title

Use:

```md
# Implementation Plan
```

### Summary

Write 2-3 sentences covering:

- what is changing and why
- which workflows, systems, or code paths are affected
- the key implementation shape in one line

### Goal

Describe the intended end state and what success looks like.

### Scope

Clearly separate:

- in-scope work
- out-of-scope work
- assumptions
- constraints

### Architecture Context

Use:

```md
## Architecture Context
```

Explain:

- what calls the affected code
- what the affected code calls
- the relevant data flow
- what existing infrastructure is reused
- what new infrastructure, config, or operational behavior is introduced

### Milestones

Use:

```md
## Milestones
```

List the major checkpoints the implementation must reach.

### Phase Sections

Use numbered phase headings:

- `## Phase 1`
- `## Phase 2`
- `## Phase 3`

Include only the phases that are actually needed, but always start with `## Phase 1`.

For each phase, include:

- objective
- files or components involved
- concrete implementation steps
- prerequisites or dependencies
- risks and failure modes
- exit criteria

Avoid vague tasks such as "clean up later" or "handle edge cases" without specifics.

### Pipeline

Use:

```md
## Pipeline
```

Describe the execution order and rollout path, including any:

- prerequisite investigations
- migrations
- config changes
- feature flags
- staged rollouts
- review checkpoints
- validation passes

This section should make the implementation sequence obvious to both humans and reviewer models.

### Test Matrix

Use:

```md
## Test Matrix
```

Map scenarios to validation steps. Include:

- automated tests to add or update
- manual checks
- regression scenarios
- edge cases
- observability or logging checks
- deployment verification when relevant

If no automated coverage exists yet, say so explicitly.

### Risks And Open Questions

Call out:

- unverified assumptions
- sequencing risks
- operational risks
- unresolved design decisions
- dependencies on external systems or people

Label hypotheses as hypotheses, not facts.

### Files To Read

Use:

```md
## Files to Read
```

Provide a table of repo-relative files with a short purpose description. Include:

- files likely to change
- important unmodified context files
- config, schema, migration, or infrastructure files
- relevant investigation or related plan artifacts

### PRIOR REPORTS

If this is a validation pass, `PRIOR REPORTS` is optional. Include it only when you want explicit fallback/history in the artifact.

If you include it, list only the most recent prior Multi AI Reviewer report, using a repo-relative path under `.mrev/reports/`.

Example:

```md
## PRIOR REPORTS

- .mrev/reports/2026-03-08-first-pass.md
```

If the artifact already contains a `PRIOR REPORTS` section:

- preserve it
- replace older `.mrev/reports/...` entries with the single most recent prior-pass report path

### FIXES APPLIED

Always include `FIXES APPLIED` at the bottom of the plan.

On the first pass, use this exact form:

```md
## FIXES APPLIED

This section is intentionally empty on the first pass.
```

On later passes, populate `FIXES APPLIED` so reviewers can validate the claimed fixes against the plan. `PRIOR REPORTS` is optional fallback/history, not required for machine continuity.

For each fix, use this format:

```md
#### Fix N: <short description>
- **Reviewer**: <which LLM or reviewer raised it>
- **Severity**: <low|medium|high|critical>
- **Issue**: <what they identified>
- **Resolution**: <what changed and where>
- **Files Touched**: <file list>
- **Status**: fixed | partially fixed | not fixed
- **Notes**: <optional rationale, limitation, or follow-up>
```

If a suggestion was intentionally not implemented, keep it in this section with:

- `Status: not fixed`
- a short rationale

If `PRIOR REPORTS` is present, make sure it and `FIXES APPLIED` stay consistent with each other on later passes.

## Writing Guidelines

- Be precise about file paths, function names, interfaces, and dependencies
- Use repo-relative paths inside the document
- Keep the plan self-contained and understandable without chat history
- Prefer explicit sequencing over broad thematic buckets
- Call out where implementation depends on config, rollout, migrations, or external coordination
- Distinguish confirmed facts from assumptions and open questions
- Keep the plan focused on implementation, not code-review findings or post-hoc change summaries
- Preserve prior-pass continuity instead of rewriting history

## Output Requirements

After writing the artifact, tell the user:

- the final file path
- the feature name
- whether the file was newly created or updated in place
- a short summary of the plan shape
