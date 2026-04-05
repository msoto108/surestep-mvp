// ============================================================
// SureStep Runtime — Core Types
// ============================================================

export type RunPhase = "IN_PROGRESS" | "DATA_NEEDED" | "READY_TO_REPORT";

export type UserRole = "TECHNICIAN" | "OPERATOR" | "OBSERVER";

export type Capability = "TOOL_PROOF_AVAILABLE" | "NO_TOOL_PROOF";

export type EvidenceState =
  | "NONE"
  | "PLAUSIBLE"
  | "EVIDENCE_SUPPORTED"
  | "CONFIRMED"
  | "INCONCLUSIVE";

export type SafetyState = "NORMAL" | "TIER_0" | "TIER_0_5";

export type DeterminationLock = "LOCKED" | "UNLOCKED";

export interface Run {
  id: string;
  packId: string;
  complaintId: string;
  complaintIds: string[];  
  phase: RunPhase;
  role: UserRole;
  capability: Capability;
  evidenceState: EvidenceState;
  primaryCondition: string | null;
  secondaryCondition: string | null;
  currentStepId: string | null;
  determinationLock: DeterminationLock;
  safetyState: SafetyState;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null; jobInfo: JobInfo | null;
}

export type EvidenceSourceType =
  | "REPORTED"
  | "OBSERVED"
  | "TOOL_PROOF"
  | "VERIFIED_REF";

export interface Evidence {
  tag: string;
  value: string;
  unit?: string;
  sourceType: EvidenceSourceType;
  timestamp: string;
}

export type InputType =
  | "YES_NO"
  | "YES_NO_UNABLE"
  | "SELECT"
  | "NUMBER"
  | "TEXT";

export interface StepCapture {
  tag: string;
  type: InputType;
  unit?: string;
  options?: string[];
  placeholder?: string;
  required: boolean;
  sourceType: EvidenceSourceType;
}

export interface PackStep {
  id: string;
  title: string;
  prompt: string;
  hint?: string;
  capture: StepCapture;
  requiresTool: boolean;
  prereq?: (ctx: RunContext) => boolean;
  skip?: (ctx: RunContext) => boolean;
}

export interface RunContext {
  evidence: Record<string, string>;
  role: UserRole;
  capability: Capability;
  complaintId: string;
}

export interface ConditionWeight {
  condition: string;
  weight: number;
}

export type ConditionMapFn = (
  tag: string,
  value: string,
  ctx: RunContext
) => ConditionWeight | null;

export interface ComplaintCategory {
  id: string;
  label: string;
  description?: string;
}

export interface PromotionThresholds {
  plausible: number;
  evidenceSupported: number;
  confirmed: number;
}

export interface PackDefinition {
  id: string;
  name: string;
  version: string;
  complaintCategories: ComplaintCategory[];
  steps: Record<string, PackStep[]>;
  conditionTaxonomy: string[];
  conditionMapFns: ConditionMapFn[];
  promotionThresholds: PromotionThresholds;
  minimumEvidencePaths: Record<string, string[]>;
  tieBreakPriority: string[];
  downstreamEffects: Record<string, string[]>;
  reportTemplates: PackReportTemplates;
}

export interface PackReportTemplates {
  technicalTitle: string;
  userTitle: string;
  conditionLabels: Record<string, string>;
  nextStepsByCondition: Record<string, string>;
  maintenanceTipsByCondition: Record<string, string>;
}

export type GateStatus = "PASSED" | "FAILED" | "SKIPPED" | "UNKNOWN";

export interface DiagnosticGates {
  G1_power: GateStatus;
  G2_controls: GateStatus;
  G3_mechanical: GateStatus;
  G4_thermal: GateStatus;
  G5_verify: GateStatus;
}

export interface CitedProof {
  finding: string;
  condition: string;
  sourceType: string;
  weight: number;
}

export interface TechnicalReport {
  title: string;
  runId: string;
  packId: string;
  packVersion: string;
  complaint: string;
  role: string;
  capability: string;
  evidenceState: EvidenceState;
  primaryCondition: string;
  secondaryCondition: string | null;
  conditionScores: Record<string, number>;
  evidenceLog: Evidence[];
  gates: DiagnosticGates;
  citedProof: CitedProof[];
  determinationSummary: string;
  disclaimer: string;
  generatedAt: string;
}

export interface SPICEDReport {
  situation: string;
  parameters: string;
  indications: string;
  condition: string;
  secondary: string | null;
  evaluation: string;
  observation: string;
  proof: string;
  nextStep: string;
  maintenanceTip: string;
  evidenceStrength: EvidenceState;
  disclaimer: string;
}

export interface ServiceSummary {
  dispatchRequired: boolean;
  problem: string;
  evidence: string;
  resolution: string;
  prevention: string;
}

export interface UserFacingReport {
  title: string;
  observation: string;
  evidenceSummary: string;
  primaryFinding: string;
  secondaryFinding: string | null;
  evidenceStrength: EvidenceState;
  nextStep: string;
  maintenanceTip: string;
  generatedAt: string;
}

export interface RunReports {
  technical: TechnicalReport;
  spiced: SPICEDReport;
  serviceSummary: ServiceSummary;
  userFacing: UserFacingReport;
  customerStory: string;
  techStory: string;
  auditRecord: string;
}

export interface SafetyCheckResult {
  level: SafetyState;
  trigger?: string;
}

export interface PersistedSession {
  run: Run;
  evidenceLog: Evidence[];
  reports: RunReports | null;
}

export interface JobInfo {
  technicianName: string;
  companyName: string;
  jobSiteAddress: string;
  equipmentType: string;
  equipmentMake: string;
  equipmentModel: string;
  serialNumber: string;
}