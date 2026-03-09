---
name: investigate
description: Investigate a topic, bug, or system area and produce a structured investigation report in docs/investigations. Use when you need to deeply research a codebase concern, bug, incident, or architectural question and capture findings for future reference.
argument-hint: "subject-of-investigation"
---

Investigate the subject provided in `$ARGUMENTS` and produce a structured investigation report.

If no subject was provided, infer the investigation topic from the current session context. If the topic is still ambiguous, ask the user.

## Output Path

Place the investigation report at:

```
docs/investigations/<subject-name>-investigation.md
```

Use a short kebab-case name derived from `$ARGUMENTS` for `<subject-name>`.

If `docs/investigations/` does not exist, create it.

If the target file already exists:

- update it in place
- preserve existing content
- refresh any sections that are now stale
- append or update the `FIXES APPLIED` section instead of creating a duplicate artifact

## Goal

Produce a self-contained investigation report that anyone (human or LLM) can read without any session context and fully understand:

- what was investigated
- why it was investigated
- what was found
- what conclusions were drawn
- what actions are recommended

## Investigation Process

1. **Understand the subject** — Read relevant code, configs, logs, docs, and prior investigations
2. **Trace the behavior** — Follow the code paths, data flows, and dependencies involved
3. **Identify root causes or key findings** — Distinguish confirmed facts from hypotheses
4. **Document everything** — Capture findings in the report as you go

## Report Structure

### Header Metadata

Start the file with a compact metadata block:

- `Subject: <investigation subject>`
- `Author Model: <full model id>` when known
- `Date: <YYYY-MM-DD>`
- `Status: in progress | complete`

### Summary

Write 2-3 sentences covering:

- what was investigated and why
- the key finding or conclusion in one line
- which systems, files, or workflows are involved

### Background

Explain the context that motivated the investigation:

- what behavior was observed or what question was raised
- what the expected behavior or answer should be
- any relevant history or prior work

### Findings

Document each finding clearly. For each finding:

- **What was found** — describe the observation or discovery
- **Where** — file paths, function names, line numbers
- **Evidence** — code snippets, log excerpts, or data that support the finding
- **Impact** — what this means for the system or users

Label unverified claims as hypotheses, not facts.

### Root Cause (if applicable)

If investigating a bug or incident:

- the identified root cause
- the chain of events or code path that leads to the issue
- why it was not caught earlier (if relevant)

### Architecture Context

Explain how the investigated area fits into the broader system:

- what calls the relevant code
- what the relevant code calls
- data flow across the affected components
- which existing infrastructure is involved

### Recommendations

List concrete next steps:

- fixes to apply
- refactors to consider
- tests to add
- monitoring or alerts to set up
- further investigations needed

Prioritize recommendations by impact and effort.

### Files Examined

Provide a table of relevant files with a short purpose description:

- files that were central to the investigation
- important context files
- upstream or downstream integration files
- config, schema, or infrastructure files

### PRIOR REPORTS

If this investigation updates a previous one, list every prior report path:

```md
## PRIOR REPORTS

- docs/investigations/2026-03-08-initial-investigation.md
```

Preserve existing entries and append new ones as later passes occur. Do not remove older reports unless clearly unrelated.

If the artifact already contains a `PRIOR REPORTS` section:

- preserve it
- keep existing report paths
- append any new prior-pass report paths that are now relevant

## FIXES APPLIED

Always include a `FIXES APPLIED` section at the bottom of the report.

This section must exist even on the first pass so later updates stay structurally consistent.

On the first pass, use this exact form:

```md
## FIXES APPLIED

This section is intentionally empty on the first pass.
```

On later passes, populate it so readers can see whether prior findings were addressed.

For each fix, use this format:

#### Fix N: <short description>

- **Severity**: <low|medium|high|critical>
- **Issue**: <what was identified>
- **Resolution**: <what changed and where>
- **Files Touched**: <file list>
- **Status**: fixed | partially fixed | not fixed
- **Notes**: <optional rationale, limitation, or follow-up>

If a recommendation was intentionally not implemented, record it with:

- `Status: not fixed`
- a short rationale for why it was not applied

## Writing Guidelines

- Be precise about file paths, line references, and function names
- Do not assume the reader has any session context
- Explain context clearly and compactly
- Frame unverified claims as hypotheses, not facts
- If there is no automated test coverage for the area, say so clearly
- Prefer concrete technical detail over vague summaries
- Use repo-relative paths inside the document
- Preserve prior-pass continuity instead of rewriting history

## Output Requirements

After writing the report, tell the user:

- the final file path
- the investigation subject
- whether the file was newly created or updated in place
- a brief summary of key findings
