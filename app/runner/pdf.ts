"use client";

import type { RunReports, JobInfo } from "./types";

// ─── Helpers ─────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function gateIcon(status: string): string {
  if (status === "PASSED") return "✓";
  if (status === "FAILED") return "✗";
  if (status === "SKIPPED") return "–";
  return "?";
}

function gateColor(status: string): string {
  if (status === "PASSED") return "#166534";
  if (status === "FAILED") return "#991b1b";
  return "#555";
}

// ─── Tech PDF (full SPICED + technical data) ─────────────────

export function generatePDF(reports: RunReports, jobInfo: JobInfo | null): void {
  const { technical, spiced } = reports;

  const equipment =
    [jobInfo?.equipmentMake, jobInfo?.equipmentModel, jobInfo?.serialNumber]
      .filter(Boolean)
      .join(" · ") || "Not specified";

  const evidenceRows = technical.evidenceLog
    .map(
      (ev) =>
        `<tr><td>${escapeHtml(ev.tag)}</td><td>${escapeHtml(ev.value)}${ev.unit ? " " + ev.unit : ""}</td><td>${ev.sourceType}</td></tr>`
    )
    .join("");

  const conditionRows = Object.entries(technical.conditionScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`)
    .join("");

  const citedRows = technical.citedProof
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.finding)}</td><td>${escapeHtml(c.condition)}</td><td>${c.sourceType}</td><td>${c.weight}</td></tr>`
    )
    .join("");

  const gates = technical.gates;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>SureStep Field Report — ${technical.runId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: monospace; font-size: 11px; color: #111; padding: 24px; }
    h1 { font-size: 20px; font-weight: bold; margin-bottom: 2px; }
    h2 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: #555; margin-bottom: 16px; }
    h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: #777; margin: 18px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
    .meta { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
    .meta-right { text-align: right; color: #555; font-size: 10px; }
    .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
    .field label { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 2px; }
    .field p { font-size: 11px; color: #111; line-height: 1.5; }
    .spiced-block { margin-bottom: 10px; }
    .spiced-block .spiced-label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #888; margin-bottom: 3px; }
    .spiced-block .spiced-value { font-size: 11px; color: #111; line-height: 1.6; }
    .condition-primary { font-size: 16px; font-weight: bold; color: #111; margin: 4px 0; }
    .condition-secondary { font-size: 10px; color: #555; }
    .gates { display: flex; gap: 6px; margin: 8px 0; }
    .gate { border: 1px solid #ddd; padding: 6px 10px; text-align: center; min-width: 60px; }
    .gate .gate-icon { font-size: 13px; font-weight: bold; display: block; }
    .gate .gate-label { font-size: 7px; text-transform: uppercase; letter-spacing: 0.1em; color: #777; display: block; margin-top: 2px; }
    .disclaimer-box { margin-top: 6px; padding: 8px; background: #f7f7f7; font-size: 9px; color: #666; line-height: 1.6; border-left: 3px solid #ddd; }
    table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    th { font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
    td { font-size: 10px; padding: 4px 6px; border-bottom: 1px solid #f0f0f0; color: #222; }
    .pill { display: inline-block; border: 1px solid #999; padding: 2px 8px; font-size: 8px; text-transform: uppercase; letter-spacing: 0.12em; color: #444; margin-bottom: 8px; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>

  <div class="meta">
    <div>
      <h1>SureStep</h1>
      <h2>HVAC Cooling Pack v2.0 — Field Diagnostic Report</h2>
    </div>
    <div class="meta-right">
      <div>${escapeHtml(technical.runId)}</div>
      <div>${new Date(technical.generatedAt).toLocaleString()}</div>
    </div>
  </div>

  <h3>Job Information</h3>
  <div class="grid2">
    <div class="field"><label>Technician</label><p>${escapeHtml(jobInfo?.technicianName ?? "—")}</p></div>
    <div class="field"><label>Company</label><p>${escapeHtml(jobInfo?.companyName ?? "—")}</p></div>
    <div class="field"><label>Job Site</label><p>${escapeHtml(jobInfo?.jobSiteAddress ?? "—")}</p></div>
    <div class="field"><label>Equipment</label><p>${escapeHtml(equipment)}</p></div>
    <div class="field"><label>Complaint</label><p>${escapeHtml(technical.complaint)}</p></div>
    <div class="field"><label>Evidence State</label><p>${escapeHtml(spiced.evidenceStrength.replace(/_/g, "-"))}</p></div>
  </div>

  <h3>Diagnostic Gates</h3>
  <div class="gates">
    ${[
      { label: "G1 Power", status: gates.G1_power },
      { label: "G2 Controls", status: gates.G2_controls },
      { label: "G3 Mech", status: gates.G3_mechanical },
      { label: "G4 Thermal", status: gates.G4_thermal },
      { label: "G5 Verify", status: gates.G5_verify },
    ]
      .map(
        (g) =>
          `<div class="gate"><span class="gate-icon" style="color:${gateColor(g.status)}">${gateIcon(g.status)}</span><span class="gate-label">${g.label}</span></div>`
      )
      .join("")}
  </div>

  <h3>SPICED Diagnostic Report</h3>
  <div class="pill">${escapeHtml(spiced.evidenceStrength.replace(/_/g, "-"))}</div>

  <div class="spiced-block">
    <div class="spiced-label">S — Situation</div>
    <div class="spiced-value">${escapeHtml(spiced.situation)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">P — Parameters</div>
    <div class="spiced-value">${escapeHtml(spiced.parameters)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">I — Indications</div>
    <div class="spiced-value">${escapeHtml(spiced.indications)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">C — Condition</div>
    <div class="condition-primary">${escapeHtml(spiced.condition)}</div>
    ${spiced.secondary ? `<div class="condition-secondary">Secondary: ${escapeHtml(spiced.secondary)}</div>` : ""}
  </div>
  <div class="spiced-block">
    <div class="spiced-label">E — Evaluation</div>
    <div class="spiced-value">${escapeHtml(spiced.evaluation)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">Observation</div>
    <div class="spiced-value">${escapeHtml(spiced.observation)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">Proof</div>
    <div class="spiced-value">${escapeHtml(spiced.proof)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">Next Step</div>
    <div class="spiced-value">${escapeHtml(spiced.nextStep)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">Maintenance Tip</div>
    <div class="spiced-value">${escapeHtml(spiced.maintenanceTip)}</div>
  </div>
  <div class="spiced-block">
    <div class="spiced-label">D — Disclaimer</div>
    <div class="disclaimer-box">${escapeHtml(spiced.disclaimer)}</div>
  </div>

  ${
    citedRows
      ? `<h3>Cited Findings</h3>
  <table>
    <tr><th>Finding</th><th>Condition</th><th>Source</th><th>Weight</th></tr>
    ${citedRows}
  </table>`
      : ""
  }

  ${
    conditionRows
      ? `<h3>Condition Scores</h3>
  <table>
    <tr><th>Condition</th><th>Score</th></tr>
    ${conditionRows}
  </table>`
      : ""
  }

  <h3>Evidence Log</h3>
  <table>
    <tr><th>Tag</th><th>Value</th><th>Source</th></tr>
    ${evidenceRows}
  </table>

  <div class="disclaimer-box" style="margin-top:20px;">${escapeHtml(technical.disclaimer)}</div>

</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

// ─── Office Email (mailto — no API, no cost) ─────────────────

export function sendOfficeEmail(
  reports: RunReports,
  jobInfo: JobInfo | null,
  officeEmail: string
): void {
  const subject = `SureStep Report — ${jobInfo?.jobSiteAddress ?? "Job"} — ${reports.technical.runId}`;
  const mailto = `mailto:${encodeURIComponent(officeEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(reports.auditRecord)}`;
  window.location.href = mailto;
}

// ─── Customer Summary (plain text for share / copy) ──────────

export function buildCustomerSummaryText(reports: RunReports): string {
  return reports.customerStory;
}
