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
    <div className="min-h-screen bg-neutral-950 text-neutral-200 flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`border border-neutral-800 bg-neutral-900 px-5 py-6 ${className}`}>{children}</div>;
}

function TopBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6 pb-4 border-b border-neutral-800">
      <div>
        <p className="text-[9px] font-mono tracking-widest uppercase text-neutral-700">SureStep</p>
        <p className="text-[10px] font-mono text-neutral-600">HVAC Cooling Pack v1.0</p>
      </div>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}

function Pill({ label, color = "text-neutral-600 border-neutral-800" }: { label: string; color?: string }) {
  return <span className={`text-[10px] font-mono tracking-widest uppercase border px-2 py-0.5 ${color}`}>{label}</span>;
}

function PrimaryBtn({ children, onClick, disabled = false }: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-4 bg-neutral-200 text-neutral-950 font-mono text-sm tracking-widest uppercase disabled:opacity-30 active:bg-white transition-colors">
      {children}
    </button>
  );
}

function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full py-3 border border-neutral-800 text-neutral-600 font-mono text-xs tracking-widest uppercase active:border-neutral-600 transition-colors">
      {children}
    </button>
  );
}

function ChoiceInput({ options, onSelect }: { options: string[]; onSelect: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => (
        <button key={o} onClick={() => onSelect(o)} className="w-full text-left px-4 py-4 border border-neutral-800 text-neutral-300 font-mono text-sm active:bg-neutral-900 active:border-neutral-600 transition-colors">
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
        <input type="number" inputMode="decimal" placeholder={placeholder ?? "Enter value"} value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && val.trim() && onSubmit(val.trim())}
          className="flex-1 px-4 py-4 bg-neutral-950 border border-neutral-800 border-r-0 text-neutral-200 font-mono text-lg focus:outline-none focus:border-neutral-600 placeholder:text-neutral-700" />
        {unit && <div className="px-3 flex items-center bg-neutral-900 border border-neutral-800 text-neutral-600 font-mono text-sm">{unit}</div>}
      </div>
      <PrimaryBtn onClick={() => val.trim() && onSubmit(val.trim())} disabled={!val.trim()}>Record →</PrimaryBtn>
    </div>
  );
}

function HintDrawer({ hint }: { hint: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button onClick={() => setOpen((h) => !h)} className="text-[11px] font-mono uppercase text-neutral-700 border-b border-dashed border-neutral-800">
        {open ? "Hide detail" : "Why is this needed?"}
      </button>
      {open && <p className="mt-2 text-xs font-mono text-neutral-600 leading-relaxed border-l-2 border-neutral-800 pl-3">{hint}</p>}
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
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);

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
    setScreen("COMPLAINT");
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
    setPendingStep(null); setPendingValue(null); setSelectedRole(null); setScreen("INTRO");
  }

  if (screen === "EMERGENCY") {
    return (
      <Shell>
        <div className="border border-red-900 bg-neutral-950 px-5 py-6">
          <p className="text-[10px] font-mono tracking-widest uppercase text-red-700 mb-4">⚠ Emergency Stop</p>
          <p className="text-sm font-mono text-red-400 leading-relaxed mb-6">A life-safety hazard has been detected. Stop all equipment operation immediately.</p>
          <ol className="flex flex-col gap-2 mb-6">
            {["Evacuate the area immediately.", "Do not operate any electrical switches.", "If gas suspected — use no ignition sources.", "Call emergency services or your utility emergency line.", "Do not re-enter until cleared by professionals."].map((s, i) => (
              <li key={i} className="text-xs font-mono text-red-700">{i + 1}. {s}</li>
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
        <div className="border border-yellow-900 bg-neutral-950 px-5 py-6">
          <p className="text-[10px] font-mono tracking-widest uppercase text-yellow-700 mb-4">⚡ Safety Clarification Required</p>
          <p className="text-sm font-mono text-yellow-600 leading-relaxed mb-6">A potential safety concern was noted. Confirm before proceeding.</p>
          <p className="text-[10px] font-mono uppercase text-neutral-700 mb-3">Is there an active hazard present?</p>
          <div className="flex flex-col gap-2">
            <button onClick={() => setScreen("EMERGENCY")} className="w-full py-4 px-4 text-left border border-red-900 text-red-700 font-mono text-sm">Yes — active hazard present</button>
            <button onClick={() => {
              setSafetyTrigger(null);
              if (pendingStep && pendingValue) {
                const step = pendingStep; const value = pendingValue;
                setPendingStep(null); setPendingValue(null);
                setScreen("DIAGNOSTIC");
                commitEvidence(step, value);
              } else { setScreen("DIAGNOSTIC"); }
            }} className="w-full py-4 px-4 text-left border border-neutral-800 text-neutral-400 font-mono text-sm">No — conditions are safe</button>
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
            <p className="text-[9px] font-mono tracking-[0.3em] uppercase text-neutral-700 mb-3">Domain-Agnostic Diagnostic Runner</p>
            <h1 className="text-3xl font-mono font-light text-neutral-100 mb-1">SureStep</h1>
            <p className="text-[10px] font-mono tracking-widest uppercase text-neutral-700">HVAC Cooling Pack v1.0</p>
          </div>
          <p className="text-sm font-mono text-neutral-600 leading-relaxed mb-8">Evidence-driven diagnostic engine.<br />One step at a time. Safety-first.<br />Defensible structured reports.</p>
          <PrimaryBtn onClick={() => setScreen("ROLE")}>Begin session →</PrimaryBtn>
          <p className="mt-4 text-[10px] font-mono text-neutral-800 leading-relaxed">This engine collects field evidence to support evaluation. It does not replace licensed professional judgment.</p>
        </Card>
      </Shell>
    );
  }

  if (screen === "ROLE") {
    const roles = [
      { role: "TECHNICIAN" as UserRole, capability: "TOOL_PROOF_AVAILABLE" as Capability, label: "Technician", desc: "Licensed — safe instrument access confirmed" },
      { role: "OPERATOR" as UserRole, capability: "NO_TOOL_PROOF" as Capability, label: "Operator", desc: "Equipment owner or manager" },
      { role: "OBSERVER" as UserRole, capability: "NO_TOOL_PROOF" as Capability, label: "Observer", desc: "Observation access only" },
    ];
    return (
      <Shell>
        <Card>
          <TopBar />
          <p className="text-[10px] font-mono uppercase text-neutral-700 mb-4">Identify your role</p>
          <p className="text-sm font-mono text-neutral-400 mb-6">Select the option that describes your access and training.</p>
          <div className="flex flex-col gap-2 mb-6">
            {roles.map(({ role, capability, label, desc }) => (
              <button key={role} onClick={() => setSelectedRole(role)}
                className={`w-full text-left px-4 py-4 font-mono border transition-colors ${selectedRole === role ? "border-neutral-500 bg-neutral-800 text-neutral-200" : "border-neutral-800 text-neutral-400"}`}>
                <span className="block text-sm mb-0.5">{label}</span>
                <span className="block text-[11px] text-neutral-600">{desc}</span>
              </button>
            ))}
          </div>
          <PrimaryBtn disabled={!selectedRole} onClick={() => { const r = roles.find((x) => x.role === selectedRole)!; startSession(r.role, r.capability); }}>Continue →</PrimaryBtn>
        </Card>
      </Shell>
    );
  }

  if (screen === "COMPLAINT") {
    return (
      <Shell>
        <Card>
          <TopBar />
          <p className="text-[10px] font-mono uppercase text-neutral-700 mb-4">Primary complaint</p>
          <p className="text-sm font-mono text-neutral-400 mb-6">Select the reported problem.</p>
          <div className="flex flex-col gap-2">
            {pack.complaintCategories.map((cat) => (
              <button key={cat.id} onClick={() => selectComplaint(cat.id)}
                className="w-full text-left px-4 py-4 border border-neutral-800 text-neutral-400 font-mono text-sm active:border-neutral-600 active:bg-neutral-900 transition-colors">
                {cat.label}
                {cat.description && <span className="block text-[11px] text-neutral-700 mt-0.5">{cat.description}</span>}
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
            <Pill label={run.phase.replace(/_/g, " ")} />
          </TopBar>
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-[10px] font-mono uppercase text-neutral-700 mb-2">Step {evidenceLog.length + 1}</p>
              <h2 className="text-base font-mono text-neutral-200">{currentStep.title}</h2>
            </div>
            <p className="text-sm font-mono text-neutral-400 leading-relaxed">{currentStep.prompt}</p>
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
          <TopBar><Pill label="Ready to Report" color="text-green-700 border-green-900" /></TopBar>
          <p className="text-[10px] font-mono uppercase text-neutral-700 mb-4">Evaluation complete</p>
          <p className="text-sm font-mono text-neutral-400 mb-6">Minimum evidence path satisfied.</p>
          <div className="border border-neutral-800 px-4 py-4 mb-6">
            <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">Primary indication</p>
            <p className="text-sm font-mono text-neutral-300 mb-3">{primaryLabel}</p>
            <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">Evidence strength</p>
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
          <TopBar><Pill label="Data Needed" color="text-yellow-700 border-yellow-900" /></TopBar>
          <p className="text-[10px] font-mono uppercase text-neutral-700 mb-4">Evaluation limit reached</p>
          <p className="text-sm font-mono text-neutral-400 leading-relaxed mb-4">Additional measurements required before final evaluation.</p>
          {run.capability === "NO_TOOL_PROOF" && (
            <p className="text-xs font-mono text-neutral-600 leading-relaxed mb-6 border-l-2 border-neutral-800 pl-3">Tool-based steps are not available for your role. A technician is required to complete the evaluation.</p>
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
        <div className="flex border border-neutral-800 mb-0">
          {(["user", "technical"] as const).map((t) => (
            <button key={t} onClick={() => setReportTab(t)}
              className={`flex-1 py-3 font-mono text-xs tracking-widest uppercase transition-colors ${t === "technical" ? "border-l border-neutral-800" : ""} ${reportTab === t ? "bg-neutral-800 text-neutral-200" : "text-neutral-600"}`}>
              {t === "user" ? "Summary" : "Technical"}
            </button>
          ))}
        </div>
        <Card>
          {reportTab === "user" && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[9px] font-mono uppercase text-neutral-700 mb-2">{userFacing.title}</p>
                <Pill label={userFacing.evidenceStrength.replace(/_/g, "-")} />
              </div>
              {[
                { label: "Observation", value: userFacing.observation },
                { label: "Evidence", value: userFacing.evidenceSummary },
                { label: "Primary finding", value: userFacing.primaryFinding },
                ...(userFacing.secondaryFinding ? [{ label: "Contributing factor", value: userFacing.secondaryFinding }] : []),
                { label: "Next step", value: userFacing.nextStep },
                { label: "Maintenance note", value: userFacing.maintenanceTip },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">{label}</p>
                  <p className="text-sm font-mono text-neutral-400 leading-relaxed">{value}</p>
                </div>
              ))}
            </div>
          )}
          {reportTab === "technical" && (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-[9px] font-mono uppercase text-neutral-700 mb-1">{technical.title}</p>
                <p className="text-[10px] font-mono text-neutral-700">{technical.runId}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {[
                  { label: "Complaint", value: technical.complaint },
                  { label: "Role", value: technical.role },
                  { label: "Capability", value: technical.capability },
                  { label: "Evidence state", value: technical.evidenceState },
                  { label: "Primary condition", value: technical.primaryCondition },
                  { label: "Secondary condition", value: technical.secondaryCondition ?? "None" },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">{label}</p>
                    <p className="text-xs font-mono text-neutral-400">{value}</p>
                  </div>
                ))}
              </div>
              {Object.keys(technical.conditionScores).length > 0 && (
                <div>
                  <p className="text-[10px] font-mono uppercase text-neutral-700 mb-2">Condition scores</p>
                  {Object.entries(technical.conditionScores).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between font-mono text-xs mb-1">
                      <span className="text-neutral-600">{k}</span>
                      <span className="text-neutral-700">{v}</span>
                    </div>
                  ))}
                </div>
              )}
              <div>
                <p className="text-[10px] font-mono uppercase text-neutral-700 mb-2">Evidence log</p>
                {technical.evidenceLog.map((ev, i) => (
                  <p key={i} className="text-[11px] font-mono text-neutral-700 mb-1">{ev.tag}: {ev.value}{ev.unit ? ` ${ev.unit}` : ""}</p>
                ))}
              </div>
              <div>
                <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">Determination</p>
                <p className="text-xs font-mono text-neutral-500 leading-relaxed">{technical.determinationSummary}</p>
              </div>
              <div className="border-t border-neutral-800 pt-4">
                <p className="text-[10px] font-mono uppercase text-neutral-700 mb-1">Disclaimer</p>
                <p className="text-[11px] font-mono text-neutral-800 leading-relaxed">{technical.disclaimer}</p>
              </div>
            </div>
          )}
        </Card>
        <div className="mt-3"><PrimaryBtn onClick={reset}>Start new session →</PrimaryBtn></div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Card>
        <p className="font-mono text-sm text-neutral-600">Loading...</p>
      </Card>
    </Shell>
  );
}