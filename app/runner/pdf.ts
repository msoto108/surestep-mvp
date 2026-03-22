"use client";

import type { RunReports } from "./types";
import type { JobInfo } from "./types";

export function generatePDF(reports: RunReports, jobInfo: JobInfo | null): void {
  const { technical, userFacing } = reports;

  const equipment = [jobInfo?.equipmentMake, jobInfo?.equipmentModel, jobInfo?.serialNumber]
    .filter(Boolean).join(" · ") || "Not specified";

  const evidenceRows = technical.evidenceLog
    .map((ev) => `<tr><td>${ev.tag}</td><td>${ev.value}${ev.unit ? " " + ev.unit : ""}</td><td>${ev.sourceType}</td></tr>`)
    .join("");

  const conditionRows = Object.entries(technical.conditionScores)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
    .join("");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <title>SureStep Report — ${technical.runId}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: monospace; font-size: 11px; color: #111; padding: 24px; }
        h1 { font-size: 22px; font-weight: bold; margin-bottom: 2px; }
        h2 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em; color: #555; margin-bottom: 16px; }
        h3 { font-size: 9px; text-transform: uppercase; letter-spacing: 0.15em; color: #777; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .meta { display: flex; justify-content: space-between; margin-bottom: 16px; border-bottom: 1px solid #ddd; padding-bottom: 12px; }
        .meta-right { text-align: right; color: #555; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px; }
        .field label { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; margin-bottom: 2px; }
        .field p { font-size: 11px; color: #111; }
        table { width: 100%; border-collapse: collapse; margin-top: 6px; }
        th { font-size: 8px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; text-align: left; padding: 4px 6px; border-bottom: 1px solid #ddd; }
        td { font-size: 10px; padding: 4px 6px; border-bottom: 1px solid #f0f0f0; color: #222; }
        .disclaimer { margin-top: 20px; padding-top: 12px; border-top: 1px solid #ddd; font-size: 9px; color: #888; line-height: 1.6; }
        .next-step { background: #f7f7f7; padding: 10px; margin-top: 6px; font-size: 11px; line-height: 1.6; }
        @media print { body { padding: 0; } }
      </style>
    </head>
    <body>
      <div class="meta">
        <div>
          <h1>SureStep</h1>
          <h2>HVAC Cooling Pack v1.0 — Field Diagnostic Report</h2>
        </div>
        <div class="meta-right">
          <div>${technical.runId}</div>
          <div>${new Date(technical.generatedAt).toLocaleString()}</div>
        </div>
      </div>

      <h3>Job Information</h3>
      <div class="grid">
        <div class="field"><label>Technician</label><p>${jobInfo?.technicianName ?? "—"}</p></div>
        <div class="field"><label>Company</label><p>${jobInfo?.companyName ?? "—"}</p></div>
        <div class="field"><label>Job Site</label><p>${jobInfo?.jobSiteAddress ?? "—"}</p></div>
        <div class="field"><label>Equipment</label><p>${equipment}</p></div>
      </div>

      <h3>Evaluation Summary</h3>
      <div class="grid">
        <div class="field"><label>Complaint</label><p>${technical.complaint}</p></div>
        <div class="field"><label>Evidence Strength</label><p>${userFacing.evidenceStrength.replace(/_/g, "-")}</p></div>
        <div class="field"><label>Primary Condition</label><p>${technical.primaryCondition}</p></div>
        <div class="field"><label>Secondary Condition</label><p>${technical.secondaryCondition ?? "None"}</p></div>
      </div>

      <h3>Next Step</h3>
      <div class="next-step">${userFacing.nextStep}</div>

      <h3>Maintenance Note</h3>
      <div class="next-step">${userFacing.maintenanceTip}</div>

      <h3>Condition Scores</h3>
      <table>
        <tr><th>Condition</th><th>Score</th></tr>
        ${conditionRows}
      </table>

      <h3>Evidence Log</h3>
      <table>
        <tr><th>Tag</th><th>Value</th><th>Source</th></tr>
        ${evidenceRows}
      </table>

      <h3>Determination</h3>
      <p style="line-height:1.6; margin-top:6px;">${technical.determinationSummary}</p>

      <div class="disclaimer">${technical.disclaimer}</div>
    </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => {
    win.print();
  }, 500);
}