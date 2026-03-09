import type { ConsensusReport } from "../types/index.js";

export function formatConsensusReport(report: ConsensusReport | null): string {
  if (!report) {
    return "No review steps were present, so no consensus report was produced.";
  }

  return [
    `Consensus: ${report.recommendation}`,
    `Severity: ${report.overallSeverity}`,
    `Confidence: ${report.confidence.toFixed(2)}`,
    report.summary,
  ].join("\n");
}

