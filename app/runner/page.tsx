"use client";

import { useState, useMemo, useEffect } from "react";
import { HVAC_COOLING_PACK } from "../packs/hvac/cooling/pack";
import {
  getNextRequiredStep,
  computeConditionScores,
  getPrimaryCondition,
  getSecondaryCondition,
  computeEvidenceState,
  computeDeterminationLock,
  computePhase,
} from "./engine";
import { generateReports } from "./reports";
import { generatePDF } from "./pdf";
import type {
  Run,
  Evidence,
  UserRole,
  Capability,
  PackStep,
  RunContext,
  RunReports,
} from "./types";

function generateId(): string {
  return "SS-" + Date.now().toString(36).toUpperCase();
}

function saveSession(run: Run, log: Evidence[], reports: RunReports | null) {
  try { localStorage.setItem("surestep:session", JSON.stringify({ run, evidenceLog: log, reports })); } catch {}
}

function loadSession() {
  try { const raw = localStorage.getItem("surestep:session"); if (!raw) return null; return JSON.parse(raw); } catch { return null; }
}

const TIER0 = ["fire", "smoke", "arcing", "gas odor", "gas smell", "co alarm", "carbon monoxide", "burning smell", "flooding", "sparks"];
const TIER05 = ["possible gas", "faint smell", "unusual odor", "might be smoke"];

function checkSafety(text: string): "NORMAL" | "TIER_0" | "TIER_0_5" {
  const lower = text.toLowerCase();
  if (TIER0.some((t) => lower.includes(t))) return "TIER_0";
  if (TIER05.some((t) => lower.includes(t))) return "TIER_0_5";
  return "NORMAL";
}

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
        <p className="text-sm font-mono text-zinc-200">HVAC Cooling Pack v1.0</p>
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

function PrimaryBtn({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
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

function NumberInput({ unit, placeholder, onSubmit }: { unit?: string; placeholder?: string; onSubmit: (v: string) => void }) {
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
        className="text-xs font-mono uppercase text-zinc-400 border-b border-dashed border-zinc-500"
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

const pack = HVAC_COOLING_PACK;
type Screen = "INTRO" | "ROLE" | "COMPLAINT" | "DIAGNOSTIC" | "READY" | "DATA_NEEDED" | "REPORT" | "EMERGENCY" | "SAFETY_CLARIFY";

export default function RunnerPage() {
  const [screen, setScreen] = useState<Screen>("INTRO");
  const [run, setRun] = useState<Run | null>(null);
  const [evidenceLog, setEvidenceLog] = useState<Evidence[]>([]);
  const [reports, setReports] = useState<RunReports | null>(null);
  const [safetyTrigger, setSafetyTrigger] = useState<string | null>(null);
  const [pendingStep, setPendingStep] = useState<PackStep | null>(null);
  const [pendingValue, setPendingValue] = useState<string | null>(null);
  const [reportTab, setReportTab] = useState<"user" | "technical">("user");
  const [selectedRole, setSelectedRole] = useState<UserRole | null>("TECHNICIAN"); const [jobInfo, setJobInfo] = useState<import("./types").JobInfo | null>(null); const [form, setForm] = useState({ technicianName: "", companyName: "", jobSiteAddress: "", equipmentType: "", equipmentMake: "", equipmentModel: "", serialNumber: "" });

  useEffect(() => {
    const saved = loadSession();
    if (saved?.run && !saved.run.completedAt) {
      setRun(saved.run);
      setEvidenceLog(saved.evidenceLog ?? []);
      setReports(saved.reports ?? null);
      if (saved.reports) setScreen("REPORT");
      else if (saved.run.phase === "DATA_NEEDED") setScreen("DATA_NEEDED");
      else if (saved.run.phase === "READY_TO_REPORT") setScreen("READY");
      else setScreen("DIAGNOSTIC");
    }
  }, []);

  const ctx: RunContext | null = useMemo(() => {
    if (!run) return null;
    const evidence: Record<string, string> = {};
    for (const ev of evidenceLog) evidence[ev.tag] = ev.value;
    return { evidence, role: run.role, capability: run.capability, complaintId: run.complaintId };
  }, [run, evidenceLog]);

  const conditionScores = useMemo(() => {
    if (!ctx) return {};
    return computeConditionScores(pack, evidenceLog, ctx);
  }, [evidenceLog, ctx]);

  const currentStep = useMemo(() => {
    if (!run || !ctx) return null;
    return getNextRequiredStep(pack.steps[run.complaintId] ?? [], ctx);
  }, [run, ctx]);

  function refreshRun(baseRun: Run, log: Evidence[]): Run {
    const evidence: Record<string, string> = {};
    for (const ev of log) evidence[ev.tag] = ev.value;
    const freshCtx: RunContext = { evidence, role: baseRun.role, capability: baseRun.capability, complaintId: baseRun.complaintId };
    const scores = computeConditionScores(pack, log, freshCtx);
    const primary = getPrimaryCondition(scores, pack.tieBreakPriority);
    const secondary = getSecondaryCondition(scores, primary, pack.tieBreakPriority);
    const evidenceState = computeEvidenceState(scores, primary, pack.promotionThresholds);
    const determinationLock = computeDeterminationLock(pack, baseRun.complaintId, log, freshCtx);
    const nextStep = getNextRequiredStep(pack.steps[baseRun.complaintId] ?? [], freshCtx);
    const phase = computePhase(determinationLock, nextStep, baseRun.capability, pack, baseRun.complaintId, log, freshCtx);
    return { ...baseRun, phase, evidenceState, primaryCondition: primary, secondaryCondition: secondary, currentStepId: nextStep?.id ?? null, determinationLock, updatedAt: new Date().toISOString() };
  }

  function startSession(role: UserRole, capability: Capability) {
    const newRun: Run = {
      id: generateId(), packId: pack.id, complaintId: "", phase: "IN_PROGRESS",
      role, capability, evidenceState: "NONE", primaryCondition: null, secondaryCondition: null,
      currentStepId: null, determinationLock: "LOCKED", safetyState: "NORMAL",
      startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null,
    };
    setRun(newRun);
    setEvidenceLog([]);
    setReports(null);
    setScreen("JOB_INFO");
  }

  function selectComplaint(id: string) {
    if (!run) return;
    const updated = { ...run, complaintId: id, updatedAt: new Date().toISOString() };
    const steps = pack.steps[id] ?? [];
    if (steps.length === 0) {
      const finalRun = { ...updated, evidenceState: "INCONCLUSIVE" as const, completedAt: new Date().toISOString() };
      const r = generateReports(finalRun, [], {}, pack);
      setRun(finalRun); setReports(r); saveSession(finalRun, [], r); setScreen("REPORT");
      return;
    }
    setRun(updated);
    saveSession(updated, evidenceLog, null);
    setScreen("DIAGNOSTIC");
  }

  function commitEvidence(step: PackStep, value: string) {
    if (!run) return;
    const safety = checkSafety(value);
    if (safety === "TIER_0") { setSafetyTrigger(value); setScreen("EMERGENCY"); return; }
    if (safety === "TIER_0_5") { setSafetyTrigger(value); setPendingStep(step); setPendingValue(value); setScreen("SAFETY_CLARIFY"); return; }
    const ev: Evidence = { tag: step.capture.tag, value: value.trim(), unit: step.capture.unit, sourceType: step.capture.sourceType, timestamp: new Date().toISOString() };
    const newLog = [...evidenceLog, ev];
    setEvidenceLog(newLog);
    const updated = refreshRun(run, newLog);
    setRun(updated);
    saveSession(updated, newLog, null);
    if (updated.phase === "READY_TO_REPORT") setScreen("READY");
    else if (updated.phase === "DATA_NEEDED") setScreen("DATA_NEEDED");
  }

  function finalize(inconclusive = false) {
    if (!run) return;
    const finalRun = { ...run, evidenceState: inconclusive ? "INCONCLUSIVE" as const : run.evidenceState, completedAt: new Date().toISOString() };
    const r = generateReports(finalRun, evidenceLog, conditionScores, pack);
    setRun(finalRun); setReports(r); saveSession(finalRun, evidenceLog, r); setScreen("REPORT");
  }

  function reset() {
    try { localStorage.removeItem("surestep:session"); } catch {}
    setRun(null); setEvidenceLog([]); setReports(null); setSafetyTrigger(null);
    setPendingStep(null); setPendingValue(null); setSelectedRole("TECHNICIAN"); setScreen("INTRO");
  }

  if (screen === "EMERGENCY") {
    return (
      <Shell>
        <div className="border border-red-700 bg-zinc-900 px-5 py-6">
          <p className="text-xs font-mono tracking-widest uppercase text-red-400 mb-4">⚠ Emergency Stop</p>
          <p className="text-sm font-mono text-red-300 leading-relaxed mb-6">A life-safety hazard has been detected. Stop all equipment operation immediately.</p>
          <ol className="flex flex-col gap-2 mb-6">
            {["Evacuate the area immediately.", "Do not operate any electrical switches.", "If gas suspected — use no ignition sources.", "Call emergency services or your utility emergency line.", "Do not re-enter until cleared by professionals."].map((s, i) => (
              <li key={i} className="text-sm font-mono text-red-300">{i + 1}. {s}</li>
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
          <p className="text-xs font-mono tracking-widest uppercase text-yellow-400 mb-4">⚡ Safety Clarification Required</p>
          <p className="text-sm font-mono text-yellow-300 leading-relaxed mb-6">A potential safety concern was noted. Confirm before proceeding.</p>
          <p className="text-xs font-mono uppercase text-zinc-400 mb-3">Is there an active hazard present?</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => setScreen("EMERGENCY")} className="w-full py-4 px-4 text-left border border-red-700 text-red-300 font-mono text-sm">Yes — active hazard present</button>
            <button onClick={() => {
              setSafetyTrigger(null);
              if (pendingStep && pendingValue) {
                const step = pendingStep; const value = pendingValue;
                setPendingStep(null); setPendingValue(null);
                setScreen("DIAGNOSTIC");
                commitEvidence(step, value);
              } else { setScreen("DIAGNOSTIC"); }
            }} className="w-full py-4 px-4 text-left border border-zinc-600 text-white font-mono text-sm">No — conditions are safe</button>
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
            <p className="text-xs font-mono tracking-widest uppercase text-zinc-300 mb-3">Domain-Agnostic Diagnostic Runner</p>
            <h1 className="text-4xl font-mono font-bold text-white mb-1">SureStep</h1>
            <p className="text-sm font-mono tracking-widest uppercase text-zinc-300">HVAC Cooling Pack v1.0</p>
          </div>
          <p className="text-base font-mono text-white leading-relaxed mb-8">
            Evidence-driven diagnostic engine.<br />
            One step at a time. Safety-first.<br />
            Defensible structured reports.
          </p>
          <PrimaryBtn onClick={() => startSession("TECHNICIAN", "TOOL_PROOF_AVAILABLE")}>Begin session →</PrimaryBtn>
          <p className="mt-4 text-xs font-mono text-zinc-400 leading-relaxed">
            This engine collects field evidence to support evaluation. It does not replace licensed professional judgment.
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
          <p className="text-base font-mono text-white mb-6">Enter job details before beginning diagnosis.</p>
          <div className="flex flex-col gap-3 mb-6">
            {[
              { key: "technicianName", label: "Technician Name", required: true },
              { key: "companyName", label: "Company Name", required: true },
              { key: "jobSiteAddress", label: "Job Site Address", required: true },
              { key: "equipmentType", label: "Equipment Type", required: false },
              { key: "equipmentMake", label: "Equipment Make", required: false },
              { key: "equipmentModel", label: "Equipment Model", required: false },
              { key: "serialNumber", label: "Serial Number", required: false },
            ].map(({ key, label, required }) => (
              <div key={key}>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-1">{label}{required ? " *" : ""}</p>
                <input
                  type="text"
                  value={form[key as keyof typeof form]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400"
                  placeholder={label}
                />
              </div>
            ))}
          </div>
          <PrimaryBtn
            disabled={!form.technicianName.trim() || !form.companyName.trim() || !form.jobSiteAddress.trim()}
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
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Primary complaint</p>
          <p className="text-base font-mono text-white mb-6">Select the reported problem.</p>
          <div className="flex flex-col gap-2">
            {pack.complaintCategories.map((cat) => (
              <button key={cat.id} onClick={() => selectComplaint(cat.id)}
                className="w-full text-left px-4 py-4 border border-zinc-600 text-white font-mono text-sm active:border-zinc-400 active:bg-zinc-700 transition-colors">
                {cat.label}
                {cat.description && <span className="block text-sm text-zinc-400 mt-0.5">{cat.description}</span>}
              </button>
            ))}
          </div>
        </Card>
      </Shell>
    );
  }

  if (screen === "DIAGNOSTIC" && currentStep && run) {
    const isChoice = ["YES_NO", "YES_NO_UNABLE", "SELECT"].includes(currentStep.capture.type);
    const isNumber = currentStep.capture.type === "NUMBER";
    const options = currentStep.capture.type === "YES_NO" ? ["Yes", "No"] : currentStep.capture.type === "YES_NO_UNABLE" ? ["Yes", "No", "Unable to determine"] : currentStep.capture.options ?? [];
    return (
      <Shell>
        <Card>
          <TopBar>
            <Pill label={run.evidenceState.replace(/_/g, "-")} />
          </TopBar>
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Step {evidenceLog.length + 1}</p>
              <h2 className="text-xl font-mono font-bold text-white">{currentStep.title}</h2>
            </div>
            <p className="text-base font-mono text-white leading-relaxed">{currentStep.prompt}</p>
            {currentStep.hint && <HintDrawer hint={currentStep.hint} />}
            {isChoice && <ChoiceInput options={options} onSelect={(v) => commitEvidence(currentStep, v)} />}
            {isNumber && <NumberInput unit={currentStep.capture.unit} placeholder={currentStep.capture.placeholder} onSubmit={(v) => commitEvidence(currentStep, v)} />}
          </div>
        </Card>
        <div className="mt-3"><GhostBtn onClick={reset}>Reset session</GhostBtn></div>
      </Shell>
    );
  }

  if (screen === "READY" && run) {
    const primaryLabel = run.primaryCondition ? (pack.reportTemplates.conditionLabels[run.primaryCondition] ?? run.primaryCondition) : "Undetermined";
    return (
      <Shell>
        <Card>
          <TopBar><Pill label="Ready to Report" color="text-green-300 border-green-600" /></TopBar>
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Evaluation complete</p>
          <p className="text-base font-mono text-white mb-6">Minimum evidence path satisfied.</p>
          <div className="border border-zinc-600 px-4 py-4 mb-6">
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">Primary indication</p>
            <p className="text-lg font-mono font-bold text-white mb-3">{primaryLabel}</p>
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">Evidence strength</p>
            <Pill label={run.evidenceState.replace(/_/g, "-")} />
          </div>
          <PrimaryBtn onClick={() => finalize()}>Generate report →</PrimaryBtn>
        </Card>
        <div className="mt-3"><GhostBtn onClick={reset}>Reset session</GhostBtn></div>
      </Shell>
    );
  }

  if (screen === "DATA_NEEDED" && run) {
    return (
      <Shell>
        <Card>
          <TopBar><Pill label="Data Needed" color="text-yellow-300 border-yellow-600" /></TopBar>
          <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Evaluation limit reached</p>
          <p className="text-base font-mono text-white leading-relaxed mb-4">Additional measurements required before final evaluation.</p>
          {run.capability === "NO_TOOL_PROOF" && (
            <p className="text-sm font-mono text-zinc-300 leading-relaxed mb-6 border-l-2 border-zinc-500 pl-3">Tool-based steps are not available for your role. A technician is required to complete the evaluation.</p>
          )}
          <PrimaryBtn onClick={() => finalize(true)}>Generate inconclusive report →</PrimaryBtn>
        </Card>
        <div className="mt-3"><GhostBtn onClick={reset}>Reset session</GhostBtn></div>
      </Shell>
    );
  }

  if (screen === "REPORT" && reports) {
    const { technical, userFacing } = reports;
    return (
      <Shell>
        <div className="flex border border-zinc-600 mb-0">
          {(["user", "technical"] as const).map((t) => (
            <button key={t} onClick={() => setReportTab(t)}
              className={`flex-1 py-3 font-mono text-xs tracking-widest uppercase transition-colors ${t === "technical" ? "border-l border-zinc-600" : ""} ${reportTab === t ? "bg-zinc-700 text-white" : "text-zinc-300"}`}>
              {t === "user" ? "Summary" : "Technical"}
            </button>
          ))}
        </div>
        <Card>
          {reportTab === "user" && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-2">{userFacing.title}</p>
                <Pill label={userFacing.evidenceStrength.replace(/_/g, "-")} />
              </div>
              {[
                { label: "Technician", value: jobInfo?.technicianName ?? "" },
                { label: "Company", value: jobInfo?.companyName ?? "" },
                { label: "Job Site", value: jobInfo?.jobSiteAddress ?? "" },
                { label: "Equipment", value: [jobInfo?.equipmentMake, jobInfo?.equipmentModel, jobInfo?.serialNumber].filter(Boolean).join(" · ") || "Not specified" },
                { label: "Observation", value: userFacing.observation },
                { label: "Evidence", value: userFacing.evidenceSummary },
                { label: "Primary finding", value: userFacing.primaryFinding },
                ...(userFacing.secondaryFinding ? [{ label: "Contributing factor", value: userFacing.secondaryFinding }] : []),
                { label: "Next step", value: userFacing.nextStep },
                { label: "Maintenance note", value: userFacing.maintenanceTip },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs font-mono uppercase text-zinc-400 mb-1">{label}</p>
                  <p className="text-base font-mono text-white leading-relaxed">{value}</p>
                </div>
              ))}
            </div>
          )}
          {reportTab === "technical" && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-1">{technical.title}</p>
                <p className="text-sm font-mono text-zinc-300">{technical.runId}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Technician", value: jobInfo?.technicianName ?? "" },
                  { label: "Company", value: jobInfo?.companyName ?? "" },
                  { label: "Job Site", value: jobInfo?.jobSiteAddress ?? "" },
                  { label: "Equipment", value: [jobInfo?.equipmentMake, jobInfo?.equipmentModel, jobInfo?.serialNumber].filter(Boolean).join(" · ") || "Not specified" },
                  { label: "Complaint", value: technical.complaint },
                  { label: "Role", value: technical.role },
                  { label: "Capability", value: technical.capability },
                  { label: "Evidence state", value: technical.evidenceState },
                  { label: "Primary condition", value: technical.primaryCondition },
                  { label: "Secondary condition", value: technical.secondaryCondition ?? "None" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-xs font-mono uppercase text-zinc-400 mb-1">{label}</p>
                    <p className="text-sm font-mono text-white">{value}</p>
                  </div>
                ))}
              </div>
              {Object.keys(technical.conditionScores).length > 0 && (
                <div>
                  <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Condition scores</p>
                  {Object.entries(technical.conditionScores).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between font-mono text-sm mb-1">
                      <span className="text-white">{k}</span>
                      <span className="text-zinc-300">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-2">Evidence log</p>
                {technical.evidenceLog.map((ev, i) => (
                  <p key={i} className="text-sm font-mono text-white mb-1">{ev.tag}: {ev.value}{ev.unit ? ` ${ev.unit}` : ""}</p>
                ))}
              </div>
              <div>
                <p className="text-xs font-mono uppercase text-zinc-400 mb-1">Determination</p>
                <p className="text-sm font-mono text-white leading-relaxed">{technical.determinationSummary}</p>
              </div>
              <div className="border-t border-zinc-600 pt-4">
                <p className="text-xs font-mono uppercase text-zinc-400 mb-1">Disclaimer</p>
                <p className="text-sm font-mono text-zinc-300 leading-relaxed">{technical.disclaimer}</p>
              </div>
            </div>
          )}
        </Card>
        <div className="mt-3"><GhostBtn onClick={() => generatePDF(reports, jobInfo)}>Download PDF report</GhostBtn></div>
        <div className="mt-3"><PrimaryBtn onClick={reset}>Start new session →</PrimaryBtn></div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <p className="font-mono text-base text-white">Loading...</p>
      </Card>
    </Shell>
  );
}