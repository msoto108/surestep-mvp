// ============================================================
// SureStep Runtime — Report Generator
// ============================================================

import type {
  Run,
  Evidence,
  PackDefinition,
  TechnicalReport,
  UserFacingReport,
  RunReports,
  EvidenceState,
} from "./types";

function formatEvidenceState(state: EvidenceState): string {
  const labels: Record<EvidenceState, string> = {
    NONE: "None",
    PLAUSIBLE: "Plausible",
    EVIDENCE_SUPPORTED: "Evidence-Supported",
    CONFIRMED: "Confirmed",
    INCONCLUSIVE: "Inconclusive",
  };
  return labels[state] ?? state;
}

function formatRole(role: string): string {
  const map: Record<string, string> = {
    TECHNICIAN: "Technician",
    OPERATOR: "Operator",
    OBSERVER: "Observer",
  };
  return map[role] ?? role;
}

function formatCapability(cap: string): string {
  return cap === "TOOL_PROOF_AVAILABLE" ? "Tool Proof Available" : "No Tool Proof";
}

function buildDeterminationSummary(
  evidenceState: EvidenceState,
  primaryCondition: string | null,
  conditionScores: Record<string, number>,
  pack: PackDefinition
): string {
  if (evidenceState === "INCONCLUSIVE") {
    return "Evaluation reached the data limit. Insufficient evidence to confirm a condition. A licensed technician should perform a full inspection.";
  }
  if (!primaryCondition || primaryCondition === "Unknown") {
    return "Evidence collected did not converge on a specific condition category.";
  }
  const label =
    pack.reportTemplates.conditionLabels[primaryCondition] ?? primaryCondition;
  const score = conditionScores[primaryCondition] ?? 0;
  const total = Object.values(conditionScores).reduce((a, b) => a + b, 0);
  return `Evidence converged on ${label} (score: ${score}) based on ${total} total evidence weight across ${Object.keys(conditionScores).length} condition(s).`;
}

export function generateReports(
  run: Run,
  evidenceLog: Evidence[],
  conditionScores: Record<string, number>,
  pack: PackDefinition
): RunReports {
  const now = new Date().toISOString();
  const complaintLabel =
    pack.complaintCategories.find((c) => c.id === run.complaintId)?.label ??
    run.complaintId;

  const primaryLabel = run.primaryCondition
    ? (pack.reportTemplates.conditionLabels[run.primaryCondition] ?? run.primaryCondition)
    : "Undetermined";

  const secondaryLabel = run.secondaryCondition
    ? (pack.reportTemplates.conditionLabels[run.secondaryCondition] ?? run.secondaryCondition)
    : null;

  const nextStep = run.primaryCondition
    ? (pack.reportTemplates.nextStepsByCondition[run.primaryCondition] ??
      pack.reportTemplates.nextStepsByCondition["Unknown"])
    : pack.reportTemplates.nextStepsByCondition["Unknown"];

  const maintenanceTip = run.primaryCondition
    ? (pack.reportTemplates.maintenanceTipsByCondition[run.primaryCondition] ??
      pack.reportTemplates.maintenanceTipsByCondition["Unknown"])
    : pack.reportTemplates.maintenanceTipsByCondition["Unknown"];

  const technical: TechnicalReport = {
    title: pack.reportTemplates.technicalTitle,
    runId: run.id,
    packId: pack.id,
    packVersion: pack.version,
    complaint: complaintLabel,
    role: formatRole(run.role),
    capability: formatCapability(run.capability),
    evidenceState: run.evidenceState,
    primaryCondition: primaryLabel,
    secondaryCondition: secondaryLabel,
    conditionScores,
    evidenceLog,
    determinationSummary: buildDeterminationSummary(
      run.evidenceState,
      run.primaryCondition,
      conditionScores,
      pack
    ),
    disclaimer:
      "This report reflects field observations collected during a structured diagnostic session. " +
      "It does not constitute a repair authorization, warranty evaluation, or equipment condemnation. " +
      "A licensed HVAC technician must verify all findings before any service action is performed.",
    generatedAt: now,
  };

  const evidenceCount = evidenceLog.length;
  const userFacing: UserFacingReport = {
    title: pack.reportTemplates.userTitle,
    observation: `System evaluated for: ${complaintLabel}.`,
    evidenceSummary: `${evidenceCount} data point${evidenceCount !== 1 ? "s" : ""} collected during evaluation.`,
    primaryFinding: `Primary indication: ${primaryLabel}.`,
    secondaryFinding: secondaryLabel
      ? `Contributing factor noted: ${secondaryLabel}.`
      : null,
    evidenceStrength: run.evidenceState,
    nextStep,
    maintenanceTip,
    generatedAt: now,
  };

  return { technical, userFacing };
}