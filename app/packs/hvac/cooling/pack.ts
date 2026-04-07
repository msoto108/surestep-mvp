// ============================================================
// Pack: HVAC / Cooling v2
// Built from real field diagnostic process — MyLifetime HVAC
// ============================================================

import type {
  PackDefinition,
  PackStep,
  RunContext,
  ConditionMapFn,
} from "@/app/runner/types";

// ─── Helper ─────────────────────────────────────────────────

function ev(ctx: RunContext, tag: string): string | undefined {
  return ctx.evidence[tag];
}

function capacitorFailed(ctx: RunContext): boolean {
  const reading = ev(ctx, "outdoor.capacitor.reading");
  return (
    reading === "Below spec" ||
    reading === "Open — no reading"
  );
}

// ─── Condition Names ────────────────────────────────────────

const C = {
  ELECTRICAL: "Electrical",
  REFRIGERANT: "Refrigerant System",
  MECHANICAL: "Mechanical",
  AIRFLOW: "Airflow",
  DRAINAGE: "Drainage",
  CONTROLS: "Control System",
  UNKNOWN: "Unknown",
};

// ============================================================
// STEP TREES
// ============================================================

// ─── NO COOLING / NOT KEEPING UP ────────────────────────────
// Real field path:
//   Customer interview → thermostat → filter → blower check
//   Blower running → outdoor unit walk-up → contactor/voltage → capacitor → gauges → delta-T
//   Blower NOT running → LEDs/power → fuse → fault codes

const NO_COOLING_STEPS: PackStep[] = [

  // ── THERMOSTAT ───────────────────────────────────────────

  {
    id: "thermostat_set",
    title: "Set thermostat for diagnosis",
    prompt:
      "Set to COOL, fan AUTO, setpoint below room temp. Listen and wait 30 seconds.",
    capture: {
      tag: "thermostat.response",
      type: "SELECT",
      options: [
        "Blower starts",
        "Nothing responds",
        "Already running",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
  },

  {
    id: "thermostat_display",
    title: "Any fault codes or warnings?",
    prompt: "Check display for error codes, low battery, or blank screen.",
    capture: {
      tag: "thermostat.display",
      type: "SELECT",
      options: [
        "Display normal",
        "Fault code shown",
        "Blank or unresponsive",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "thermostat.response") !== undefined,
  },

  // ── INDOOR UNIT — FILTER & BLOWER ───────────────────────

  {
    id: "airflow_at_filter",
    title: "Airflow at return grille?",
    prompt:
      "Find the main return grille or filter location. Listen and feel for airflow. Hold paper near grille if needed.",
    capture: {
      tag: "airflow.at_filter",
      type: "SELECT",
      options: [
        "Strong and steady",
        "Weak",
        "No airflow",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "thermostat.response") !== undefined,
  },

  {
    id: "filter_condition",
    title: "Filter condition?",
    prompt: "Locate and inspect the filter — return grille, air handler, or filter cabinet.",
    hint: "A collapsed or severely restricted filter can cause low airflow, coil freeze, and compressor issues downstream.",
    capture: {
      tag: "airflow.filter_condition",
      type: "SELECT",
      options: [
        "Clean",
        "Dirty but open",
        "Severely restricted or missing",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "airflow.at_filter") !== undefined,
  },

  {
    id: "condensate_check",
    title: "Drain pan / condensate switch?",
    prompt:
      "Before opening the panel — visually check the primary drain pan and any inline condensate switches.",
    capture: {
      tag: "indoor.condensate",
      type: "SELECT",
      options: [
        "Clear — no water",
        "Water in pan — float tripped",
        "Condensate switch tripped",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "thermostat.response") === "Nothing responds",
  },

  {
    id: "condensate_clear",
    title: "Clear condensate — system restored?",
    prompt:
      "Clear the drain line or reset the float switch. Restore power. Does system respond?",
    capture: {
      tag: "repair.condensate",
      type: "SELECT",
      options: [
        "Yes — system restored",
        "No — drain still blocked",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.condensate") === "Water in pan — float tripped" ||
      ev(ctx, "indoor.condensate") === "Condensate switch tripped",
  },

  // ── BLOWER NOT RUNNING — INDOOR POWER PATH ──────────────

  {
    id: "low_voltage_present",
    title: "Low voltage present at board?",
    prompt:
      "Check for 24V at the control board. Presence confirms transformer and high voltage are good.",
    hint: "Set meter to AC volts. Probe the R and C terminals on the control board — R is 24V hot, C is common. A reading of 24–28V confirms the transformer is working and high voltage is present. No reading means no transformer output — check high voltage next.",
    capture: {
      tag: "indoor.low_voltage",
      type: "SELECT",
      options: [
        "Yes — 24V present",
        "No — 0V",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "thermostat.response") === "Nothing responds",
  },

  {
    id: "high_voltage_present",
    title: "High voltage entering unit?",
    prompt:
      "Check both legs entering the unit at disconnect or service panel. Are both legs present?",
    hint: "SAFETY: High voltage present. Set meter to AC volts, 300V or higher range. Check both legs at the disconnect or line side of the unit. L1 to ground and L2 to ground should each read 120V. L1 to L2 should read 240V. One leg missing means a utility or breaker issue — do not proceed, call electrician.",
    capture: {
      tag: "indoor.high_voltage",
      type: "SELECT",
      options: [
        "Both legs present",
        "One leg missing",
        "No voltage either leg",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "indoor.low_voltage") === "No — 0V",
  },

  {
    id: "electrician_referral",
    title: "Electrician required",
    prompt:
      "One leg missing at the unit — this is a utility or breaker issue outside HVAC scope. Refer to a licensed electrician before any further HVAC diagnosis.",
    capture: {
      tag: "indoor.electrician_referral",
      type: "SELECT",
      options: [
        "Noted — electrician called",
        "Recheck — both legs now present",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.high_voltage") === "One leg missing" ||
      ev(ctx, "indoor.no_power") === "No obvious cause" ||
      ev(ctx, "indoor.no_power_recheck") === "No — still no power",
  },

  {
    id: "no_power_conclusion",
    title: "No power to unit",
    prompt:
      "No voltage on either leg — check the breaker and disconnect. Reset breaker if tripped, close disconnect if open.",
    capture: {
      tag: "indoor.no_power",
      type: "SELECT",
      options: [
        "Breaker tripped — reset",
        "Disconnect open — closed now",
        "No obvious cause",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.high_voltage") === "No voltage either leg",
  },

  {
    id: "no_power_recheck",
    title: "Power restored — system responding?",
    prompt:
      "Reset breaker or close disconnect. Wait 30 seconds. Does system respond to thermostat call?",
    capture: {
      tag: "indoor.no_power_recheck",
      type: "SELECT",
      options: [
        "Yes — system restored",
        "No — still no power",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.no_power") === "Breaker tripped — reset" ||
      ev(ctx, "indoor.no_power") === "Disconnect open — closed now",
  },

  {
    id: "transformer_diagnosis",
    title: "Transformer status?",
    prompt:
      "High voltage present but no low voltage — transformer has failed.",
    hint: "High voltage is confirmed entering the unit but the transformer is not producing 24V output. The transformer has failed. Primary winding receives 240V, secondary winding should output 24V. No output with good input confirms transformer failure.",
    capture: {
      tag: "indoor.transformer",
      type: "SELECT",
      options: [
        "Confirmed — bad transformer",
        "Recheck — low voltage now present",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.high_voltage") === "Both legs present" &&
      ev(ctx, "indoor.low_voltage") === "No — 0V",
  },

  {
    id: "transformer_repair_confirmed",
    title: "Transformer replaced — low voltage restored?",
    prompt:
      "Replace transformer. Restore power. Check for 24V at the control board.",
    capture: {
      tag: "repair.transformer",
      type: "SELECT",
      options: [
        "Yes — 24V confirmed, system running",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.transformer") === "Confirmed — bad transformer",
  },

  {
    id: "indoor_fuse",
    title: "Control fuse condition?",
    prompt: "Locate and check the low-voltage control fuse on the board.",
    hint: "The control fuse is typically a 3A or 5A automotive-style fuse located on the control board. A blown fuse often means a wiring short or failed component caused an overcurrent. Replace the fuse and identify the cause before returning to service — it will blow again if the root cause is not found.",
    capture: {
      tag: "indoor.board.fuse",
      type: "SELECT",
      options: [
        "Fuse good",
        "Fuse blown",
        "No fuse on board",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.low_voltage") === "Yes — 24V present" ||
      ev(ctx, "indoor.transformer") === "Recheck — low voltage now present" ||
      ev(ctx, "indoor.electrician_referral") === "Recheck — both legs now present",
  },

  {
    id: "fuse_root_cause_check",
    title: "Find fuse root cause",
    prompt:
      "Do not replace the fuse yet. With power off, disconnect low voltage wiring and check resistance to ground on each wire.",
    hint: "Set meter to resistance. Check each low voltage wire individually — R, Y, G, C, W. A reading near zero ohms to ground means that wire or the component it connects to is shorted. The contactor coil is a common culprit — disconnect the Y wire at the contactor and recheck.",
    capture: {
      tag: "indoor.fuse_root_cause",
      type: "SELECT",
      options: [
        "Shorted wire found",
        "Contactor coil shorted",
        "No short found — cause unclear",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "indoor.board.fuse") === "Fuse blown",
  },

  {
    id: "fuse_no_cause_found",
    title: "Fuse cause unclear — further diagnosis",
    prompt:
      "No obvious short found. Check transformer secondary output, inspect control board for burn marks, consider intermittent short under load.",
    capture: {
      tag: "indoor.fuse_no_cause",
      type: "SELECT",
      options: [
        "Cause found on further inspection",
        "Unable to determine — recommend control board replacement",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.fuse_root_cause") === "No short found — cause unclear",
  },

  {
    id: "fuse_unknown_conclusion",
    title: "Fuse cause unknown — recommend board replacement",
    prompt:
      "Unable to identify short. Replace control board and recheck.",
    capture: {
      tag: "repair.fuse_unknown",
      type: "SELECT",
      options: [
        "Board replaced — system restored",
        "Issue persists",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.fuse_no_cause") === "Unable to determine — recommend control board replacement",
  },

  {
    id: "fuse_repair_ready",
    title: "Root cause resolved?",
    prompt: "Root cause identified and repaired. Replace the fuse and restore power.",
    capture: {
      tag: "indoor.fuse_repair",
      type: "SELECT",
      options: [
        "Fuse replaced — system restored",
        "Further diagnosis needed",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.fuse_root_cause") === "Shorted wire found" ||
      ev(ctx, "indoor.fuse_root_cause") === "Contactor coil shorted" ||
      ev(ctx, "indoor.fuse_no_cause") === "Cause found on further inspection",
  },

  {
    id: "thermostat_bypass",
    title: "Bypass thermostat — does system respond?",
    prompt: "Jump R to Y and R to G at the board. Does the system start?",
    hint: "Jump R to Y at the control board to call for cooling. Jump R to G to call for the blower. Use a short piece of thermostat wire or a jumper. This removes the thermostat from the circuit entirely. If the system responds to the jumper but not the thermostat, the thermostat has failed.",
    capture: {
      tag: "indoor.thermostat_bypass",
      type: "SELECT",
      options: [
        "Yes — compressor and blower motor start",
        "Compressor only",
        "No compressor response",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.board.fuse") === "Fuse good" ||
      ev(ctx, "indoor.board.fuse") === "No fuse on board",
  },

  {
    id: "blower_relay",
    title: "Blower relay functional?",
    prompt:
      "Compressor cycles but no blower. Check blower relay — is it energizing?",
    hint: "The blower relay is typically located on the control board. It receives a signal from the board and closes to send power to the blower motor. Listen for a click when the board is energized. No click means the relay is not energizing — this points to a bad control board.",
    capture: {
      tag: "indoor.blower_relay",
      type: "SELECT",
      options: [
        "Relay good",
        "Relay bad — no click or response",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.thermostat_bypass") === "Compressor only",
  },

  {
    id: "blower_capacitor",
    title: "Blower capacitor reading?",
    prompt: "Measure blower capacitor with meter. Compare to rated value on label.",
    hint: "The blower capacitor is usually a small oval or round capacitor near the blower motor. Set meter to capacitance mode (µF). Discharge the capacitor first by shorting the terminals with an insulated screwdriver. Compare the reading to the rated value on the label — more than 6% below rated is a failed capacitor.",
    capture: {
      tag: "indoor.blower_capacitor",
      type: "SELECT",
      options: [
        "Within spec",
        "Low or open",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "indoor.blower_relay") === "Relay good",
  },

  {
    id: "blower_capacitor_repair",
    title: "Blower capacitor replaced — blower running?",
    prompt: "Replace blower capacitor. Restore power. Is blower motor running?",
    capture: {
      tag: "repair.blower_capacitor",
      type: "SELECT",
      options: [
        "Yes — blower running",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.blower_capacitor") === "Low or open",
  },

  {
    id: "blower_motor_conclusion",
    title: "Blower motor — confirmed failed?",
    prompt:
      "Relay good, capacitor good, blower not running — blower motor has failed.",
    capture: {
      tag: "indoor.blower.motor.conclusion",
      type: "SELECT",
      options: [
        "Confirmed bad blower motor",
        "Blower now running — recheck",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.blower_relay") === "Relay good" &&
      ev(ctx, "indoor.blower_capacitor") === "Within spec",
  },

  {
    id: "blower_motor_repair_confirmed",
    title: "Blower motor replaced — airflow restored?",
    prompt:
      "Replace blower motor. Restore power. Is blower running and airflow confirmed at return grille?",
    capture: {
      tag: "repair.blower_motor",
      type: "SELECT",
      options: [
        "Yes — airflow confirmed",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.blower.motor.conclusion") === "Confirmed bad blower motor",
  },

  {
    id: "control_board_conclusion",
    title: "Control board — confirmed failed?",
    prompt:
      "Fuse good, thermostat bypass tested, blower relay not energizing — control board has failed.",
    capture: {
      tag: "indoor.control_board.conclusion",
      type: "SELECT",
      options: [
        "Confirmed bad control board",
        "Recheck — relay now responding",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.blower_relay") === "Relay bad — no click or response",
  },

  {
    id: "control_board_repair_confirmed",
    title: "Control board replaced — system restored?",
    prompt:
      "Replace control board. Restore power. Does system respond to thermostat call?",
    capture: {
      tag: "repair.control_board",
      type: "SELECT",
      options: [
        "Yes — system restored",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.control_board.conclusion") === "Confirmed bad control board",
  },

  {
    id: "bad_thermostat_conclusion",
    title: "Thermostat — confirmed failed?",
    prompt:
      "System started when thermostat was bypassed — thermostat has failed.",
    capture: {
      tag: "indoor.thermostat.conclusion",
      type: "SELECT",
      options: [
        "Confirmed bad thermostat",
        "Recheck — system now responding",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.thermostat_bypass") === "Yes — compressor and blower motor start",
  },

  {
    id: "thermostat_repair_confirmed",
    title: "Thermostat replaced — system restored?",
    prompt:
      "Replace thermostat. Set to COOL, fan AUTO, setpoint below room temp. Does system respond normally?",
    capture: {
      tag: "repair.thermostat",
      type: "SELECT",
      options: [
        "Yes — cooling confirmed",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.thermostat.conclusion") === "Confirmed bad thermostat",
  },

  // ── BLOWER RUNNING — OUTDOOR UNIT PATH ──────────────────

  // ── OUTDOOR UNIT WALK-UP ─────────────────────────────────

  {
    id: "outdoor_fan_running",
    title: "Outdoor condenser fan running?",
    prompt:
      "Walk up to the outdoor unit. Is the condenser fan spinning?",
    capture: {
      tag: "outdoor.fan.running",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      (ev(ctx, "thermostat.response") === "Blower starts" ||
        ev(ctx, "thermostat.response") === "Already running" ||
        ev(ctx, "indoor.thermostat_bypass") === "No compressor response") &&
      ev(ctx, "airflow.at_filter") !== undefined,
  },

  {
    id: "compressor_sound",
    title: "Compressor — audible?",
    prompt:
      "Listen at the outdoor unit before opening the panel. What do you hear from the compressor?",
    hint: "A running compressor produces a steady low hum or vibration. Humming without starting = locked rotor or capacitor issue. Silence = no attempt to start.",
    capture: {
      tag: "outdoor.compressor.sound",
      type: "SELECT",
      options: [
        "Running — steady hum / vibration",
        "Attempting but not starting",
        "Silent — no attempt",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.fan.running") !== undefined,
  },

  // ── SERVICE PANEL — CONTACTOR ────────────────────────────
  // Skip contactor visual if compressor is already confirmed running —
  // a running compressor proves the contactor is pulled and both legs are present.

  {
    id: "contactor_visual",
    title: "Contactor — visually pulled in?",
    prompt:
      "Open the service panel. Look at the contactor — is it pulled in (energized)?",
    hint: "The contactor is a heavy-duty relay that connects high voltage to the compressor and condenser fan motor. When energized it pulls in — the movable contacts close against the fixed contacts. Look at the face of the contactor — if pulled in you will see the plunger pushed down and the contacts touching. If not pulled in the plunger is up and contacts are open.",
    capture: {
      tag: "outdoor.contactor.pulled",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => {
      const sound = ev(ctx, "outdoor.compressor.sound");
      // Compressor running normally proves contactor is pulled — skip
      if (sound === "Running — steady hum / vibration") return false;
      return ev(ctx, "outdoor.compressor.sound") !== undefined;
    },
  },

  // 24V check — only needed if contactor is NOT pulled.
  // Fan running proves signal is present on at least one leg,
  // so if fan is spinning we skip 24V regardless.
  {
    id: "low_voltage_at_contactor",
    title: "24V at contactor coil terminals?",
    prompt:
      "Set meter to AC volts. Measure across the contactor coil terminals (low-voltage side). Is 24V present?",
    hint: "Set meter to AC volts. Probe the two small terminals on the contactor coil — these are the low voltage terminals, usually labeled A1 and A2. A reading of 24–28V means the thermostat is calling and the signal is reaching the contactor. No voltage means the signal is not getting through — check thermostat, wiring, and control board.",
    capture: {
      tag: "outdoor.contactor.low_voltage",
      type: "SELECT",
      options: [
        "24V present",
        "No voltage",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      // Only check 24V if contactor is not pulled
      if (ev(ctx, "outdoor.contactor.pulled") !== "No") return false;
      // Fan running proves signal present — skip 24V
      if (ev(ctx, "outdoor.fan.running") === "Yes") return false;
      return true;
    },
  },

  {
    id: "contactor_conclusion",
    title: "Contactor diagnosis?",
    prompt:
      "24V present at coil but contactor not pulled in — contactor has failed.",
    capture: {
      tag: "outdoor.contactor.conclusion",
      type: "SELECT",
      options: [
        "Confirmed bad contactor",
        "Recheck — contactor now pulled",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.low_voltage") === "24V present" &&
      ev(ctx, "outdoor.contactor.pulled") === "No",
  },

  {
    id: "contactor_repair_confirmed",
    title: "Contactor replaced — system restored?",
    prompt:
      "Replace contactor. Restore power. Is system responding to thermostat call?",
    capture: {
      tag: "repair.contactor",
      type: "SELECT",
      options: [
        "Yes — system restored",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.contactor.conclusion") === "Confirmed bad contactor",
  },

  {
    id: "controls_conclusion",
    title: "Controls issue — no 24V signal",
    prompt:
      "No 24V at contactor coil — thermostat or control board not sending signal to outdoor unit.",
    capture: {
      tag: "outdoor.controls.conclusion",
      type: "SELECT",
      options: [
        "Confirmed — no signal from controls",
        "Recheck — voltage now present",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.low_voltage") === "No voltage" &&
      ev(ctx, "outdoor.contactor.pulled") === "No",
  },

  {
    id: "controls_repair_confirmed",
    title: "Controls repaired — signal restored?",
    prompt:
      "Repair or replace thermostat or control board as indicated. Verify 24V signal at contactor coil.",
    capture: {
      tag: "repair.controls",
      type: "SELECT",
      options: [
        "Yes — 24V confirmed, system running",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.controls.conclusion") === "Confirmed — no signal from controls",
  },

  // High voltage LINE side — check both legs individually.
  // Skip entirely if compressor is running (both legs proven present).
  // If one leg missing → electrician call, flag immediately.
  {
    id: "high_voltage_line_in",
    title: "High voltage — line side of contactor?",
    prompt:
      "Measure L1 and L2 on the LINE side (incoming) of the contactor. Record both legs individually.",
    hint: "SAFETY: Confirm disconnect is closed before measuring. Set meter to AC volts, 300V or higher range. Measure L1 to L2 on the line side of the contactor — should read 208–240V. Then measure each leg to ground — should read 120V each. One leg low or missing means a utility or breaker issue. Stop and call a licensed electrician — do not proceed.",
    capture: {
      tag: "outdoor.contactor.hv_line_in",
      type: "SELECT",
      options: [
        "Both legs normal — 208–240V",
        "One leg missing",
        "Low or no voltage",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      const sound = ev(ctx, "outdoor.compressor.sound");
      // Compressor running proves both legs present — skip
      if (sound === "Running — steady hum / vibration") return false;
      // Only check if contactor is pulled or 24V confirmed
      return (
        ev(ctx, "outdoor.contactor.pulled") === "Yes" ||
        ev(ctx, "outdoor.contactor.pulled") === "Unable to determine" ||
        ev(ctx, "outdoor.contactor.low_voltage") === "24V present"
      );
    },
  },

  {
    id: "outdoor_electrician_referral",
    title: "Electrician required — outdoor",
    prompt:
      "One leg missing at the outdoor unit line side. This is a utility or breaker issue. Refer to a licensed electrician.",
    capture: {
      tag: "outdoor.electrician_referral",
      type: "SELECT",
      options: [
        "Electrician called — noted",
        "Recheck — both legs now present",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.hv_line_in") === "One leg missing" ||
      ev(ctx, "outdoor.contactor.hv_line_in") === "Low or no voltage",
  },

  // High voltage LOAD side — skip if compressor running (proven passing through).
  // Also skip if one leg is missing at line side — that's an electrician issue,
  // no point checking load side.
  {
    id: "high_voltage_load_out",
    title: "High voltage — load side of contactor?",
    prompt:
      "Measure T1 and T2 on the LOAD side (outgoing) of the contactor. Are both legs passing through?",
    hint: "Measure T1 to T2 on the load side of the contactor — the side feeding the compressor and fan motor. Should match line side voltage. If line side is good but load side is low or missing, the contactor contacts are burned or not making — replace the contactor.",
    capture: {
      tag: "outdoor.contactor.hv_load_out",
      type: "SELECT",
      options: [
        "Both legs passing",
        "One or both legs absent",
        "Significant voltage drop",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      const sound = ev(ctx, "outdoor.compressor.sound");
      // Compressor running proves load side is good — skip
      if (sound === "Running — steady hum / vibration") return false;
      const lineIn = ev(ctx, "outdoor.contactor.hv_line_in");
      // One leg missing or no voltage = electrician issue — stop here unless resolved
      if (lineIn === "One leg missing" || lineIn === "Low or no voltage") {
        return ev(ctx, "outdoor.electrician_referral") === "Recheck — both legs now present";
      }
      return lineIn !== undefined;
    },
  },

  {
    id: "outdoor_contactor_load_conclusion",
    title: "Contactor contacts failed",
    prompt:
      "Line voltage present but not passing through load side — contactor contacts are burned or not making. Replace contactor.",
    capture: {
      tag: "repair.outdoor_contactor_load",
      type: "SELECT",
      options: [
        "Contactor replaced — system restored",
        "Issue persists",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.hv_load_out") === "One or both legs absent" ||
      ev(ctx, "outdoor.contactor.hv_load_out") === "Significant voltage drop",
  },

  {
    id: "safety_switches",
    title: "Safety switches — any tripped?",
    prompt:
      "High and low voltage confirmed passing through but compressor not running. Check high pressure switch, low pressure switch, and any other safeties.",
    capture: {
      tag: "outdoor.safety_switches",
      type: "SELECT",
      options: [
        "All switches closed — none tripped",
        "Pressure switch tripped",
        "Other switch tripped",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.hv_load_out") === "Both legs passing" &&
      ev(ctx, "outdoor.compressor.sound") !== "Running — steady hum / vibration",
  },

  {
    id: "safety_switch_reset",
    title: "Reset safety switch — system restart?",
    prompt:
      "Identify which switch tripped and why. Manually reset the switch. Does system restart?",
    hint: "A high pressure switch tripping indicates overcharge, dirty condenser coil, or blocked airflow. A low pressure switch tripping indicates low refrigerant charge or a restriction. Do not repeatedly reset — find the cause first.",
    capture: {
      tag: "outdoor.safety_switch_reset",
      type: "SELECT",
      options: [
        "Yes — system running",
        "No — switch trips again immediately",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.safety_switches") === "Pressure switch tripped" ||
      ev(ctx, "outdoor.safety_switches") === "Other switch tripped",
  },

  {
    id: "safety_switch_diagnosis",
    title: "Switch trips immediately — pressure issue",
    prompt:
      "Safety switch trips on restart. Do not continue to reset. Check refrigerant pressures to identify cause — high pressure indicates blocked coil or overcharge, low pressure indicates low charge or restriction.",
    capture: {
      tag: "outdoor.safety_switch_diagnosis",
      type: "SELECT",
      options: [
        "High pressure confirmed — check condenser coil",
        "Low pressure confirmed — check charge",
        "Unable to check pressures now",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.safety_switch_reset") === "No — switch trips again immediately",
  },

  // ── CAPACITOR ────────────────────────────────────────────
  // Skip both capacitor steps if fan AND compressor are both running normally.
  // Both motors running proves the capacitor is functional.
  // If fan running but compressor not starting — keep capacitor (most likely cause).

  {
    id: "capacitor_visual",
    title: "Capacitor — visual inspection",
    prompt:
      "Inspect the capacitor(s). Look for bulging top, oil leaking from bottom, or burn marks.",
    hint: "Look at the top of the capacitor — it should be flat. A bulging or domed top means internal pressure has built up from a failed capacitor. Check the base for oil residue which indicates the capacitor has leaked. Look for burn marks or discoloration on the terminals or body. Any of these is a confirmed failure.",
    capture: {
      tag: "outdoor.capacitor.visual",
      type: "SELECT",
      options: [
        "Normal — no visible damage",
        "Obvious failure — bulging or oil",
        "Burn marks or discoloration",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.contactor.pulled") !== undefined ||
      ev(ctx, "outdoor.compressor.sound") === "Running — steady hum / vibration",
  },

  {
    id: "capacitor_reading",
    title: "Capacitor — measured value?",
    prompt:
      "Discharge and measure the capacitor with a meter capable of capacitance (µF). Compare to rated value on label.",
    hint: "Set meter to capacitance mode (µF). Discharge the capacitor first — shut off power and short the terminals with an insulated screwdriver. Most outdoor units use a dual run capacitor with two values on the label, for example 45/5 µF. Measure each section separately. A reading more than 6% below the rated value is a failed capacitor.",
    capture: {
      tag: "outdoor.capacitor.reading",
      type: "SELECT",
      options: [
        "Within spec",
        "Below spec",
        "Open — no reading",
      ],
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      return ev(ctx, "outdoor.capacitor.visual") !== undefined;
    },
  },

  {
    id: "outdoor_capacitor_repair",
    title: "Capacitor replaced — system restored?",
    prompt:
      "Replace run capacitor. Restore power. Are fan and compressor running normally?",
    capture: {
      tag: "repair.outdoor_capacitor",
      type: "SELECT",
      options: [
        "Yes — both running",
        "No — still not starting",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.capacitor.reading") === "Below spec" ||
      ev(ctx, "outdoor.capacitor.reading") === "Open — no reading",
  },

  {
    id: "fan_motor_diagnosis",
    title: "Condenser fan motor — spins freely?",
    prompt:
      "Capacitor good but fan not spinning. Shut down power. Try spinning fan blade by hand.",
    capture: {
      tag: "outdoor.fan.motor",
      type: "SELECT",
      options: [
        "Spins freely — bad motor",
        "Hard to spin — seized motor",
        "Fan was spinning",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.capacitor.reading") === "Within spec" &&
      ev(ctx, "outdoor.fan.running") === "No",
  },

  {
    id: "fan_motor_conclusion",
    title: "Fan motor — confirmed failed?",
    prompt:
      "Capacitor good, motor not running, spins freely or seized — fan motor has failed.",
    capture: {
      tag: "outdoor.fan.motor.conclusion",
      type: "SELECT",
      options: [
        "Confirmed bad fan motor",
        "Fan now running — recheck",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.fan.motor") === "Spins freely — bad motor" ||
      ev(ctx, "outdoor.fan.motor") === "Hard to spin — seized motor",
  },

  {
    id: "fan_motor_repair_confirmed",
    title: "Condenser fan motor replaced — fan running?",
    prompt:
      "Replace condenser fan motor. Restore power. Is condenser fan spinning normally?",
    capture: {
      tag: "repair.fan_motor",
      type: "SELECT",
      options: [
        "Yes — fan running",
        "No — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.fan.motor.conclusion") === "Confirmed bad fan motor",
  },

  {
    id: "compressor_diagnostics",
    title: "Compressor — starts with start assist?",
    prompt:
      "Capacitor good, motors good. Try hard start kit or soft start. Does compressor start?",
    capture: {
      tag: "outdoor.compressor.start_assist",
      type: "SELECT",
      options: [
        "Starts with assist — recommend hard start",
        "Still won't start — further diagnosis needed",
        "Not applicable — compressor running",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.capacitor.reading") === "Within spec" &&
      ev(ctx, "outdoor.compressor.sound") !== "Running — steady hum / vibration",
  },

  {
    id: "hard_start_installed",
    title: "Hard start kit installed — system verified?",
    prompt:
      "Install hard start kit. Verify compressor starts reliably on 3 consecutive cycles.",
    capture: {
      tag: "repair.hard_start",
      type: "SELECT",
      options: [
        "Starts reliably — hard start resolved issue",
        "Intermittent — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.compressor.start_assist") === "Starts with assist — recommend hard start",
  },

  {
    id: "compressor_ohms",
    title: "Compressor windings — resistance check?",
    prompt:
      "Measure resistance across compressor terminals C-S, C-R, S-R. Any open or shorted windings?",
    capture: {
      tag: "outdoor.compressor.windings",
      type: "SELECT",
      options: [
        "All windings normal",
        "Open winding",
        "Shorted or grounded",
      ],
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) =>
      ev(ctx, "outdoor.compressor.start_assist") === "Still won't start — further diagnosis needed",
  },

  {
    id: "compressor_locked_rotor",
    title: "Compressor — locked rotor or thermal overload?",
    prompt:
      "Windings check out but compressor won't start. Allow 2 hours for thermal overload to reset. Retry.",
    capture: {
      tag: "outdoor.compressor.locked_rotor",
      type: "SELECT",
      options: [
        "Started after reset — thermal overload",
        "Still won't start — locked rotor likely",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.compressor.windings") === "All windings normal",
  },

  {
    id: "compressor_failure_confirmed",
    title: "Compressor — confirmed failed?",
    prompt:
      "Open or shorted windings confirm compressor failure. System will not operate until compressor is replaced.",
    capture: {
      tag: "outdoor.compressor.failed",
      type: "SELECT",
      options: [
        "Confirmed — bad compressor",
        "Windings normal — recheck",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.compressor.windings") === "Open winding" ||
      ev(ctx, "outdoor.compressor.windings") === "Shorted or grounded",
  },

  {
    id: "compressor_authorization",
    title: "Compressor replacement — authorization needed",
    prompt:
      "Compressor replacement is a major repair. Quote the job and obtain customer authorization before proceeding.",
    hint: "Compressor replacement typically includes: new compressor, new run capacitor, new contactor, filter drier, leak check, vacuum, and recharge. Always quote as a complete system restoration not just the compressor alone.",
    capture: {
      tag: "repair.compressor.authorization",
      type: "SELECT",
      options: [
        "Authorization obtained — proceeding",
        "Authorization declined — system down",
        "Quote pending — follow up needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "outdoor.compressor.failed") === "Confirmed — bad compressor" ||
      ev(ctx, "outdoor.compressor.locked_rotor") === "Still won't start — locked rotor likely",
  },

  {
    id: "compressor_replacement_verified",
    title: "Compressor replaced — system verified?",
    prompt:
      "Compressor replacement complete. Run system for 15 minutes. Verify pressures, delta-T, and no unusual sounds.",
    capture: {
      tag: "repair.compressor_replacement",
      type: "SELECT",
      options: [
        "System verified — cooling confirmed",
        "Issue persists — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "repair.compressor.authorization") === "Authorization obtained — proceeding",
  },

  // ── REFRIGERANT PRESSURES ────────────────────────────────

  {
    id: "suction_pressure",
    title: "Suction pressure (low side)?",
    prompt:
      "Connect gauges. Record suction pressure after system has run at least 5 minutes.",
    hint: "Connect gauges to the service valves — low side (suction) is the larger valve, usually blue hose. Let the system run at least 5 minutes before recording. Typical R-410A suction pressure at 75°F ambient is 100–130 PSI. Low suction indicates low charge or restriction. High suction indicates overcharge or compressor issue. Always refer to the manufacturer data plate, charging chart, or service manual for equipment-specific target values.",
    capture: {
      tag: "refrigerant.suction_psi",
      type: "NUMBER",
      unit: "PSI",
      placeholder: "e.g. 115",
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      if (capacitorFailed(ctx)) return false;
      if (ev(ctx, "outdoor.compressor.sound") !== "Running — steady hum / vibration") return false;
      return ev(ctx, "outdoor.capacitor.visual") !== undefined;
    },
  },

  {
    id: "liquid_pressure",
    title: "Liquid pressure (high side)?",
    prompt: "Record high-side (liquid line) pressure.",
    hint: "The high side (liquid line) service valve is the smaller valve, usually red hose. Record after system has run at least 5 minutes. Typical R-410A high side at 75°F ambient is 250–350 PSI. High head pressure indicates dirty condenser coil, overcharge, or restricted airflow across condenser. Low head pressure with low suction indicates low charge or leak. Always refer to the manufacturer data plate, charging chart, or service manual for equipment-specific target values.",
    capture: {
      tag: "refrigerant.liquid_psi",
      type: "NUMBER",
      unit: "PSI",
      placeholder: "e.g. 275",
      required: true,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      if (capacitorFailed(ctx)) return false;
      return ev(ctx, "refrigerant.suction_psi") !== undefined;
    },
  },

  {
    id: "pressure_diagnosis",
    title: "Pressure reading interpretation?",
    prompt:
      "Based on suction and head pressure readings — what does the pattern indicate?",
    hint: "Compare both readings together — the pattern tells the story. Low suction with normal head means refrigerant is restricted before the compressor — check metering device or look for ice on the suction line. High head with normal suction means heat is not being rejected — check condenser coil cleanliness and airflow. Both readings near zero means the system has lost its charge — search for a leak. Always refer to the manufacturer data plate, charging chart, or service manual for equipment-specific target values.",
    capture: {
      tag: "refrigerant.pressure_pattern",
      type: "SELECT",
      options: [
        "Both pressures normal",
        "Suction low (restriction or leak)",
        "Head pressure high (overcharge or blockage)",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "refrigerant.liquid_psi") !== undefined,
  },

  {
    id: "pressure_action",
    title: "Pressure finding — action required?",
    prompt:
      "Based on pressure pattern — what action is needed?",
    capture: {
      tag: "refrigerant.pressure_action",
      type: "SELECT",
      options: [
        "Check for restriction — metering device or line",
        "Leak search required",
        "Check condenser coil and charge",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => {
      const pattern = ev(ctx, "refrigerant.pressure_pattern");
      return pattern !== undefined && pattern !== "Both pressures normal";
    },
  },

  {
    id: "superheat_or_subcooling",
    title: "Superheat / subcooling — if conditions allow?",
    prompt:
      "If time and conditions allow, calculate superheat (TXV systems: target 10–15°F) or subcooling (fixed orifice: target 10–18°F).",
    hint: "Superheat is measured at the suction line near the outdoor unit — suction line temperature minus suction saturation temperature. TXV systems target 10–15°F superheat. Fixed orifice systems target 25–35°F. Subcooling is measured at the liquid line — liquid saturation temperature minus liquid line temperature. Target 10–18°F subcooling. These values confirm correct charge level and metering device operation. Always refer to the manufacturer data plate, charging chart, or service manual for equipment-specific target values.",
    capture: {
      tag: "refrigerant.superheat_subcooling",
      type: "SELECT",
      options: [
        "Both in range",
        "One or more readings high",
        "One or more readings low",
      ],
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      if (capacitorFailed(ctx)) return false;
      return ev(ctx, "refrigerant.liquid_psi") !== undefined;
    },
  },

  // ── DELTA-T ──────────────────────────────────────────────

  {
    id: "supply_temp",
    title: "Supply air temperature?",
    prompt: "Measure air temperature at the nearest supply register.",
    capture: {
      tag: "airflow.supply_temp_f",
      type: "NUMBER",
      unit: "°F",
      placeholder: "e.g. 57",
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => {
      if (capacitorFailed(ctx)) return false;
      if (ev(ctx, "outdoor.compressor.sound") !== "Running — steady hum / vibration") return false;
      return ev(ctx, "outdoor.capacitor.visual") !== undefined;
    },
  },

  {
    id: "return_temp",
    title: "Return air temperature?",
    prompt: "Measure air temperature at the return grille or filter slot.",
    hint: "Delta-T (return minus supply) should be 16–22°F for a properly operating system.",
    capture: {
      tag: "airflow.return_temp_f",
      type: "NUMBER",
      unit: "°F",
      placeholder: "e.g. 76",
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "airflow.supply_temp_f") !== undefined,
  },

  {
    id: "repair_followup",
    title: "Follow up required",
    prompt:
      "Repair did not resolve the issue. Document the situation and schedule follow up.",
    capture: {
      tag: "repair.followup",
      type: "SELECT",
      options: [
        "Follow up scheduled",
        "Quote pending — authorization needed",
        "Referred to specialist",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "repair.transformer") === "No — further diagnosis needed" ||
      ev(ctx, "repair.blower_motor") === "No — further diagnosis needed" ||
      ev(ctx, "repair.control_board") === "No — further diagnosis needed" ||
      ev(ctx, "repair.thermostat") === "No — further diagnosis needed" ||
      ev(ctx, "repair.contactor") === "No — further diagnosis needed" ||
      ev(ctx, "repair.controls") === "No — further diagnosis needed" ||
      ev(ctx, "repair.fan_motor") === "No — further diagnosis needed" ||
      ev(ctx, "indoor.fuse_repair") === "Further diagnosis needed" ||
      ev(ctx, "repair.blower_capacitor") === "No — further diagnosis needed" ||
      ev(ctx, "repair.outdoor_capacitor") === "No — still not starting" ||
      ev(ctx, "repair.outdoor_contactor_load") === "Issue persists" ||
      ev(ctx, "repair.hard_start") === "Intermittent — further diagnosis needed" ||
      ev(ctx, "repair.condensate") === "No — drain still blocked" ||
      ev(ctx, "repair.fuse_unknown") === "Issue persists" ||
      ev(ctx, "repair.verified") === "Issue persists — further diagnosis needed" ||
      ev(ctx, "indoor.electrician_referral") === "Noted — electrician called" ||
      ev(ctx, "outdoor.electrician_referral") === "Electrician called — noted" ||
      ev(ctx, "outdoor.safety_switch_diagnosis") === "High pressure confirmed — check condenser coil" ||
      ev(ctx, "outdoor.safety_switch_diagnosis") === "Low pressure confirmed — check charge" ||
      ev(ctx, "outdoor.safety_switch_diagnosis") === "Unable to check pressures now" ||
      ev(ctx, "outdoor.compressor.locked_rotor") === "Still won't start — locked rotor likely" ||
      ev(ctx, "repair.compressor.authorization") === "Authorization declined — system down" ||
      ev(ctx, "repair.compressor.authorization") === "Quote pending — follow up needed" ||
      ev(ctx, "refrigerant.pressure_action") === "Check for restriction — metering device or line" ||
      ev(ctx, "refrigerant.pressure_action") === "Leak search required" ||
      ev(ctx, "refrigerant.pressure_action") === "Check condenser coil and charge" ||
      ev(ctx, "repair.compressor_replacement") === "Issue persists — further diagnosis needed",
  },

  {
    id: "system_verified",
    title: "System operation verified?",
    prompt:
      "Repair complete. Verify system is operating normally — cooling confirmed, no unusual sounds, pressures normal if gauges were used.",
    capture: {
      tag: "repair.verified",
      type: "SELECT",
      options: [
        "System verified — operating normally",
        "Issue persists — further diagnosis needed",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      (ev(ctx, "repair.transformer") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.blower_motor") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.control_board") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.thermostat") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.contactor") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.controls") ?? "").startsWith("Yes") ||
      (ev(ctx, "repair.fan_motor") ?? "").startsWith("Yes") ||
      ev(ctx, "indoor.fuse_repair") === "Fuse replaced — system restored" ||
      ev(ctx, "repair.blower_capacitor") === "Yes — blower running" ||
      ev(ctx, "repair.outdoor_capacitor") === "Yes — both running" ||
      ev(ctx, "repair.outdoor_contactor_load") === "Contactor replaced — system restored" ||
      ev(ctx, "repair.hard_start") === "Starts reliably — hard start resolved issue" ||
      ev(ctx, "repair.condensate") === "Yes — system restored" ||
      ev(ctx, "repair.fuse_unknown") === "Board replaced — system restored" ||
      ev(ctx, "outdoor.safety_switch_reset") === "Yes — system running" ||
      ev(ctx, "indoor.blower.motor.conclusion") === "Blower now running — recheck" ||
      ev(ctx, "indoor.control_board.conclusion") === "Recheck — relay now responding" ||
      ev(ctx, "indoor.thermostat.conclusion") === "Recheck — system now responding" ||
      ev(ctx, "outdoor.contactor.conclusion") === "Recheck — contactor now pulled" ||
      ev(ctx, "outdoor.controls.conclusion") === "Recheck — voltage now present" ||
      ev(ctx, "outdoor.fan.motor") === "Fan was spinning" ||
      ev(ctx, "outdoor.fan.motor.conclusion") === "Fan now running — recheck" ||
      ev(ctx, "outdoor.compressor.failed") === "Windings normal — recheck" ||
      ev(ctx, "indoor.no_power_recheck") === "Yes — system restored" ||
      ev(ctx, "outdoor.compressor.start_assist") === "Not applicable — compressor running" ||
      ev(ctx, "outdoor.compressor.locked_rotor") === "Started after reset — thermal overload" ||
      ev(ctx, "repair.compressor_replacement") === "System verified — cooling confirmed",
  },
];

// ─── WATER LEAK / FLOAT TRIP ─────────────────────────────────

const WATER_FLOAT_STEPS: PackStep[] = [
  {
    id: "float_tripped",
    title: "Float switch tripped?",
    prompt:
      "Check the secondary drain pan float switch — is it in the tripped (open) position?",
    capture: {
      tag: "drainage.float_switch.tripped",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
  },
  {
    id: "pan_water_level",
    title: "Standing water in secondary pan?",
    prompt: "How much water is in the secondary drain pan?",
    capture: {
      tag: "drainage.secondary_pan.water_level",
      type: "SELECT",
      options: [
        "Overflowing",
        "High — near float switch",
        "Low or dry",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "drainage.float_switch.tripped") === "Yes",
  },
  {
    id: "primary_drain_flow",
    title: "Primary drain flowing?",
    prompt:
      "Pour one cup of water into the primary condensate drain pan. Observe drain flow.",
    capture: {
      tag: "drainage.primary_drain.flow",
      type: "SELECT",
      options: [
        "Flows freely",
        "Slow or restricted",
        "Does not drain",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "drainage.float_switch.tripped") === "Yes",
  },
  {
    id: "coil_iced",
    title: "Evaporator coil iced over?",
    prompt:
      "Inspect the evaporator coil — is there ice present on the coil or suction line?",
    hint: "Ice-over is often caused by low airflow (dirty filter) or low refrigerant charge. The system must be defrosted before accurate refrigerant readings can be taken.",
    capture: {
      tag: "indoor.coil.iced",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "drainage.primary_drain.flow") !== undefined,
  },
];

// ─── BREAKER TRIPPING ────────────────────────────────────────

const BREAKER_TRIPS_STEPS: PackStep[] = [
  {
    id: "which_breaker",
    title: "Which circuit trips?",
    prompt: "Identify which breaker is tripping.",
    capture: {
      tag: "electrical.breaker.location",
      type: "SELECT",
      options: [
        "Outdoor unit circuit",
        "Indoor unit circuit",
        "Both or unknown",
      ],
      required: true,
      sourceType: "REPORTED",
    },
    requiresTool: false,
  },
  {
    id: "breaker_trip_timing",
    title: "When does breaker trip?",
    prompt: "When does the breaker trip relative to system operation?",
    capture: {
      tag: "electrical.breaker.trip_timing",
      type: "SELECT",
      options: [
        "Immediately at startup",
        "After a few to 15+ minutes",
        "Intermittently",
      ],
      required: true,
      sourceType: "REPORTED",
    },
    requiresTool: false,
  },
  {
    id: "breaker_amp_rating",
    title: "Breaker amperage vs. equipment nameplate?",
    prompt:
      "Check the breaker amperage. Check the equipment nameplate for MCA and MOCP. Does the breaker match?",
    hint: "An undersized or oversized breaker can cause nuisance trips. MCA = Minimum Circuit Ampacity. MOCP = Maximum Overcurrent Protection.",
    capture: {
      tag: "electrical.breaker.sizing",
      type: "SELECT",
      options: [
        "Matches nameplate MOCP",
        "Undersized vs. nameplate",
        "Oversized or unverifiable",
      ],
      required: false,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "electrical.breaker.location") !== undefined,
  },
  {
    id: "compressor_amps",
    title: "Compressor running amps?",
    prompt:
      "If unit will run, clamp meter on compressor leg. What are the running amps vs. RLA on nameplate?",
    capture: {
      tag: "electrical.compressor.amps",
      type: "SELECT",
      options: [
        "Within RLA — normal",
        "Above RLA — elevated",
        "At/above LRA",
      ],
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "electrical.breaker.trip_timing") !== undefined,
  },
];

// ─── SHORT CYCLING ───────────────────────────────────────────

const SHORT_CYCLING_STEPS: PackStep[] = [
  {
    id: "cycle_duration",
    title: "Cycle run time?",
    prompt: "Estimate how long the system runs before shutting off.",
    capture: {
      tag: "operation.cycle_duration",
      type: "SELECT",
      options: [
        "Less than 2 minutes",
        "2–10 minutes",
        "Over 10 minutes",
      ],
      required: true,
      sourceType: "REPORTED",
    },
    requiresTool: false,
  },
  {
    id: "fault_code_short",
    title: "Fault code on control board?",
    prompt:
      "Check the thermostat or indoor control board for fault codes. What is displayed?",
    capture: {
      tag: "control.fault_code",
      type: "SELECT",
      options: [
        "Pressure fault (high or low)",
        "Limit or other fault",
        "No fault / no display",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
  },
  {
    id: "short_cycle_suction",
    title: "Suction pressure at shutdown?",
    prompt:
      "Connect gauges if not already on. Note suction pressure at the moment of shutdown.",
    hint: "Low-pressure cutout typically trips below 50–70 PSI on R-410A. High-pressure cutout trips above 600 PSI.",
    capture: {
      tag: "refrigerant.suction_at_shutdown",
      type: "SELECT",
      options: [
        "Below 70 PSI",
        "70–130 PSI — normal range",
        "Above 400 PSI",
      ],
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) => ev(ctx, "operation.cycle_duration") !== undefined,
  },
];

// ============================================================
// CONDITION MAPPING
// ============================================================

const conditionMapFns: ConditionMapFn[] = [

  // Primary observation-based mapping
  (tag, value) => {
    // Controls / thermostat
    if (tag === "thermostat.response" && value === "Nothing responds")
      return { condition: C.CONTROLS, weight: 5 };
    if (tag === "thermostat.display") {
      if (value === "Fault code shown")
        return { condition: C.CONTROLS, weight: 3 };
      if (value === "Blank or unresponsive")
        return { condition: C.CONTROLS, weight: 3 };
    }

    // Airflow
    if (tag === "airflow.at_filter") {
      if (value === "Weak")
        return { condition: C.AIRFLOW, weight: 3 };
      if (value === "No airflow")
        return { condition: C.AIRFLOW, weight: 4 };
    }
    if (tag === "airflow.filter_condition") {
      if (value === "Severely restricted or missing")
        return { condition: C.AIRFLOW, weight: 5 };
      if (value === "Dirty but open")
        return { condition: C.AIRFLOW, weight: 2 };
    }

    // Condensate / drainage — indoor
    if (tag === "indoor.condensate") {
      if (value === "Water in pan — float tripped")
        return { condition: C.DRAINAGE, weight: 4 };
      if (value === "Condensate switch tripped")
        return { condition: C.DRAINAGE, weight: 4 };
    }

    // Indoor electrical — blower not running
    if (tag === "indoor.high_voltage") {
      if (value === "One leg missing")
        return { condition: C.ELECTRICAL, weight: 5 };
      if (value === "No voltage either leg")
        return { condition: C.ELECTRICAL, weight: 5 };
    }
    if (tag === "indoor.electrician_referral" && value === "Noted — electrician called")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.no_power" && value === "Breaker tripped — reset")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "indoor.no_power" && value === "Disconnect open — closed now")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "indoor.transformer" && value === "Confirmed — bad transformer")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.fuse_root_cause" && value === "Shorted wire found")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "indoor.fuse_root_cause" && value === "Contactor coil shorted")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.board.fuse" && value === "Fuse blown")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "indoor.thermostat_bypass" && value === "Yes — compressor and blower motor start")
      return { condition: C.CONTROLS, weight: 4 };
    if (tag === "indoor.blower_relay" && value === "Relay bad — no click or response")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.blower_capacitor" && value === "Low or open")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "indoor.blower.motor.conclusion" && value === "Confirmed bad blower motor")
      return { condition: C.MECHANICAL, weight: 5 };
    if (tag === "indoor.control_board.conclusion" && value === "Confirmed bad control board")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.thermostat.conclusion" && value === "Confirmed bad thermostat")
      return { condition: C.CONTROLS, weight: 5 };

    // Outdoor — contactor and voltage
    if (tag === "outdoor.contactor.pulled" && value === "No")
      return { condition: C.ELECTRICAL, weight: 3 };
    if (tag === "outdoor.contactor.conclusion" && value === "Confirmed bad contactor")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "outdoor.controls.conclusion" && value === "Confirmed — no signal from controls")
      return { condition: C.CONTROLS, weight: 5 };
    if (tag === "outdoor.contactor.hv_line_in") {
      if (value === "One leg missing")
        return { condition: C.ELECTRICAL, weight: 5 };
      if (value === "Low or no voltage")
        return { condition: C.ELECTRICAL, weight: 5 };
    }
    if (tag === "outdoor.contactor.hv_load_out") {
      if (value === "One or both legs absent")
        return { condition: C.ELECTRICAL, weight: 5 };
      if (value === "Significant voltage drop")
        return { condition: C.ELECTRICAL, weight: 4 };
    }

    // Safety switches
    if (tag === "outdoor.safety_switches") {
      if (value === "Pressure switch tripped")
        return { condition: C.REFRIGERANT, weight: 4 };
      if (value === "Other switch tripped")
        return { condition: C.ELECTRICAL, weight: 3 };
    }

    // Capacitor
    if (tag === "outdoor.capacitor.visual") {
      if (value === "Obvious failure — bulging or oil")
        return { condition: C.ELECTRICAL, weight: 5 };
      if (value === "Burn marks or discoloration")
        return { condition: C.ELECTRICAL, weight: 4 };
    }
    if (tag === "outdoor.capacitor.reading") {
      if (value === "Below spec")
        return { condition: C.ELECTRICAL, weight: 4 };
      if (value === "Open — no reading")
        return { condition: C.ELECTRICAL, weight: 5 };
    }

    // Fan motor diagnostics
    if (tag === "outdoor.fan.motor") {
      if (value === "Spins freely — bad motor")
        return { condition: C.MECHANICAL, weight: 4 };
      if (value === "Hard to spin — seized motor")
        return { condition: C.MECHANICAL, weight: 5 };
    }
    if (tag === "outdoor.fan.motor.conclusion" && value === "Confirmed bad fan motor")
      return { condition: C.MECHANICAL, weight: 5 };

    // Compressor diagnostics
    if (tag === "outdoor.compressor.start_assist" && value === "Still won't start — further diagnosis needed")
      return { condition: C.MECHANICAL, weight: 4 };
    if (tag === "outdoor.compressor.windings") {
      if (value === "Open winding")
        return { condition: C.MECHANICAL, weight: 5 };
      if (value === "Shorted or grounded")
        return { condition: C.MECHANICAL, weight: 5 };
    }
    if (tag === "outdoor.compressor.failed" && value === "Confirmed — bad compressor")
      return { condition: C.MECHANICAL, weight: 5 };
    if (tag === "repair.compressor.authorization" && value === "Authorization declined — system down")
      return { condition: C.UNKNOWN, weight: 1 };

    // Compressor sound
    if (tag === "outdoor.compressor.sound") {
      if (value === "Attempting but not starting")
        return { condition: C.ELECTRICAL, weight: 4 }; // likely capacitor or locked rotor
      if (value === "Silent — no attempt")
        return { condition: C.ELECTRICAL, weight: 3 };
    }

    // Refrigerant pressures
    if (tag === "refrigerant.pressure_pattern") {
      if (value === "Suction low (restriction or leak)")
        return { condition: C.REFRIGERANT, weight: 5 };
      if (value === "Head pressure high (overcharge or blockage)")
        return { condition: C.REFRIGERANT, weight: 4 };
    }
    if (tag === "refrigerant.superheat_subcooling") {
      if (value === "One or more readings high")
        return { condition: C.REFRIGERANT, weight: 4 };
      if (value === "One or more readings low")
        return { condition: C.REFRIGERANT, weight: 4 };
    }

    // Drainage
    if (tag === "drainage.float_switch.tripped" && value === "Yes")
      return { condition: C.DRAINAGE, weight: 4 };
    if (tag === "drainage.secondary_pan.water_level") {
      if (value === "Overflowing")
        return { condition: C.DRAINAGE, weight: 5 };
      if (value === "High — near float switch")
        return { condition: C.DRAINAGE, weight: 4 };
    }
    if (tag === "drainage.primary_drain.flow") {
      if (value === "Does not drain")
        return { condition: C.DRAINAGE, weight: 5 };
      if (value === "Slow or restricted")
        return { condition: C.DRAINAGE, weight: 3 };
    }
    if (tag === "indoor.coil.iced" && value === "Yes")
      return { condition: C.REFRIGERANT, weight: 3 };

    // Breaker
    if (tag === "electrical.breaker.sizing") {
      if (value === "Undersized vs. nameplate")
        return { condition: C.ELECTRICAL, weight: 3 };
    }
    if (tag === "electrical.compressor.amps") {
      if (value === "Above RLA — elevated")
        return { condition: C.ELECTRICAL, weight: 4 };
      if (value === "At/above LRA")
        return { condition: C.MECHANICAL, weight: 5 };
    }

    // Short cycling
    if (tag === "control.fault_code") {
      if (value === "Pressure fault (high or low)")
        return { condition: C.REFRIGERANT, weight: 3 };
    }
    if (tag === "refrigerant.suction_at_shutdown") {
      if (value === "Below 70 PSI")
        return { condition: C.REFRIGERANT, weight: 4 };
      if (value === "Above 400 PSI")
        return { condition: C.REFRIGERANT, weight: 4 };
    }

    // Repair confirmation steps
    if (tag === "repair.thermostat" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.blower_motor" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.control_board" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.fan_motor" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.contactor" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.controls" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.transformer" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.verified" && value === "Issue persists — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 3 };
    if (tag === "indoor.fuse_no_cause" && value === "Unable to determine — recommend control board replacement")
      return { condition: C.ELECTRICAL, weight: 3 };
    if (tag === "outdoor.safety_switch_reset" && value === "No — switch trips again immediately")
      return { condition: C.REFRIGERANT, weight: 4 };
    if (tag === "repair.blower_capacitor" && value === "No — further diagnosis needed")
      return { condition: C.UNKNOWN, weight: 2 };
    if (tag === "repair.condensate" && value === "No — drain still blocked")
      return { condition: C.DRAINAGE, weight: 4 };
    if (tag === "outdoor.electrician_referral")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "repair.outdoor_contactor_load" && value === "Issue persists")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "repair.outdoor_contactor_load" && value === "Contactor replaced — system restored")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "outdoor.compressor.locked_rotor" && value === "Still won't start — locked rotor likely")
      return { condition: C.MECHANICAL, weight: 5 };
    if (tag === "refrigerant.pressure_action" && value === "Leak search required")
      return { condition: C.REFRIGERANT, weight: 5 };
    if (tag === "refrigerant.pressure_action" && value === "Check for restriction — metering device or line")
      return { condition: C.REFRIGERANT, weight: 4 };
    if (tag === "outdoor.safety_switch_diagnosis" && value === "High pressure confirmed — check condenser coil")
      return { condition: C.REFRIGERANT, weight: 4 };
    if (tag === "outdoor.safety_switch_diagnosis" && value === "Low pressure confirmed — check charge")
      return { condition: C.REFRIGERANT, weight: 5 };

    return null;
  },

  // Delta-T mapping (computed from two evidence values)
  (tag, value, ctx) => {
    if (tag !== "airflow.return_temp_f") return null;
    const supplyStr = ctx.evidence["airflow.supply_temp_f"];
    if (!supplyStr) return null;
    const supply = parseFloat(supplyStr);
    const ret = parseFloat(value);
    if (isNaN(supply) || isNaN(ret)) return null;
    const deltaT = ret - supply;
    if (deltaT < 10) return { condition: C.REFRIGERANT, weight: 4 };
    if (deltaT > 22) return { condition: C.AIRFLOW, weight: 3 };
    return null;
  },

  // Refrigerant pressure mapping (computed from suction PSI)
  (tag, value, ctx) => {
    if (tag !== "refrigerant.liquid_psi") return null;
    const suctionStr = ctx.evidence["refrigerant.suction_psi"];
    if (!suctionStr) return null;
    const suction = parseFloat(suctionStr);
    if (isNaN(suction)) return null;
    if (suction < 80) return { condition: C.REFRIGERANT, weight: 4 };
    if (suction > 160) return { condition: C.REFRIGERANT, weight: 3 };
    return null;
  },
];

// ============================================================
// PACK DEFINITION
// ============================================================

export const HVAC_COOLING_PACK: PackDefinition = {
  id: "hvac.cooling.v2",
  name: "HVAC Cooling Pack",
  version: "2.0.0",

  complaintCategories: [
    {
      id: "not_cooling",
      label: "Not cooling",
      description: "System running but no cold air",
    },
    {
      id: "not_keeping_up",
      label: "Not keeping up",
      description: "Cannot reach setpoint",
    },
    {
      id: "not_turning_on",
      label: "Not turning on",
      description: "No response at all",
    },
    {
      id: "water_leak",
      label: "Water leak",
      description: "Dripping or pooling water",
    },
    {
      id: "tripping_breaker",
      label: "Tripping breaker",
      description: "Circuit keeps tripping",
    },
    {
      id: "other",
      label: "Other",
      description: "Describe during diagnosis",
    },
  ],

  steps: {
    not_cooling: NO_COOLING_STEPS,
    not_keeping_up: NO_COOLING_STEPS,
    not_turning_on: NO_COOLING_STEPS,
    water_leak: WATER_FLOAT_STEPS,
    tripping_breaker: BREAKER_TRIPS_STEPS,
    other: [],
  },

  conditionTaxonomy: Object.values(C),

  conditionMapFns,

  promotionThresholds: {
    plausible: 2,
    evidenceSupported: 5,
    confirmed: 8,
  },

  minimumEvidencePaths: {
    not_cooling: [
      "thermostat.response",
      "airflow.filter_condition",
    ],
    not_keeping_up: [
      "thermostat.response",
      "airflow.filter_condition",
    ],
    not_turning_on: [
      "thermostat.response",
      "indoor.low_voltage",
    ],
    water_leak: [
      "drainage.float_switch.tripped",
      "drainage.primary_drain.flow",
    ],
    tripping_breaker: [
      "electrical.breaker.location",
      "electrical.breaker.trip_timing",
    ],
    other: [],
  },

  tieBreakPriority: [
    "Unknown",
    "Mechanical",
    "Airflow",
    "Control System",
    "Drainage",
    "Electrical",
    "Refrigerant System",
  ],

  downstreamEffects: {
    "Refrigerant System": ["not_cooling", "not_keeping_up"],
    "Electrical": ["not_turning_on", "not_cooling", "tripping_breaker"],
    "Airflow": ["not_keeping_up"],
    "Drainage": ["water_leak"],
    "Control System": ["not_cooling", "not_turning_on"],
    "Mechanical": ["not_cooling"],
    "Unknown": [],
  },

  reportTemplates: {
    technicalTitle: "HVAC Cooling System — Field Diagnostic Report",
    userTitle: "Cooling System Evaluation Summary",
    conditionLabels: {
      Electrical: "Electrical System",
      "Refrigerant System": "Refrigerant Circuit",
      Mechanical: "Mechanical Components",
      Airflow: "Airflow / Distribution",
      Drainage: "Condensate / Drainage",
      "Control System": "Controls / Thermostat",
      Unknown: "Undetermined",
    },
    nextStepsByCondition: {
      Electrical: "Inspect and replace failed electrical component — capacitor, contactor, transformer, or motor as indicated.",
      "Refrigerant System": "Perform leak search, repair leak, and recharge system to manufacturer specifications.",
      Mechanical: "Inspect and replace failed mechanical component — compressor, fan motor, or blower motor as indicated.",
      Airflow: "Replace air filter and inspect ductwork for blockages.",
      Drainage: "Clear condensate drain line and verify float switch operation.",
      "Control System": "Inspect and replace failed control component — thermostat, control board, or relay as indicated.",
      Unknown: "Perform full system inspection — diagnosis inconclusive.",
    },
    maintenanceTipsByCondition: {
      Electrical: "Test capacitor µF and inspect contactor for pitting annually.",
      "Refrigerant System": "Clean coils and verify charge annually with an electronic leak check.",
      Mechanical: "Lubricate motors and check compressor amp draw at each annual service.",
      Airflow: "Replace filter every 1–3 months and inspect ducts annually.",
      Drainage: "Flush condensate drain monthly during cooling season.",
      "Control System": "Replace thermostat batteries annually and inspect low-voltage wiring.",
      Unknown: "Schedule full professional maintenance to identify root cause.",
    },
  },
};
