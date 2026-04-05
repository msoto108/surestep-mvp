// ============================================================
// SureStep Runtime — Report Generator
// ============================================================

import type {
  Run,
  Evidence,
  PackDefinition,
  RunContext,
  TechnicalReport,
  SPICEDReport,
  ServiceSummary,
  UserFacingReport,
  RunReports,
  EvidenceState,
  DiagnosticGates,
  GateStatus,
  CitedProof,
  JobInfo,
} from "./types";

const TAG_LABELS: Record<string, string> = {
  "thermostat.response": "Thermostat response",
  "thermostat.display": "Thermostat display",
  "airflow.at_filter": "Airflow at return grille",
  "airflow.filter_condition": "Filter condition",
  "indoor.condensate": "Drain pan / condensate",
  "indoor.low_voltage": "Low voltage at board",
  "indoor.high_voltage": "High voltage incoming",
  "indoor.transformer": "Transformer status",
  "indoor.board.fuse": "Control fuse",
  "indoor.thermostat_bypass": "Thermostat bypass test",
  "indoor.blower_relay": "Blower relay",
  "indoor.blower_capacitor": "Blower capacitor",
  "indoor.blower.motor.conclusion": "Blower motor diagnosis",
  "indoor.control_board.conclusion": "Control board diagnosis",
  "indoor.thermostat.conclusion": "Thermostat diagnosis",
  "outdoor.fan.running": "Condenser fan running",
  "outdoor.compressor.sound": "Compressor sound",
  "outdoor.contactor.pulled": "Contactor pulled in",
  "outdoor.contactor.low_voltage": "24V at contactor coil",
  "outdoor.contactor.conclusion": "Contactor diagnosis",
  "outdoor.controls.conclusion": "Controls diagnosis",
  "outdoor.contactor.hv_line_in": "High voltage — line side",
  "outdoor.contactor.hv_load_out": "High voltage — load side",
  "outdoor.safety_switches": "Safety switches",
  "outdoor.capacitor.visual": "Capacitor visual",
  "outdoor.capacitor.reading": "Capacitor reading",
  "outdoor.fan.motor": "Condenser fan motor",
  "outdoor.fan.motor.conclusion": "Fan motor diagnosis",
  "outdoor.compressor.start_assist": "Compressor start assist",
  "outdoor.compressor.windings": "Compressor windings",
  "refrigerant.suction_psi": "Suction pressure",
  "refrigerant.liquid_psi": "Liquid pressure",
  "refrigerant.pressure_pattern": "Pressure reading",
  "refrigerant.superheat_subcooling": "Superheat / subcooling",
  "airflow.supply_temp_f": "Supply air temp",
  "airflow.return_temp_f": "Return air temp",
  "operation.cycle_duration": "Cycle run time",
  "control.fault_code": "Fault code",
  "refrigerant.suction_at_shutdown": "Suction at shutdown",
  "electrical.breaker.location": "Breaker location",
  "electrical.breaker.trip_timing": "Breaker trip timing",
  "electrical.breaker.sizing": "Breaker sizing",
  "electrical.compressor.amps": "Compressor amps",
  "drainage.float_switch.tripped": "Float switch",
  "drainage.secondary_pan.water_level": "Secondary pan water",
  "drainage.primary_drain.flow": "Primary drain flow",
  "indoor.coil.iced": "Evaporator coil iced",
};

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

function buildGates(
  evidenceLog: Evidence[],
  conditionScores: Record<string, number>,
  evidenceState: EvidenceState
): DiagnosticGates {
  const tags = evidenceLog.map((e) => e.tag);
  const has = (prefix: string) => tags.some((t) => t.startsWith(prefix));

  const hasPower =
    has("outdoor.contactor") ||
    has("outdoor.capacitor") ||
    has("indoor.power") ||
    has("electrical.breaker") ||
    has("electrical.compressor");
  const hasControls =
    has("thermostat") || has("indoor.board") || has("control");
  const hasMech =
    has("outdoor.compressor") || has("outdoor.fan");
  const hasThermal =
    has("refrigerant") || has("airflow");

  const gateStatus = (present: boolean, score: number): GateStatus => {
    if (!present) return "SKIPPED";
    return score >= 4 ? "FAILED" : "PASSED";
  };

  const electricalScore = conditionScores["Electrical"] ?? 0;
  const controlsScore = conditionScores["Control System"] ?? 0;
  const mechanicalScore = conditionScores["Mechanical"] ?? 0;
  const thermalScore = Math.max(
    conditionScores["Refrigerant System"] ?? 0,
    conditionScores["Airflow"] ?? 0
  );

  const g5: GateStatus =
    evidenceState === "CONFIRMED" || evidenceState === "EVIDENCE_SUPPORTED"
      ? "PASSED"
      : evidenceState === "INCONCLUSIVE"
      ? "FAILED"
      : "UNKNOWN";

  return {
    G1_power: gateStatus(hasPower, electricalScore),
    G2_controls: gateStatus(hasControls, controlsScore),
    G3_mechanical: gateStatus(hasMech, mechanicalScore),
    G4_thermal: gateStatus(hasThermal, thermalScore),
    G5_verify: g5,
  };
}

function buildCitedProof(
  evidenceLog: Evidence[],
  pack: PackDefinition,
  ctx: RunContext
): CitedProof[] {
  const cited: CitedProof[] = [];
  for (const ev of evidenceLog) {
    for (const fn of pack.conditionMapFns) {
      const result = fn(ev.tag, ev.value, ctx);
      if (result) {
        cited.push({
          finding: `${ev.tag}: ${ev.value}`,
          condition: result.condition,
          sourceType: ev.sourceType,
          weight: result.weight,
        });
        break;
      }
    }
  }
  return cited;
}

// ─── Failed Component ────────────────────────────────────────

function componentFromEvidence(tag: string, value: string): string | null {
  if (tag === "outdoor.capacitor.reading" && (value === "Below spec" || value === "Open — no reading"))
    return "run capacitor";
  if (tag === "outdoor.capacitor.visual" && value.startsWith("Obvious failure"))
    return "run capacitor";
  if (tag === "outdoor.contactor.conclusion" && value === "Confirmed bad contactor")
    return "contactor";
  if (tag === "outdoor.controls.conclusion" && value === "Confirmed — no signal from controls")
    return "thermostat or control board";
  if (tag === "indoor.transformer" && value === "Confirmed — bad transformer")
    return "transformer";
  if (tag === "indoor.board.fuse" && value === "Fuse blown")
    return "control fuse";
  if (tag === "indoor.thermostat.conclusion" && value === "Confirmed bad thermostat")
    return "thermostat";
  if (tag === "indoor.blower.motor.conclusion" && value === "Confirmed bad blower motor")
    return "blower motor";
  if (tag === "indoor.control_board.conclusion" && value === "Confirmed bad control board")
    return "control board";
  if (tag === "outdoor.fan.motor.conclusion" && value === "Confirmed bad fan motor")
    return "condenser fan motor";
  if (tag === "outdoor.compressor.windings")
    return "compressor";
  if (tag === "refrigerant.pressure_pattern" && value === "Both low or near zero — refrigerant leak")
    return "refrigerant leak";
  if (tag === "refrigerant.pressure_pattern" && value.startsWith("Low suction"))
    return "refrigerant restriction or metering device";
  if (tag === "refrigerant.pressure_pattern" && value.startsWith("High head"))
    return "condenser coil restriction or overcharge";
  return null;
}

export function getFailedComponent(
  evidenceLog: Evidence[],
  pack: PackDefinition,
  ctx: RunContext
): string | null {
  let bestEv: Evidence | null = null;
  let bestWeight = 0;

  for (const ev of evidenceLog) {
    for (const fn of pack.conditionMapFns) {
      const result = fn(ev.tag, ev.value, ctx);
      if (result && result.weight > bestWeight) {
        const component = componentFromEvidence(ev.tag, ev.value);
        if (component) {
          bestWeight = result.weight;
          bestEv = ev;
        }
      }
    }
  }

  return bestEv ? componentFromEvidence(bestEv.tag, bestEv.value) : null;
}

// ─── Specific Next Step ──────────────────────────────────────

export function getSpecificNextStep(component: string | null, fallback: string): string {
  if (!component) return fallback;
  const map: Record<string, string> = {
    "transformer": "Replace the transformer.",
    "run capacitor": "Replace the run capacitor.",
    "contactor": "Replace the contactor.",
    "blower motor": "Replace the blower motor.",
    "condenser fan motor": "Replace the condenser fan motor.",
    "control fuse": "Replace the control fuse and identify the root cause.",
    "thermostat": "Replace the thermostat.",
    "control board": "Replace the control board.",
    "compressor": "Further compressor diagnostics required — replacement likely needed.",
    "refrigerant leak": "Perform leak search, repair leak, and recharge to manufacturer specifications.",
    "refrigerant restriction or metering device": "Inspect metering device and refrigerant circuit for restriction.",
    "condenser coil restriction or overcharge": "Clean condenser coil and verify refrigerant charge.",
  };
  return map[component] ?? fallback;
}

// ─── Customer Story ──────────────────────────────────────────

function buildCustomerStory(
  run: Run,
  pack: PackDefinition,
  jobInfo: JobInfo | null,
  primaryLabel: string,
  nextStep: string,
  failedComponent: string | null
): string {
  const address = jobInfo?.jobSiteAddress ?? "the job site";
  const complaintLabel =
    pack.complaintCategories.find((c) => c.id === run.complaintId)?.label ?? run.complaintId;

  const conditionPlain: Record<string, string> = {
    "Electrical": "a problem with the electrical system — likely a failed capacitor or wiring issue",
    "Refrigerant System": "a refrigerant issue — the system is low on charge or has a leak",
    "Mechanical": "a mechanical failure — the compressor or a motor is not operating correctly",
    "Airflow": "an airflow restriction — a clogged filter or blocked duct is limiting air movement",
    "Control System": "a controls issue — the thermostat or control board is not sending the right signals",
    "Drainage": "a drainage problem — the condensate drain is blocked or the float switch has tripped",
    "Unknown": "an issue that requires further investigation to confirm",
  };

  const conditionMeaning: Record<string, string> = {
    "Electrical": "This is causing the system to work harder than it should or preventing it from starting.",
    "Refrigerant System": "The system cannot transfer heat effectively, which is why it isn't cooling.",
    "Mechanical": "The system cannot run properly until the failed component is replaced.",
    "Airflow": "Restricted airflow reduces cooling capacity and can cause the system to freeze up.",
    "Control System": "The equipment itself may be fine, but it isn't receiving the signal to operate.",
    "Drainage": "The system has shut itself off as a safety measure to prevent water damage.",
    "Unknown": "More testing is needed before a confident recommendation can be made.",
  };

  const condition = run.primaryCondition ?? "Unknown";
  const meaning = conditionMeaning[condition] ?? "Further diagnosis is recommended.";
  const specificNext = getSpecificNextStep(failedComponent, nextStep);
  const firstSentence = specificNext.split(/(?<=\.)\s/)[0];

  let foundSentence: string;
  if (failedComponent) {
    const isLeakOrRestriction = failedComponent.startsWith("refrigerant") || failedComponent.startsWith("condenser coil");
    foundSentence = isLeakOrRestriction
      ? `During inspection, we found evidence of a ${failedComponent}.`
      : `During inspection, we found a failed ${failedComponent}.`;
  } else {
    foundSentence = `During inspection, we found ${conditionPlain[condition] ?? "an issue that needs further evaluation"}.`;
  }

  return [
    `When we arrived at ${address}, the system was ${complaintLabel.toLowerCase()}.`,
    foundSentence,
    meaning,
    firstSentence,
  ].join(" ");
}

// ─── Tech Story ──────────────────────────────────────────────

function buildTechStory(
  run: Run,
  evidenceLog: Evidence[],
  pack: PackDefinition,
  jobInfo: JobInfo | null,
  primaryLabel: string,
  secondaryLabel: string | null,
  nextStep: string,
  failedComponent: string | null
): string {
  const address = jobInfo?.jobSiteAddress ?? "the job site";
  const complaintLabel =
    pack.complaintCategories.find((c) => c.id === run.complaintId)?.label ?? run.complaintId;

  const measuredItems = evidenceLog
    .filter((e) => e.sourceType === "TOOL_PROOF" && e.value.trim())
    .map((e) => `${TAG_LABELS[e.tag] ?? e.tag}: ${e.value}${e.unit ? ` ${e.unit}` : ""}`)
    .join(", ");

  const observedItems = evidenceLog
    .filter((e) => (e.sourceType === "OBSERVED" || e.sourceType === "REPORTED") && e.value.trim())
    .slice(0, 4)
    .map((e) => `${TAG_LABELS[e.tag] ?? e.tag}: ${e.value}`)
    .join("; ");

  const sentences: string[] = [];
  sentences.push(`Responded to a ${complaintLabel.toLowerCase()} complaint at ${address}.`);

  if (observedItems) {
    sentences.push(`Field observations: ${observedItems}.`);
  }

  if (measuredItems) {
    sentences.push(`Measured values: ${measuredItems}.`);
  }

  const componentClause = failedComponent ? `; identified component: ${failedComponent}` : "";
  const conditionSentence = secondaryLabel
    ? `Evidence points to ${primaryLabel} as the primary condition, with ${secondaryLabel} as a contributing factor${componentClause}.`
    : `Evidence points to ${primaryLabel} as the primary condition${componentClause}.`;
  sentences.push(conditionSentence);

  sentences.push(getSpecificNextStep(failedComponent, nextStep));

  return sentences.join(" ");
}

// ─── Audit Record ────────────────────────────────────────────

function buildAuditRecord(
  run: Run,
  evidenceLog: Evidence[],
  pack: PackDefinition,
  jobInfo: JobInfo | null,
  primaryLabel: string,
  determinationSummary: string,
  nextStep: string,
  disclaimer: string,
  failedComponent: string | null
): string {
  const complaintLabels = run.complaintIds
    .map((id) => pack.complaintCategories.find((c) => c.id === id)?.label ?? id)
    .join(", ");

  const equipment = [jobInfo?.equipmentMake, jobInfo?.equipmentModel, jobInfo?.serialNumber]
    .filter(Boolean)
    .join(" ") || "—";

  const evidenceLines = evidenceLog
    .map((e) => `${TAG_LABELS[e.tag] ?? e.tag}: ${e.value}${e.unit ? ` ${e.unit}` : ""} [${e.sourceType}]`)
    .join("\n");

  return [
    `RUN ID: ${run.id}`,
    `DATE: ${new Date(run.startedAt).toLocaleString()}`,
    `TECHNICIAN: ${jobInfo?.technicianName ?? "—"} — ${jobInfo?.companyName ?? "—"}`,
    `ADDRESS: ${jobInfo?.jobSiteAddress ?? "—"}`,
    `EQUIPMENT: ${equipment}`,
    `COMPLAINT: ${complaintLabels}`,
    `---`,
    `EVIDENCE:`,
    evidenceLines || "(none)",
    `---`,
    `PRIMARY CONDITION: ${primaryLabel}`,
    `FAILED COMPONENT: ${failedComponent ?? "—"}`,
    `EVIDENCE STRENGTH: ${run.evidenceState}`,
    `DETERMINATION: ${determinationSummary}`,
    `---`,
    `NEXT STEP: ${getSpecificNextStep(failedComponent, nextStep)}`,
    `---`,
    `DISCLAIMER: ${disclaimer}`,
  ].join("\n");
}

export function generateReports(
  run: Run,
  evidenceLog: Evidence[],
  conditionScores: Record<string, number>,
  pack: PackDefinition,
  rootCause: string | null = null,
  downstreamEffects: string[] = []
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

  const disclaimer =
    "This report reflects field observations collected during a structured diagnostic session. " +
    "It does not constitute a repair authorization, warranty evaluation, or equipment condemnation. " +
    "A licensed HVAC technician must verify all findings before any service action is performed.";

  const ctx: RunContext = {
    evidence: Object.fromEntries(evidenceLog.map((e) => [e.tag, e.value])),
    role: run.role,
    capability: run.capability,
    complaintId: run.complaintId,
  };

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
    gates: buildGates(evidenceLog, conditionScores, run.evidenceState),
    citedProof: buildCitedProof(evidenceLog, pack, ctx),
    determinationSummary: buildDeterminationSummary(
      run.evidenceState,
      run.primaryCondition,
      conditionScores,
      pack
    ),
    disclaimer,
    generatedAt: now,
  };

  const observationText = rootCause
    ? `Root cause identified: ${pack.reportTemplates.conditionLabels[rootCause] ?? rootCause}.${downstreamEffects.length > 0 ? " Downstream effects: " + downstreamEffects.join(", ") + "." : ""}`
    : `System evaluated for: ${complaintLabel}.`;

  const toolProofCount = evidenceLog.filter((e) => e.sourceType === "TOOL_PROOF").length;

  const spiced: SPICEDReport = {
    situation: `${formatRole(run.role)} evaluated a ${complaintLabel} complaint. Capability: ${formatCapability(run.capability)}.`,
    parameters: `${evidenceLog.length} data point${evidenceLog.length !== 1 ? "s" : ""} collected. Primary: ${primaryLabel}${secondaryLabel ? `. Secondary: ${secondaryLabel}` : ""}.`,
    indications: buildDeterminationSummary(run.evidenceState, run.primaryCondition, conditionScores, pack),
    condition: primaryLabel,
    secondary: secondaryLabel,
    evaluation: formatEvidenceState(run.evidenceState),
    observation: observationText,
    proof: toolProofCount > 0
      ? `${toolProofCount} tool-verified measurement${toolProofCount !== 1 ? "s" : ""} on record.`
      : "No tool-verified measurements collected.",
    nextStep,
    maintenanceTip,
    evidenceStrength: run.evidenceState,
    disclaimer,
  };

  const serviceSummary: ServiceSummary = {
    dispatchRequired:
      (run.evidenceState === "CONFIRMED" || run.evidenceState === "EVIDENCE_SUPPORTED") &&
      primaryLabel !== "Undetermined",
    problem: rootCause
      ? `${complaintLabel} — root cause: ${pack.reportTemplates.conditionLabels[rootCause] ?? rootCause}.`
      : `${complaintLabel}. Suspected issue: ${primaryLabel}.`,
    evidence: `${evidenceLog.length} observation${evidenceLog.length !== 1 ? "s" : ""} collected. Strength of evidence: ${formatEvidenceState(run.evidenceState)}.`,
    resolution: nextStep,
    prevention: maintenanceTip,
  };

  const evidenceCount = evidenceLog.length;
  const userFacing: UserFacingReport = {
    title: pack.reportTemplates.userTitle,
    observation: observationText,
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

  const jobInfo = run.jobInfo ?? null;
  const failedComponent = getFailedComponent(evidenceLog, pack, ctx);

  const customerStory = buildCustomerStory(run, pack, jobInfo, primaryLabel, nextStep, failedComponent);
  const techStory = buildTechStory(run, evidenceLog, pack, jobInfo, primaryLabel, secondaryLabel, nextStep, failedComponent);
  const auditRecord = buildAuditRecord(
    run, evidenceLog, pack, jobInfo,
    primaryLabel,
    technical.determinationSummary,
    nextStep,
    disclaimer,
    failedComponent
  );

  return { technical, spiced, serviceSummary, userFacing, customerStory, techStory, auditRecord };
}
