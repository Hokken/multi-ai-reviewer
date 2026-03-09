import { z } from "zod";

import type {
  ArchitectOutput,
  ExecutorOutput,
  ReviewOutput,
  ReviseOutput,
  RoleId,
  SummaryOutput,
} from "../types/index.js";

const reviewIssueSchema = z.object({
  file: z.string().nullable(),
  line: z.number().int().nullable(),
  description: z.string(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  suggestion: z.string(),
});

export const architectOutputSchema = z.object({
  rationale: z.string(),
  proposed_approach: z.string(),
  confidence: z.number().min(0).max(1),
  concerns: z.array(z.string()),
  suggested_tests: z.array(z.string()),
}) satisfies z.ZodType<ArchitectOutput>;

export const executorOutputSchema = z.object({
  unified_diff: z.string(),
  files_affected: z.array(z.string()),
  shell_commands: z.array(z.string()),
  edge_cases: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ExecutorOutput>;

export const reviewOutputSchema = z.object({
  verdict: z.enum(["approve", "revise", "reject"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  issues: z.array(reviewIssueSchema),
  security_flags: z.array(z.string()),
  cross_file_concerns: z.array(z.string()),
  agrees_with_prior_reviews: z.boolean().nullable(),
  prior_review_disagreements: z.array(z.string()),
  suggested_revision: z.string().nullable(),
}) satisfies z.ZodType<ReviewOutput>;

export const reviseOutputSchema = z.object({
  revised_unified_diff: z.string(),
  rationale: z.string(),
  addressed_issues: z.array(z.string()),
  unresolved: z.array(z.string()),
  confidence: z.number().min(0).max(1),
}) satisfies z.ZodType<ReviseOutput>;

export const summaryOutputSchema = z.object({
  decision: z.string(),
  key_issues_found: z.array(z.string()),
  changes_proposed: z.array(z.string()),
  open_questions: z.array(z.string()),
  recommendation: z.string(),
}) satisfies z.ZodType<SummaryOutput>;

export function getRoleOutputSchema(role: RoleId) {
  switch (role) {
    case "architect":
      return architectOutputSchema;
    case "execute":
      return executorOutputSchema;
    case "review":
      return reviewOutputSchema;
    case "revise":
      return reviseOutputSchema;
    case "summarise":
      return summaryOutputSchema;
  }
}

export const OUTPUT_CONTRACTS: Record<RoleId, string> = {
  architect: JSON.stringify(architectOutputSchema.toJSONSchema(), null, 2),
  execute: JSON.stringify(executorOutputSchema.toJSONSchema(), null, 2),
  review: JSON.stringify(reviewOutputSchema.toJSONSchema(), null, 2),
  revise: JSON.stringify(reviseOutputSchema.toJSONSchema(), null, 2),
  summarise: JSON.stringify(summaryOutputSchema.toJSONSchema(), null, 2),
};

