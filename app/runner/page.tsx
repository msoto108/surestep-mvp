"use client";

import { useState, useMemo, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { HVAC_COOLING_PACK } from "../packs/hvac/cooling/pack";
import {
  getNextRequiredStep,
  computeConditionScores,
  getPrimaryCondition,
  getSecondaryCondition,
  computeEvidenceState,
  computeDeterminationLock,
  computePhase,
  getNextRequiredStepMulti,
  computeDeterminationLockMulti,
  computeRootCauseAndEffects,
} from "./engine";
import { generateReports } from "./reports";
import { generatePDF, sendOfficeEmail, buildCustomerSummaryText } from "./pdf";
import type {
  Run,
  Evidence,
  UserRole,
  Capability,
  PackStep,
  RunContext,
  RunReports,
  JobInfo,
} from "./types";

type GateStatus = "PASSED" | "FAILED" | "SKIPPED" | "UNKNOWN";

// ─── Helpers ────────────────────────────────────────────────

function generateId(): string {
  return "SS-" + Date.now().toString(36).toUpperCase();
}

function saveSession(run: Run, log: Evidence[], reports: RunReports | null) {
  try {
    localStorage.setItem(
      "surestep:session",
      JSON.stringify({ run, evidenceLog: log, reports })
    );
  } catch {}
}

function loadSession() {
  try {
    const raw = localStorage.getItem("surestep:session");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.run?.packId) return null;
    return parsed;
  } catch {
    localStorage.removeItem("surestep:session");
    return null;
  }
}

// ─── Safety ─────────────────────────────────────────────────

const TIER0 = [
  "fire", "smoke", "arcing", "gas odor", "gas smell",
  "co alarm", "carbon monoxide", "burning smell", "flooding", "sparks",
];
const TIER05 = [
  "possible gas", "faint smell", "unusual odor", "might be smoke",
];

function checkSafety(text: string): "NORMAL" | "TIER_0" | "TIER_0_5" {
  const lower = text.toLowerCase();
  if (TIER0.some((t) => lower.includes(t))) return "TIER_0";
  if (TIER05.some((t) => lower.includes(t))) return "TIER_0_5";
  return "NORMAL";
}

// ─── Layout Components ───────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-zinc-700 bg-zinc-800 px-5 py-6 ${className}`}>
      {children}
    </div>
  );
}

function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-600">
      <div>
        <p className="text-xs font-mono tracking-widest uppercase text-zinc-300">SureStep</p>
        <p className="text-sm font-mono text-zinc-200">HVAC Cooling Pack v2.0</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function Pill({ label, color = "text-zinc-200 border-zinc-500" }: { label: string; color?: string }) {
  return (
    <span className={`text-xs font-mono tracking-widest uppercase border px-2 py-0.5 ${color}`}>
      {label}
    </span>
  );
}

function PrimaryBtn({
  children,
  onClick,
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-4 bg-white text-zinc-900 font-mono text-sm tracking-widest uppercase disabled:opacity-30 active:bg-zinc-100 transition-colors font-bold"
    >
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-3 border border-zinc-600 text-zinc-200 font-mono text-xs tracking-widest uppercase active:border-zinc-400 transition-colors"
    >
      {children}
    </button>
  );
}

function ChoiceInput({ options, onSelect }: { options: string[]; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onSelect(o)}
          className="w-full text-left px-4 py-4 border border-zinc-600 text-white font-mono text-sm active:bg-zinc-700 active:border-zinc-400 transition-colors"
        >
          {o}
        </button>
      ))}
    </div>
  );
}

function NumberInput({
  unit,
  placeholder,
  onSubmit,
}: {
  unit?: string;
  placeholder?: string;
  onSubmit: (v: string) => void;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        <input
          type="number"
          inputMode="decimal"
          placeholder={placeholder ?? "Enter value"}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && val.trim() && onSubmit(val.trim())}
          className="flex-1 px-4 py-4 bg-zinc-900 border border-zinc-600 border-r-0 text-white font-mono text-lg focus:outline-none focus:border-zinc-400 placeholder:text-zinc-500"
        />
        {unit && (
          <div className="px-3 flex items-center bg-zinc-700 border border-zinc-600 text-zinc-200 font-mono text-sm">
            {unit}
          </div>
        )}
      </div>
      <PrimaryBtn onClick={() => val.trim() && onSubmit(val.trim())} disabled={!val.trim()}>
        Record →
      </PrimaryBtn>
    </div>
  );
}

function HintDrawer({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen((h) => !h)}
        className="text-xs font-mono uppercase text-zinc-300 border-b border-dashed border-zinc-500"
      >
        {open ? "Hide detail" : "Why is this needed?"}
      </button>
      {open && (
        <p className="mt-2 text-sm font-mono text-zinc-200 leading-relaxed border-l-2 border-zinc-500 pl-3">
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Gate Badge ─────────────────────────────────────────────

function GateBadge({ label, status }: { label: string; status: GateStatus }) {
  const colors: Record<GateStatus, string> = {
    PASSED: "text-green-300 border-green-700 bg-green-950",
    FAILED: "text-red-300 border-red-700 bg-red-950",
    SKIPPED: "text-zinc-400 border-zinc-600",
    UNKNOWN: "text-zinc-500 border-zinc-700",
  };
  const icons: Record<GateStatus, string> = {
    PASSED: "✓",
    FAILED: "✗",
    SKIPPED: "–",
    UNKNOWN: "?",
  };
  return (
    <div className={`border px-3 py-2 flex flex-col items-center gap-0.5 ${colors[status]}`}>
      <span className="text-xs font-mono font-bold">{icons[status]}</span>
      <span className="text-xs font-mono uppercase tracking-wide">{label}</span>
    </div>
  );
}

// ─── Tag Labels ─────────────────────────────────────────────

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
  "repair.outcome": "Repair performed",
};

// ─── Report Field ────────────────────────────────────────────

function ReportField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-mono uppercase text-zinc-400 mb-1">{label}</p>
      <p className={`text-sm leading-relaxed text-white ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function ReportDivider() {
  return <div className="border-t border-zinc-700" />;
}

// ─── Pack + Screen Type ──────────────────────────────────────

const pack = HVAC_COOLING_PACK;

type Screen =
  | "INTRO"
  | "ROLE"
  | "COMPLAINT"
  | "JOB_INFO"
  | "DIAGNOSTIC"
  | "READY"
  | "DATA_NEEDED"
  | "REPORT"
  | "EMERGENCY"
  | "SAFETY_CLARIFY"
  | "EXPRESS";


// ─── Main Component ──────────────────────────────────────────

export default function RunnerPage() {
  const router = useRouter();
  const [screen, setScreen] = useState<Screen>("INTRO");
  const [run, setRun] = useState<Run | null>(null);
  const [evidenceLog, setEvidenceLog] = useState<Evidence[]>([]);
  const [reports, setReports] = useState<RunReports | null>(null);
  const [safetyTrigger, setSafetyTrigger] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<PackStep | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);

  const [selectedRole, setSelectedRole] = useState<UserRole | null>("TECHNICIAN");
  const [jobInfo, setJobInfo] = useState<JobInfo | null>(null);
  const [form, setForm] = useState({
    technicianName: "",
    companyName: "",
    jobSiteAddress: "",
    equipmentType: "",
    equipmentMake: "",
    equipmentModel: "",
    serialNumber: "",
  });
  const [complaintIds, setComplaintIds] = useState<string[]>([]);
  const [officeEmail, setOfficeEmail] = useState<string>("");
  const [copySuccess, setCopySuccess] = useState(false);
  const [reportTab, setReportTab] = useState<"customer" | "technician" | "office">("customer");
  const [reportBanner, setReportBanner] = useState<string | null>(null);

  // ─── Hydration ──────────────────────────────────────────

  useEffect(() => {
    try {
      const raw = localStorage.getItem("surestep:settings");
      if (raw) {
        const s = JSON.parse(raw);
        if (s.officeEmail) setOfficeEmail(s.officeEmail);
        setForm((f) => ({
          ...f,
          technicianName: f.technicianName || s.technicianName || "",
          companyName: f.companyName || s.companyName || "",
        }));
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      const saved = loadSession();
      if (saved?.run && !saved.run.completedAt) {
        setRun(saved.run);
        setEvidenceLog(saved.evidenceLog ?? []);
        setReports(saved.reports ?? null);
        if (saved.run.jobInfo) setJobInfo(saved.run.jobInfo);
        if (saved.run.complaintIds) setComplaintIds(saved.run.complaintIds);
        if (saved.reports) setScreen("REPORT");
        else if (saved.run.phase === "DATA_NEEDED") setScreen("DATA_NEEDED");
        else if (saved.run.phase === "READY_TO_REPORT") setScreen("READY");
        else setScreen("DIAGNOSTIC");
      }
    } catch {
      localStorage.removeItem("surestep:session");
    }
  }, []);

  // ─── Derived State ──────────────────────────────────────

  const ctx: RunContext | null = useMemo(() => {
    if (!run) return null;
    const evidence: Record<string, string> = {};
    for (const ev of evidenceLog) evidence[ev.tag] = ev.value;
    return {
      evidence,
      role: run.role,
      capability: run.capability,
      complaintId: run.complaintId,
    };
  }, [run, evidenceLog]);

  const conditionScores = useMemo(() => {
    if (!ctx) return {};
    return computeConditionScores(pack, evidenceLog, ctx);
  }, [evidenceLog, ctx]);

  const currentStep = useMemo(() => {
    if (!run || !ctx) return null;
    const ids = run.complaintIds?.length ? run.complaintIds : [run.complaintId];
    return getNextRequiredStepMulti(pack, ids, ctx);
  }, [run, ctx]);

  // ─── Run Refresh ────────────────────────────────────────

  function refreshRun(baseRun: Run, log: Evidence[]): Run {
    const evidence: Record<string, string> = {};
    for (const ev of log) evidence[ev.tag] = ev.value;
    const freshCtx: RunContext = {
      evidence,
      role: baseRun.role,
      capability: baseRun.capability,
      complaintId: baseRun.complaintId,
    };
    const scores = computeConditionScores(pack, log, freshCtx);
    const primary = getPrimaryCondition(scores, pack.tieBreakPriority);
    const secondary = getSecondaryCondition(scores, primary, pack.tieBreakPriority);
    const evidenceState = computeEvidenceState(scores, primary, pack.promotionThresholds);
    const ids = baseRun.complaintIds?.length ? baseRun.complaintIds : [baseRun.complaintId];
    const determinationLock = computeDeterminationLockMulti(pack, ids, log, freshCtx);
    const nextStep = getNextRequiredStepMulti(pack, ids, freshCtx);
    const phase = computePhase(
      determinationLock,
      nextStep,
      baseRun.capability,
      pack,
      baseRun.complaintId,
      log,
      freshCtx
    );
    return {
      ...baseRun,
      phase,
      evidenceState,
      primaryCondition: primary,
      secondaryCondition: secondary,
      currentStepId: nextStep?.id ?? null,
      determinationLock,
      updatedAt: new Date().toISOString(),
    };
  }

  // ─── Actions ────────────────────────────────────────────

  function startSession(role: UserRole, capability: Capability) {
    const newRun: Run = {
      id: generateId(),
      packId: pack.id,
      complaintId: "",
      complaintIds: [],
      phase: "IN_PROGRESS",
      role,
      capability,
      evidenceState: "NONE",
      primaryCondition: null,
      secondaryCondition: null,
      currentStepId: null,
      determinationLock: "LOCKED",
      safetyState: "NORMAL",
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      jobInfo: null,
    };
    setRun(newRun);
    setEvidenceLog([]);
    setReports(null);
    setComplaintIds([]);
    setScreen("JOB_INFO");
  }

  function selectComplaints(ids: string[]) {
    if (!run || ids.length === 0) return;
    const primaryId = ids[0];
    const updated = {
      ...run,
      complaintId: primaryId,
      complaintIds: ids,
      updatedAt: new Date().toISOString(),
    };
    setRun(updated);
    saveSession(updated, evidenceLog, null);
    setScreen("DIAGNOSTIC");
  }

  function commitEvidence(step: PackStep, value: string) {
    if (!run) return;
    const safety = checkSafety(value);
    if (safety === "TIER_0") {
      setSafetyTrigger(value);
      setScreen("EMERGENCY");
      return;
    }
    if (safety === "TIER_0_5") {
      setSafetyTrigger(value);
      setPendingStep(step);
      setPendingValue(value);
      setScreen("SAFETY_CLARIFY");
      return;
    }
    const ev: Evidence = {
      tag: step.capture.tag,
      value: value.trim(),
      unit: step.capture.unit,
      sourceType: step.capture.sourceType,
      timestamp: new Date().toISOString(),
    };
    const newLog = [...evidenceLog, ev];
    setEvidenceLog(newLog);
    const updated = refreshRun(run, newLog);
    setRun(updated);
    saveSession(updated, newLog, null);
    if (updated.phase === "READY_TO_REPORT") setScreen("READY");
    else if (updated.phase === "DATA_NEEDED") setScreen("DATA_NEEDED");
  }

  async function openReport(r: RunReports, jobInfoForEmail: JobInfo | null) {
    try { await navigator.clipboard.writeText(r.auditRecord); } catch {}
    if (officeEmail) { sendOfficeEmail(r, jobInfoForEmail, officeEmail); }
    setReportBanner(officeEmail ? "Audit record copied & sent to office" : "Audit record copied");
    setTimeout(() => setReportBanner(null), 3000);
    setScreen("REPORT");
  }

  function finalize(inconclusive = false) {
    if (!run) return;
    const finalRun = {
      ...run,
      evidenceState: inconclusive ? ("INCONCLUSIVE" as const) : run.evidenceState,
      completedAt: new Date().toISOString(),
    };
    const ids = finalRun.complaintIds?.length ? finalRun.complaintIds : [finalRun.complaintId];
    const { rootCause, downstreamEffects } = computeRootCauseAndEffects(
      pack,
      ids,
      finalRun.primaryCondition
    );
    const r = generateReports(
      finalRun,
      evidenceLog,
      conditionScores,
      pack,
      rootCause,
      downstreamEffects
    );
    setRun(finalRun);
    setReports(r);
    saveSession(finalRun, evidenceLog, r);
    openReport(r, finalRun.jobInfo ?? null);
  }

  function reset() {
    try {
      localStorage.removeItem("surestep:session");
    } catch {}
    setRun(null);
    setEvidenceLog([]);
    setReports(null);
    setSafetyTrigger(null);
    setPendingStep(null);
    setPendingValue(null);
    setSelectedRole("TECHNICIAN");
    setComplaintIds([]);
    setJobInfo(null);
    setForm({
      technicianName: "",
      companyName: "",
      jobSiteAddress: "",
      equipmentType: "",
      equipmentMake: "",
      equipmentModel: "",
      serialNumber: "",
    });
    setScreen("INTRO");
  }

  // ─── Screens ────────────────────────────────────────────

  if (screen === "EMERGENCY") {
    return (
      <Shell>
        <div className="border border-red-700 bg-zinc-900 px-5 py-6">
          <p className="text-xs font-mono tracking-widest uppercase text-red-400 mb-4">
            ⚠ Emergency Stop
          </p>
          <p className="text-sm font-mono text-red-300 leading-relaxed mb-6">
            A life-safety hazard has been detected. Stop all equipment operation immediately.
          </p>
          <ol className="flex flex-col gap-2 mb-6">
            {[
              "Evacuate the area immediately.",
              "Do not operate any electrical switches.",
              "If gas suspected — use no ignition sources.",
              "Call emergency services or your utility emergency line.",
              "Do not re-enter until cleared by professionals.",
            ].map((s, i) => (
              <li key={i} className="text-sm font-mono text-red-300">
                {i + 1}. {s}
              </li>
            ))}
          </ol>
          <GhostBtn onClick={reset}>Reset session</GhostBtn>
        </div>
      </Shell>
    );
  }

  if (screen === "SAFETY_CLARIFY") {
    return (
      <Shell>
        <div className="border border-yellow-600 bg-zinc-900 px-5 py-6">
          <p className="text-xs font-mono tracking-widest uppercase text-yellow-400 mb-4">
            ⚡ Safety Clarification Required
          </p>
          <p className="text-sm font-mono text-yellow-300 leading-relaxed mb-6">
            A potential safety concern was noted. Confirm before proceeding.
          </p>
          <p className="text-xs font-mono uppercase text-zinc-300 mb-3">
            Is there an active hazard present?
          </p>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setScreen("EMERGENCY")}
              className="w-full py-4 px-4 text-left border border-red-700 text-red-300 font-mono text-sm"
            >
              Yes — active hazard present
            </button>
            <button
              onClick={() => {
                setSafetyTrigger(null);
                if (pendingStep && pendingValue) {
                  const step = pendingStep;
                  const value = pendingValue;
                  setPendingStep(null);
                  setPendingValue(null);
                  setScreen("DIAGNOSTIC");
                  commitEvidence(step, value);
                } else {
                  setScreen("DIAGNOSTIC");
                }
              }}
              className="w-full py-4 px-4 text-left border border-zinc-600 text-white font-mono text-sm"
            >
              No — conditions are safe
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  if (screen === "INTRO") {
    return (
      <Shell>
        <Card>
          <div className="mb-10">
            <p className="text-xs font-mono tracking-widest uppercase text-zinc-300 mb-3">
              Domain-Agnostic Diagnostic Runner
            </p>
            <h1 className="text-4xl font-mono font-bold text-white mb-1">SureStep</h1>
            <p className="text-sm font-mono tracking-widest uppercase text-zinc-300">
              HVAC Cooling Pack v2.0
            </p>
          </div>
          <p className="text-base font-mono text-white leading-relaxed mb-8">
            Evidence-driven diagnostic engine.
            <br />
            One step at a time. Safety-first.
            <br />
            Defensible structured reports.
          </p>
          <PrimaryBtn onClick={() => startSession("TECHNICIAN", "TOOL_PROOF_AVAILABLE")}>
            Begin session →
          </PrimaryBtn>
          <div className="mt-2">
            <GhostBtn onClick={() => setScreen("EXPRESS")}>
              Express entry →
            </GhostBtn>
          </div>
          <div className="mt-2">
            <GhostBtn onClick={() => router.push("/runner/settings")}>
              Settings
            </GhostBtn>
          </div>
          <p className="mt-4 text-xs font-mono text-zinc-400 leading-relaxed">
            This engine collects field evidence to support evaluation. It does not replace
            licensed professional judgment.
          </p>
        </Card>
      </Shell>
    );
  }

  if (screen === "JOB_INFO") {
    return (
      <Shell>
        <Card>
          <TopBar />
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Job Information</p>
          <p className="text-base font-mono text-white mb-6">
            Enter job details before beginning diagnosis.
          </p>
          <div className="flex flex-col gap-3 mb-6">
            {[
              { key: "jobSiteAddress", label: "Job Site Address", required: true },
              { key: "equipmentType", label: "Equipment Type", required: false },
              { key: "equipmentMake", label: "Equipment Make", required: false },
              { key: "equipmentModel", label: "Equipment Model", required: false },
              { key: "serialNumber", label: "Serial Number", required: false },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
                  {label}
                  {required ? " *" : ""}
                </p>
                <input
                  type="text"
                  value={form[key as keyof typeof form]}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400"
                  placeholder={label}
                />
              </div>
            ))}
          </div>
          <PrimaryBtn
            disabled={!form.jobSiteAddress.trim()}
            onClick={() => {
              setJobInfo(form);
              if (run) setRun({ ...run, jobInfo: form });
              setScreen("COMPLAINT");
            }}
          >
            Continue →
          </PrimaryBtn>
        </Card>
      </Shell>
    );
  }

  if (screen === "COMPLAINT") {
    return (
      <Shell>
        <Card>
          <TopBar />
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">
            Presenting symptoms
          </p>
          <p className="text-base font-mono text-white mb-2">
            Select all symptoms present.
          </p>
          <p className="text-xs font-mono text-zinc-400 mb-6">
            Select one or more then tap Continue.
          </p>
          <div className="flex flex-col gap-2 mb-6">
            {pack.complaintCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() =>
                  setComplaintIds((prev) =>
                    prev.includes(cat.id)
                      ? prev.filter((id) => id !== cat.id)
                      : [...prev, cat.id]
                  )
                }
                className={`w-full text-left px-4 py-4 border font-mono text-sm transition-colors ${
                  complaintIds.includes(cat.id)
                    ? "border-white bg-zinc-700 text-white"
                    : "border-zinc-600 text-white"
                }`}
              >
                {cat.label}
                {cat.description && (
                  <span className="block text-sm text-zinc-400 mt-0.5">
                    {cat.description}
                  </span>
                )}
              </button>
            ))}
          </div>
          <PrimaryBtn
            disabled={complaintIds.length === 0}
            onClick={() => selectComplaints(complaintIds)}
          >
            Continue →
          </PrimaryBtn>
        </Card>
      </Shell>
    );
  }

  if (screen === "DIAGNOSTIC" && currentStep && run) {
    const isChoice = ["YES_NO", "YES_NO_UNABLE", "SELECT"].includes(
      currentStep.capture.type
    );
    const isNumber = currentStep.capture.type === "NUMBER";
    const options =
      currentStep.capture.type === "YES_NO"
        ? ["Yes", "No"]
        : currentStep.capture.type === "YES_NO_UNABLE"
        ? ["Yes", "No", "Unable to determine"]
        : currentStep.capture.options ?? [];

    return (
      <Shell>
        <Card>
          <TopBar>
            <Pill label={run.evidenceState.replace(/_/g, "-")} />
          </TopBar>
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-mono uppercase text-zinc-400 mb-2">
                Step {evidenceLog.length + 1}
              </p>
              <h2 className="text-xl font-mono font-bold text-white">
                {currentStep.title}
              </h2>
            </div>
            <p className="text-base font-mono text-white leading-relaxed">
              {currentStep.prompt}
            </p>
            {currentStep.hint && <HintDrawer hint={currentStep.hint} />}
            {isChoice && (
              <ChoiceInput
                options={options}
                onSelect={(v) => commitEvidence(currentStep, v)}
              />
            )}
            {isNumber && (
              <NumberInput
                unit={currentStep.capture.unit}
                placeholder={currentStep.capture.placeholder}
                onSubmit={(v) => commitEvidence(currentStep, v)}
              />
            )}
          </div>
        </Card>
        <div className="mt-3">
          <GhostBtn onClick={reset}>Reset session</GhostBtn>
        </div>
      </Shell>
    );
  }

  if (screen === "READY" && run) {
    const primaryLabel = run.primaryCondition
      ? pack.reportTemplates.conditionLabels[run.primaryCondition] ?? run.primaryCondition
      : "Undetermined";
    return (
      <Shell>
        <Card>
          <TopBar>
            <Pill label="Ready to Report" color="text-green-300 border-green-600" />
          </TopBar>
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">
            Evaluation complete
          </p>
          <p className="text-base font-mono text-white mb-6">
            Minimum evidence path satisfied.
          </p>
          <div className="border border-zinc-600 px-4 py-4 mb-6">
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
              Primary indication
            </p>
            <p className="text-lg font-mono font-bold text-white mb-3">{primaryLabel}</p>
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
              Evidence strength
            </p>
            <Pill label={run.evidenceState.replace(/_/g, "-")} />
          </div>
          <PrimaryBtn onClick={() => finalize()}>Generate report →</PrimaryBtn>
        </Card>
        <div className="mt-3">
          <GhostBtn onClick={reset}>Reset session</GhostBtn>
        </div>
      </Shell>
    );
  }

  if (screen === "DATA_NEEDED" && run) {
    return (
      <Shell>
        <Card>
          <TopBar>
            <Pill label="Data Needed" color="text-yellow-300 border-yellow-600" />
          </TopBar>
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">
            Evaluation limit reached
          </p>
          <p className="text-base font-mono text-white leading-relaxed mb-4">
            Additional measurements required before final evaluation.
          </p>
          <PrimaryBtn onClick={() => finalize(true)}>
            Generate inconclusive report →
          </PrimaryBtn>
        </Card>
        <div className="mt-3">
          <GhostBtn onClick={reset}>Reset session</GhostBtn>
        </div>
      </Shell>
    );
  }

  // ─── REPORT SCREEN ───────────────────────────────────────

  if (screen === "REPORT" && reports) {
    const shareOrCopy = async (text: string, title: string) => {
      if (navigator.share) {
        try { await navigator.share({ title, text }); } catch {}
      } else {
        try {
          await navigator.clipboard.writeText(text);
          setCopySuccess(true);
          setTimeout(() => setCopySuccess(false), 2500);
        } catch {}
      }
    };

    const emailOffice = (body: string) => {
      const subject = `SureStep Report — ${jobInfo?.jobSiteAddress ?? "Job"} — ${reports.technical.runId}`;
      window.location.href = `mailto:${encodeURIComponent(officeEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    const tabs = [
      { id: "customer", label: "Customer" },
      { id: "technician", label: "Technician" },
      { id: "office", label: "Office" },
    ] as const;

    return (
      <Shell>
        {/* Banner */}
        {reportBanner && (
          <div className="mb-3 px-4 py-2 bg-zinc-700 border border-zinc-600">
            <p className="text-xs font-mono text-zinc-200 tracking-wide">{reportBanner}</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex mb-3 border border-zinc-700">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setReportTab(t.id)}
              className={`flex-1 py-3 font-mono text-xs tracking-widest uppercase transition-colors ${
                reportTab === t.id
                  ? "bg-white text-zinc-900 font-bold"
                  : "bg-zinc-800 text-zinc-400 active:bg-zinc-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <Card>
          {reportTab === "customer" && (
            <p className="text-base text-white leading-relaxed">{reports.customerStory}</p>
          )}
          {reportTab === "technician" && (
            <p className="text-base text-white leading-relaxed">{reports.techStory}</p>
          )}
          {reportTab === "office" && (
            <p className="text-xs font-mono text-zinc-300 leading-relaxed whitespace-pre-wrap">{reports.auditRecord}</p>
          )}
        </Card>

        {/* Per-tab actions */}
        <div className="flex flex-col gap-2 mt-3">
          {reportTab === "customer" && (
            <button
              onClick={() => shareOrCopy(reports.customerStory, "Cooling System Evaluation")}
              className="w-full py-3 bg-white text-zinc-900 font-mono text-xs tracking-widest uppercase font-bold active:bg-zinc-100 transition-colors"
            >
              {copySuccess ? "Copied ✓" : "Share →"}
            </button>
          )}

          {reportTab === "technician" && (
            <>
              <button
                onClick={() => shareOrCopy(reports.techStory, "Field Report")}
                className="w-full py-3 bg-white text-zinc-900 font-mono text-xs tracking-widest uppercase font-bold active:bg-zinc-100 transition-colors"
              >
                {copySuccess ? "Copied ✓" : "Share →"}
              </button>
              {officeEmail ? (
                <button
                  onClick={() => emailOffice(reports.techStory)}
                  className="w-full py-3 bg-zinc-700 text-white font-mono text-xs tracking-widest uppercase active:bg-zinc-600 transition-colors"
                >
                  Email to office →
                </button>
              ) : (
                <button
                  onClick={() => router.push("/runner/settings")}
                  className="w-full py-3 bg-zinc-700 text-zinc-400 font-mono text-xs tracking-widest uppercase active:bg-zinc-600 transition-colors"
                >
                  Set office email
                </button>
              )}
            </>
          )}

          {reportTab === "office" && (
            <>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(reports.auditRecord);
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 2500);
                  } catch {}
                }}
                className="w-full py-3 bg-white text-zinc-900 font-mono text-xs tracking-widest uppercase font-bold active:bg-zinc-100 transition-colors"
              >
                {copySuccess ? "Copied ✓" : "Copy →"}
              </button>
              {officeEmail ? (
                <button
                  onClick={() => emailOffice(reports.auditRecord)}
                  className="w-full py-3 bg-zinc-700 text-white font-mono text-xs tracking-widest uppercase active:bg-zinc-600 transition-colors"
                >
                  Email to office →
                </button>
              ) : (
                <button
                  onClick={() => router.push("/runner/settings")}
                  className="w-full py-3 bg-zinc-700 text-zinc-400 font-mono text-xs tracking-widest uppercase active:bg-zinc-600 transition-colors"
                >
                  Set office email
                </button>
              )}
              <button
                onClick={() => generatePDF(reports, jobInfo)}
                className="w-full py-3 bg-zinc-700 text-white font-mono text-xs tracking-widest uppercase active:bg-zinc-600 transition-colors"
              >
                Save PDF →
              </button>
            </>
          )}

          <PrimaryBtn onClick={reset}>Start new session →</PrimaryBtn>
        </div>
      </Shell>
    );
  }

  // ─── EXPRESS SCREEN ──────────────────────────────────────

  if (screen === "EXPRESS") {
    // Local state via a reducer-style object passed as props isn't available here —
    // we use a single expressForm object stored in component state below.
    return <ExpressScreen
      form={form}
      setForm={setForm}
      complaintIds={complaintIds}
      setComplaintIds={setComplaintIds}
      pack={pack}
      onSubmit={(expressLog, expressComplaintIds, primaryOverride, expressJobInfo) => {
        const now = new Date().toISOString();
        const primaryId = expressComplaintIds[0] ?? "other";
        const expressRun: Run = {
          id: generateId(),
          packId: pack.id,
          complaintId: primaryId,
          complaintIds: expressComplaintIds.length > 0 ? expressComplaintIds : ["other"],
          phase: "READY_TO_REPORT",
          role: "TECHNICIAN",
          capability: "TOOL_PROOF_AVAILABLE",
          evidenceState: "NONE",
          primaryCondition: primaryOverride ?? null,
          secondaryCondition: null,
          currentStepId: null,
          determinationLock: "UNLOCKED",
          safetyState: "NORMAL",
          startedAt: now,
          updatedAt: now,
          completedAt: now,
          jobInfo: expressJobInfo,
        };
        const evidence: Record<string, string> = {};
        for (const e of expressLog) evidence[e.tag] = e.value;
        const freshCtx: RunContext = { evidence, role: "TECHNICIAN", capability: "TOOL_PROOF_AVAILABLE", complaintId: primaryId };
        const scores = computeConditionScores(pack, expressLog, freshCtx);
        const primary = primaryOverride ?? getPrimaryCondition(scores, pack.tieBreakPriority);
        const secondary = getSecondaryCondition(scores, primary, pack.tieBreakPriority);
        const evidenceState = computeEvidenceState(scores, primary, pack.promotionThresholds);
        const finalRun = { ...expressRun, primaryCondition: primary, secondaryCondition: secondary, evidenceState };
        const ids = finalRun.complaintIds;
        const { rootCause, downstreamEffects } = computeRootCauseAndEffects(pack, ids, primary);
        const r = generateReports(finalRun, expressLog, scores, pack, rootCause, downstreamEffects);
        setJobInfo(expressJobInfo);
        setRun(finalRun);
        setEvidenceLog(expressLog);
        setReports(r);
        saveSession(finalRun, expressLog, r);
        openReport(r, expressJobInfo);
      }}
      onCancel={() => setScreen("INTRO")}
    />;
  }

  return (
    <Shell>
      <Card>
        <p className="font-mono text-base text-white">Loading...</p>
      </Card>
    </Shell>
  );
}

// ─── Express Screen Component ────────────────────────────────

type ExpressFormState = {
  // job
  technicianName: string; companyName: string; jobSiteAddress: string;
  equipmentType: string; equipmentMake: string; equipmentModel: string; serialNumber: string;
  // indoor
  thermostatResponse: string; airflowAtFilter: string; filterCondition: string;
  lowVoltage: string; highVoltage: string; transformer: string; fuse: string;
  // outdoor
  fanRunning: string; compressorSound: string; capacitorVisual: string;
  capacitorReading: string; suctionPsi: string; headPsi: string; pressurePattern: string;
  // conclusion
  primaryCondition: string; notes: string;
  // repair outcome
  repairOutcome: string; componentReplaced: string; repairFollowup: string;
};

const EXPRESS_EMPTY: ExpressFormState = {
  technicianName: "", companyName: "", jobSiteAddress: "",
  equipmentType: "", equipmentMake: "", equipmentModel: "", serialNumber: "",
  thermostatResponse: "", airflowAtFilter: "", filterCondition: "",
  lowVoltage: "", highVoltage: "", transformer: "", fuse: "",
  fanRunning: "", compressorSound: "", capacitorVisual: "",
  capacitorReading: "", suctionPsi: "", headPsi: "", pressurePattern: "",
  primaryCondition: "", notes: "",
  repairOutcome: "", componentReplaced: "", repairFollowup: "",
};

function ExpressSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">{label}</p>
      <div className="flex flex-col gap-1">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(value === opt ? "" : opt)}
            className={`w-full text-left px-3 py-2 border font-mono text-sm transition-colors ${
              value === opt ? "border-white bg-zinc-700 text-white" : "border-zinc-700 text-zinc-300"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function ExpressScreen({
  form, setForm, complaintIds, setComplaintIds, pack, onSubmit, onCancel,
}: {
  form: { technicianName: string; companyName: string; jobSiteAddress: string; equipmentType: string; equipmentMake: string; equipmentModel: string; serialNumber: string };
  setForm: React.Dispatch<React.SetStateAction<{ technicianName: string; companyName: string; jobSiteAddress: string; equipmentType: string; equipmentMake: string; equipmentModel: string; serialNumber: string }>>;
  complaintIds: string[];
  setComplaintIds: React.Dispatch<React.SetStateAction<string[]>>;
  pack: typeof HVAC_COOLING_PACK;
  onSubmit: (log: Evidence[], complaintIds: string[], primaryOverride: string | null, jobInfo: JobInfo) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState<ExpressFormState>({
    ...EXPRESS_EMPTY,
    technicianName: form.technicianName ?? "",
    companyName: form.companyName ?? "",
    jobSiteAddress: form.jobSiteAddress ?? "",
    equipmentType: form.equipmentType ?? "",
    equipmentMake: form.equipmentMake ?? "",
    equipmentModel: form.equipmentModel ?? "",
    serialNumber: form.serialNumber ?? "",
  });
  const [expressComplaintIds, setExpressComplaintIds] = useState<string[]>(complaintIds);

  const set = (k: keyof ExpressFormState) => (v: string) => setD((prev) => ({ ...prev, [k]: v }));

  function clearDownstream(field: keyof ExpressFormState, value: string): Partial<ExpressFormState> {
    const outdoor: Partial<ExpressFormState> = {
      fanRunning: "", compressorSound: "", capacitorVisual: "",
      capacitorReading: "", suctionPsi: "", headPsi: "", pressurePattern: "",
    };
    const indoorElectrical: Partial<ExpressFormState> = {
      lowVoltage: "", highVoltage: "", transformer: "", fuse: "",
    };
    if (field === "thermostatResponse") {
      return { airflowAtFilter: "", filterCondition: "", ...indoorElectrical, ...outdoor };
    }
    if (field === "airflowAtFilter") {
      if (value === "No airflow") return { filterCondition: "", ...outdoor };
      return { filterCondition: "", ...indoorElectrical };
    }
    if (field === "fanRunning" || field === "compressorSound") {
      return { capacitorVisual: "", capacitorReading: "", suctionPsi: "", headPsi: "", pressurePattern: "" };
    }
    if (field === "capacitorReading" && (value === "Below spec" || value === "Open — no reading")) {
      return { suctionPsi: "", headPsi: "", pressurePattern: "" };
    }
    return {};
  }

  // ── Auto-suggest primary condition ─────────────────────────
  let suggestedCondition = "";
  if (d.capacitorVisual === "Obvious failure — bulging or oil" || d.capacitorReading === "Below spec" || d.capacitorReading === "Open — no reading") {
    suggestedCondition = "Electrical";
  } else if (d.thermostatResponse === "Nothing responds" && d.lowVoltage === "No — 0V") {
    suggestedCondition = "Control System";
  } else if (d.airflowAtFilter === "No airflow" || (d.airflowAtFilter === "Weak" && d.filterCondition === "Severely restricted or missing")) {
    suggestedCondition = "Airflow";
  } else if (d.pressurePattern === "Suction low (restriction or leak)" || d.pressurePattern === "Head pressure high (overcharge or blockage)") {
    suggestedCondition = "Refrigerant System";
  } else if (d.compressorSound === "Attempting but not starting") {
    suggestedCondition = "Mechanical";
  } else if (d.airflowAtFilter === "Weak") {
    suggestedCondition = "Airflow";
  }

  function handleSubmit() {
    const now = new Date().toISOString();
    const log: Evidence[] = [];

    function add(tag: string, value: string, sourceType: Evidence["sourceType"], unit?: string) {
      if (value.trim()) log.push({ tag, value: value.trim(), sourceType, unit, timestamp: now });
    }

    add("thermostat.response", d.thermostatResponse, "OBSERVED");
    add("airflow.at_filter", d.airflowAtFilter, "OBSERVED");
    if (d.airflowAtFilter !== "No airflow") add("airflow.filter_condition", d.filterCondition, "OBSERVED");
    if (d.airflowAtFilter === "No airflow") {
      add("indoor.low_voltage", d.lowVoltage, "TOOL_PROOF");
      if (d.lowVoltage === "No — 0V") add("indoor.high_voltage", d.highVoltage, "TOOL_PROOF");
      if (d.highVoltage === "Both legs present" && d.lowVoltage === "No — 0V") add("indoor.transformer", d.transformer, "OBSERVED");
      if (d.lowVoltage === "Yes — 24V present") add("indoor.board.fuse", d.fuse, "OBSERVED");
    }
    add("outdoor.fan.running", d.fanRunning === "Running" ? "Yes" : d.fanRunning === "Not running" ? "No" : "", "OBSERVED");
    add("outdoor.compressor.sound", d.compressorSound, "OBSERVED");
    const _capVisualFailed = d.capacitorVisual === "Obvious failure — bulging or oil";
    const _capReadingFailed = d.capacitorReading === "Below spec" || d.capacitorReading === "Open — no reading";
    if (d.fanRunning && d.compressorSound) {
      add("outdoor.capacitor.visual", d.capacitorVisual, "OBSERVED");
      if (!_capVisualFailed) add("outdoor.capacitor.reading", d.capacitorReading, "TOOL_PROOF");
    }
    if (d.compressorSound === "Running — steady hum / vibration" && !_capReadingFailed) {
      add("refrigerant.suction_psi", d.suctionPsi, "TOOL_PROOF", "PSI");
      add("refrigerant.liquid_psi", d.headPsi, "TOOL_PROOF", "PSI");
      add("refrigerant.pressure_pattern", d.pressurePattern, "OBSERVED");
    }
    if (d.notes.trim()) add("express.notes", d.notes, "REPORTED");
    add("repair.outcome", d.repairOutcome, "OBSERVED");
    if ((d.repairOutcome === "Component replaced — system restored" || d.repairOutcome === "Component replaced — further diagnosis needed") && d.componentReplaced.trim())
      add("repair.component_replaced", d.componentReplaced, "OBSERVED");
    if ((d.repairOutcome === "Component replaced — further diagnosis needed" || d.repairOutcome === "Quote provided — authorization pending" || d.repairOutcome === "Referred to electrician") && d.repairFollowup)
      add("repair.followup", d.repairFollowup, "OBSERVED");

    const jobInfo: JobInfo = {
      technicianName: d.technicianName,
      companyName: d.companyName,
      jobSiteAddress: d.jobSiteAddress,
      equipmentType: d.equipmentType,
      equipmentMake: d.equipmentMake,
      equipmentModel: d.equipmentModel,
      serialNumber: d.serialNumber,
    };

    setForm({
      technicianName: d.technicianName, companyName: d.companyName,
      jobSiteAddress: d.jobSiteAddress, equipmentType: d.equipmentType,
      equipmentMake: d.equipmentMake, equipmentModel: d.equipmentModel,
      serialNumber: d.serialNumber,
    });
    setComplaintIds(expressComplaintIds);

    onSubmit(log, expressComplaintIds, d.primaryCondition || null, jobInfo);
  }

  const canSubmit = d.jobSiteAddress.trim();

  return (
    <Shell>
      <Card>
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-mono uppercase text-zinc-400 tracking-widest">Express Entry</p>
          <button onClick={onCancel} className="text-xs font-mono text-zinc-500 uppercase tracking-widest">← Back</button>
        </div>

        <div className="flex flex-col gap-6">

          {/* Section 1 — Job Info */}
          <div>
            <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Job Information</p>
            <div className="flex flex-col gap-3">
              {([
                { k: "jobSiteAddress", label: "Job Site Address", req: true },
                { k: "equipmentType", label: "Equipment Type", req: false },
                { k: "equipmentMake", label: "Equipment Make", req: false },
                { k: "equipmentModel", label: "Equipment Model", req: false },
                { k: "serialNumber", label: "Serial Number", req: false },
              ] as const).map(({ k, label, req }) => (
                <div key={k}>
                  <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">{label}{req ? " *" : ""}</p>
                  <input
                    type="text"
                    value={d[k]}
                    onChange={(e) => set(k)(e.target.value)}
                    placeholder={label}
                    className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-700" />

          {/* Section 2 — Symptoms */}
          <div>
            <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Symptoms</p>
            <div className="flex flex-col gap-2">
              {pack.complaintCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setExpressComplaintIds((prev) =>
                    prev.includes(cat.id) ? prev.filter((id) => id !== cat.id) : [...prev, cat.id]
                  )}
                  className={`w-full text-left px-4 py-3 border font-mono text-sm transition-colors ${
                    expressComplaintIds.includes(cat.id) ? "border-white bg-zinc-700 text-white" : "border-zinc-700 text-zinc-300"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-zinc-700" />

          {/* Section 3 — Indoor */}
          <div>
            <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Indoor</p>
            <div className="flex flex-col gap-4">
              <ExpressSelect label="Thermostat response" value={d.thermostatResponse} onChange={(v) =>
                setD((prev) => ({ ...prev, thermostatResponse: v, ...clearDownstream("thermostatResponse", v) }))}
                options={["Blower starts", "Nothing responds", "Already running"]} />
              <ExpressSelect label="Airflow at return" value={d.airflowAtFilter} onChange={(v) =>
                setD((prev) => ({ ...prev, airflowAtFilter: v, ...clearDownstream("airflowAtFilter", v) }))}
                options={["Strong and steady", "Weak", "No airflow"]} />
              {d.airflowAtFilter !== "" && d.airflowAtFilter !== "No airflow" && (
                <ExpressSelect label="Filter condition" value={d.filterCondition} onChange={set("filterCondition")}
                  options={["Clean", "Dirty but open", "Severely restricted or missing"]} />
              )}
              {d.airflowAtFilter === "No airflow" && (
                <>
                  <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mt-2 border-b border-zinc-600 pb-2">Indoor Electrical</p>
                  <ExpressSelect label="Low voltage at board (24V)" value={d.lowVoltage} onChange={set("lowVoltage")}
                    options={["Yes — 24V present", "No — 0V"]} />
                  {d.lowVoltage === "No — 0V" && (
                    <ExpressSelect label="High voltage at unit (240V)" value={d.highVoltage} onChange={set("highVoltage")}
                      options={["Both legs present", "One leg missing", "No voltage either leg"]} />
                  )}
                  {d.lowVoltage === "No — 0V" && d.highVoltage === "Both legs present" && (
                    <ExpressSelect label="Transformer" value={d.transformer} onChange={set("transformer")}
                      options={["Confirmed — bad transformer", "Recheck — low voltage now present"]} />
                  )}
                  {d.lowVoltage === "Yes — 24V present" && (
                    <ExpressSelect label="Control fuse" value={d.fuse} onChange={set("fuse")}
                      options={["Fuse good", "Fuse blown", "No fuse on board"]} />
                  )}
                </>
              )}
            </div>
          </div>

          {d.airflowAtFilter !== "" && d.airflowAtFilter !== "No airflow" && (
            <>
              <div className="border-t border-zinc-700" />

              {/* Section 4 — Outdoor */}
              <div>
                <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Outdoor</p>
                <div className="flex flex-col gap-4">
                  <ExpressSelect label="Condenser fan" value={d.fanRunning} onChange={(v) =>
                    setD((prev) => ({ ...prev, fanRunning: v, ...clearDownstream("fanRunning", v) }))}
                    options={["Running", "Not running"]} />
                  <ExpressSelect label="Compressor" value={d.compressorSound} onChange={(v) =>
                    setD((prev) => ({ ...prev, compressorSound: v, ...clearDownstream("compressorSound", v) }))}
                    options={["Running — steady hum / vibration", "Attempting but not starting", "Silent — no attempt"]} />
                  {d.fanRunning !== "" && d.compressorSound !== "" && (
                    <ExpressSelect label="Capacitor visual" value={d.capacitorVisual} onChange={set("capacitorVisual")}
                      options={["Normal — no visible damage", "Obvious failure — bulging or oil", "Burn marks or discoloration"]} />
                  )}
                  {d.fanRunning !== "" && d.compressorSound !== "" && d.capacitorVisual !== "Obvious failure — bulging or oil" && (
                    <ExpressSelect label="Capacitor reading" value={d.capacitorReading} onChange={(v) =>
                      setD((prev) => ({ ...prev, capacitorReading: v, ...clearDownstream("capacitorReading", v) }))}
                      options={["Within spec", "Below spec", "Open — no reading"]} />
                  )}
                  {d.compressorSound === "Running — steady hum / vibration" && d.capacitorReading !== "Below spec" && d.capacitorReading !== "Open — no reading" && (
                    <>
                      <p className="text-xs font-mono text-zinc-500">
                        Record only if compressor has been running at least 5 minutes
                      </p>
                      <div>
                        <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">Suction pressure (PSI)</p>
                        <input type="number" value={d.suctionPsi} onChange={(e) => set("suctionPsi")(e.target.value)}
                          placeholder="e.g. 115" className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400" />
                      </div>
                      <div>
                        <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">Head pressure (PSI)</p>
                        <input type="number" value={d.headPsi} onChange={(e) => set("headPsi")(e.target.value)}
                          placeholder="e.g. 275" className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400" />
                      </div>
                      <ExpressSelect label="Pressure pattern" value={d.pressurePattern} onChange={set("pressurePattern")}
                        options={["Both pressures normal", "Suction low (restriction or leak)", "Head pressure high (overcharge or blockage)"]} />
                    </>
                  )}
                </div>
              </div>
            </>
          )}

          <div className="border-t border-zinc-700" />

          {/* Section 5 — Conclusion */}
          <div>
            <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Conclusion</p>
            <div className="flex flex-col gap-4">
              {suggestedCondition && d.primaryCondition !== suggestedCondition && (
                <div className="flex items-center justify-between border border-zinc-700 px-3 py-2">
                  <p className="text-xs font-mono text-zinc-400">Suggested: <span className="text-white">{suggestedCondition}</span></p>
                  <button
                    onClick={() => set("primaryCondition")(suggestedCondition)}
                    className="text-xs font-mono text-zinc-400 uppercase tracking-widest ml-4 active:text-white"
                  >
                    Apply →
                  </button>
                </div>
              )}
              <ExpressSelect label="Primary condition" value={d.primaryCondition} onChange={set("primaryCondition")}
                options={pack.conditionTaxonomy} />
              <div>
                <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">Notes</p>
                <input type="text" value={d.notes} onChange={(e) => set("notes")(e.target.value)}
                  placeholder="Any additional observations" className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400" />
              </div>
            </div>
          </div>

          <div className="border-t border-zinc-700" />

          {/* Section 6 — Repair Outcome */}
          <div>
            <p className="text-sm font-mono font-bold text-white uppercase tracking-widest mb-3 border-b border-zinc-600 pb-2">Repair Outcome</p>
            <div className="flex flex-col gap-4">
              <ExpressSelect label="Repair performed?" value={d.repairOutcome} onChange={set("repairOutcome")}
                options={[
                  "Component replaced — system restored",
                  "Component replaced — further diagnosis needed",
                  "Quote provided — authorization pending",
                  "Referred to electrician",
                  "Diagnosis only — no repair performed",
                ]} />
              {(d.repairOutcome === "Component replaced — system restored" || d.repairOutcome === "Component replaced — further diagnosis needed") && (
                <div>
                  <p className="text-xs font-mono font-bold text-zinc-300 uppercase tracking-wider mb-1">Component replaced</p>
                  <input type="text" value={d.componentReplaced} onChange={(e) => set("componentReplaced")(e.target.value)}
                    placeholder="e.g. run capacitor, transformer, contactor" className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400" />
                </div>
              )}
              {(d.repairOutcome === "Component replaced — further diagnosis needed" || d.repairOutcome === "Quote provided — authorization pending" || d.repairOutcome === "Referred to electrician") && (
                <ExpressSelect label="Follow up needed?" value={d.repairFollowup} onChange={set("repairFollowup")}
                  options={["Yes — scheduled", "Yes — pending", "No"]} />
              )}
            </div>
          </div>

        </div>
      </Card>

      <div className="mt-3">
        <PrimaryBtn disabled={!canSubmit} onClick={handleSubmit}>
          Generate report →
        </PrimaryBtn>
      </div>
      <div className="mt-2">
        <GhostBtn onClick={onCancel}>Cancel</GhostBtn>
      </div>
    </Shell>
  );
}
