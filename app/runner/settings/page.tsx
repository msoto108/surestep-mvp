"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-900 text-white flex flex-col items-center justify-start px-4 py-8">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="border border-zinc-700 bg-zinc-800 px-5 py-6">
      {children}
    </div>
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

export const SETTINGS_KEY = "surestep:settings";

export function loadSettings(): { officeEmail: string; technicianName: string; companyName: string } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { officeEmail: "", technicianName: "", companyName: "" };
    const s = JSON.parse(raw);
    return {
      officeEmail: s.officeEmail ?? "",
      technicianName: s.technicianName ?? "",
      companyName: s.companyName ?? "",
    };
  } catch {
    return { officeEmail: "", technicianName: "", companyName: "" };
  }
}

export function saveSettings(settings: { officeEmail: string; technicianName: string; companyName: string }) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export default function SettingsPage() {
  const router = useRouter();
  const [officeEmail, setOfficeEmail] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const s = loadSettings();
    setOfficeEmail(s.officeEmail);
    setTechnicianName(s.technicianName);
    setCompanyName(s.companyName);
  }, []);

  function handleSave() {
    saveSettings({ officeEmail, technicianName, companyName });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <Shell>
      <Card>
        {/* Header */}
        <div className="flex items-center justify-between mb-6 pb-4 border-b border-zinc-600">
          <div>
            <p className="text-xs font-mono tracking-widest uppercase text-zinc-300">SureStep</p>
            <p className="text-sm font-mono text-zinc-200">Settings</p>
          </div>
        </div>

        <p className="text-xs font-mono uppercase text-zinc-400 mb-6">
          These settings apply to all sessions on this device.
        </p>

        <div className="flex flex-col gap-4 mb-6">
          {/* Technician name */}
          <div>
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
              Technician Name
            </p>
            <input
              type="text"
              value={technicianName}
              onChange={(e) => setTechnicianName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400 placeholder:text-zinc-600"
            />
            <p className="text-xs font-mono text-zinc-500 mt-1">
              Pre-fills the technician name on every new session.
            </p>
          </div>

          {/* Company name */}
          <div>
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
              Company Name
            </p>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Lifetime HVAC Mechanical LLC"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400 placeholder:text-zinc-600"
            />
            <p className="text-xs font-mono text-zinc-500 mt-1">
              Pre-fills the company field on every new session.
            </p>
          </div>

          {/* Office email */}
          <div>
            <p className="text-xs font-mono uppercase text-zinc-400 mb-1">
              Office Email Address *
            </p>
            <input
              type="email"
              value={officeEmail}
              onChange={(e) => setOfficeEmail(e.target.value)}
              placeholder="office@yourcompany.com"
              className="w-full px-4 py-3 bg-zinc-900 border border-zinc-600 text-white font-mono text-sm focus:outline-none focus:border-zinc-400 placeholder:text-zinc-600"
            />
            <p className="text-xs font-mono text-zinc-500 mt-1">
              Office report is sent here via your default mail app after each session.
            </p>
          </div>
        </div>

        <PrimaryBtn
          onClick={handleSave}
          disabled={!officeEmail.trim()}
        >
          {saved ? "Saved ✓" : "Save settings →"}
        </PrimaryBtn>

        <div className="mt-3">
          <GhostBtn onClick={() => router.push("/runner")}>
            Back to runner
          </GhostBtn>
        </div>

        <div className="mt-6 border-t border-zinc-700 pt-4">
          <p className="text-xs font-mono uppercase text-zinc-500 mb-2">About</p>
          <p className="text-xs font-mono text-zinc-500 leading-relaxed">
            Settings are stored locally on this device. No data is sent to any server.
            Clearing your browser data will reset these settings.
          </p>
        </div>
      </Card>
    </Shell>
  );
}
