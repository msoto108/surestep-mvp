// ============================================================
// SureStep Runtime — Engine
// Pure functions. No UI. No side effects.
// ============================================================

import type {
  PackStep,
  PackDefinition,
  RunContext,
  Evidence,
  EvidenceState,
  DeterminationLock,
  RunPhase,
} from "./types";

export function getEligibleSteps(
  steps: PackStep[],
  ctx: RunContext
): PackStep[] {
  return steps.filter((step) => {
    if (step.requiresTool && ctx.capability !== "TOOL_PROOF_AVAILABLE") {
      return false;
    }
    if (step.skip && step.skip(ctx)) {
      return false;
    }
    if (step.prereq && !step.prereq(ctx)) {
      return false;
    }
    return true;
  });
}

export function getNextRequiredStep(
  steps: PackStep[],
  ctx: RunContext
): PackStep | null {
  const eligible = getEligibleSteps(steps, ctx);
  for (const step of eligible) {
    if (ctx.evidence[step.capture.tag] === undefined) {
      return step;
    }
  }
  return null;
}

export function computeSkippedTags(
  steps: PackStep[],
  ctx: RunContext
): string[] {
  return steps
    .filter((step) => {
      if (step.requiresTool && ctx.capability !== "TOOL_PROOF_AVAILABLE") return true;
      if (step.skip && step.skip(ctx)) return true;
      if (step.prereq && !step.prereq(ctx)) return true;
      return false;
    })
    .map((step) => step.capture.tag);
}

export function computeConditionScores(
  pack: PackDefinition,
  evidenceLog: Evidence[],
  ctx: RunContext
): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const ev of evidenceLog) {
    for (const mapFn of pack.conditionMapFns) {
      const result = mapFn(ev.tag, ev.value, ctx);
      if (result) {
        scores[result.condition] = (scores[result.condition] ?? 0) + result.weight;
      }
    }
  }
  return scores;
}

export function getPrimaryCondition(
  scores: Record<string, number>,
  tieBreakPriority: string[]
): string | null {
  let topCondition: string | null = null;
  let topScore = 0;
  for (const condition of tieBreakPriority) {
    const score = scores[condition] ?? 0;
    if (score > topScore) {
      topScore = score;
      topCondition = condition;
    }
  }
  for (const [condition, score] of Object.entries(scores)) {
    if (score > topScore) {
      topScore = score;
      topCondition = condition;
    }
  }
  return topCondition;
}

export function getSecondaryCondition(
  scores: Record<string, number>,
  primary: string | null,
  tieBreakPriority: string[]
): string | null {
  let secondCondition: string | null = null;
  let secondScore = 0;
  for (const condition of tieBreakPriority) {
    if (condition === primary) continue;
    const score = scores[condition] ?? 0;
    if (score > secondScore) {
      secondScore = score;
      secondCondition = condition;
    }
  }
  for (const [condition, score] of Object.entries(scores)) {
    if (condition === primary) continue;
    if (score > secondScore) {
      secondScore = score;
      secondCondition = condition;
    }
  }
  return secondCondition;
}

export function computeEvidenceState(
  scores: Record<string, number>,
  primary: string | null,
  thresholds: PackDefinition["promotionThresholds"]
): EvidenceState {
  const total = Object.values(scores).reduce((sum, v) => sum + v, 0);
  if (total === 0) return "NONE";
  if (primary === "Unknown" || primary === null) {
    if (total >= thresholds.evidenceSupported) return "EVIDENCE_SUPPORTED";
    if (total >= thresholds.plausible) return "PLAUSIBLE";
    return "NONE";
  }
  if (total >= thresholds.confirmed) return "CONFIRMED";
  if (total >= thresholds.evidenceSupported) return "EVIDENCE_SUPPORTED";
  if (total >= thresholds.plausible) return "PLAUSIBLE";
  return "NONE";
}

export function computeDeterminationLock(
  pack: PackDefinition,
  complaintId: string,
  evidenceLog: Evidence[],
  ctx: RunContext
): DeterminationLock {
  const requiredTags = pack.minimumEvidencePaths[complaintId] ?? [];
  const skippedTags = new Set(
    computeSkippedTags(pack.steps[complaintId] ?? [], ctx)
  );
  const capturedTags = new Set(evidenceLog.map((e) => e.tag));
  const missing = requiredTags.filter(
    (tag) => !capturedTags.has(tag) && !skippedTags.has(tag)
  );
  return missing.length === 0 ? "UNLOCKED" : "LOCKED";
}

export function getMissingEvidenceDescription(
  pack: PackDefinition,
  complaintId: string,
  evidenceLog: Evidence[],
  ctx: RunContext
): string[] {
  const requiredTags = pack.minimumEvidencePaths[complaintId] ?? [];
  const skippedTags = new Set(
    computeSkippedTags(pack.steps[complaintId] ?? [], ctx)
  );
  const capturedTags = new Set(evidenceLog.map((e) => e.tag));
  const steps = pack.steps[complaintId] ?? [];
  return requiredTags
    .filter((tag) => !capturedTags.has(tag) && !skippedTags.has(tag))
    .map((tag) => {
      const step = steps.find((s) => s.capture.tag === tag);
      return step ? step.title : tag;
    });
}

export function computePhase(
  determinationLock: DeterminationLock,
  nextStep: PackStep | null,
  capability: string,
  pack: PackDefinition,
  complaintId: string,
  evidenceLog: Evidence[],
  ctx: RunContext
): RunPhase {
  if (determinationLock === "UNLOCKED" && nextStep === null) {
    return "READY_TO_REPORT";
  }
  if (nextStep === null && capability === "NO_TOOL_PROOF") {
    const allSteps = pack.steps[complaintId] ?? [];
    const toolGated = allSteps.filter(
      (s) =>
        s.requiresTool &&
        ctx.evidence[s.capture.tag] === undefined &&
        !(s.skip && s.skip(ctx)) &&
        !(s.prereq && !s.prereq(ctx))
    );
    if (toolGated.length > 0) return "DATA_NEEDED";
  }
  return "IN_PROGRESS";
}