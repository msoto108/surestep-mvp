// ============================================================
// Pack: HVAC / Cooling v1
// ============================================================

import type {
  PackDefinition,
  PackStep,
  RunContext,
  ConditionMapFn,
} from "../../../app/runner/types";

// ─── Helper ─────────────────────────────────────────────────

function ev(ctx: RunContext, tag: string): string | undefined {
  return ctx.evidence[tag];
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

// ─── Steps ──────────────────────────────────────────────────

const NO_COOLING_STEPS: PackStep[] = [
  {
    id: "call_for_cooling",
    title: "Call for cooling present?",
    prompt:
      "Confirm the thermostat is calling for cooling — set to COOL, fan AUTO, setpoint below room temp.",
    capture: {
      tag: "system.call_for_cooling",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
  },
  {
    id: "indoor_power",
    title: "Indoor unit power confirmed?",
    prompt:
      "Check the air handler or furnace — verify breaker on, disconnect closed, no blown fuses.",
    capture: {
      tag: "indoor.power",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "system.call_for_cooling") === "Yes",
  },
  {
    id: "blower_running",
    title: "Indoor blower running?",
    prompt: "Confirm whether the indoor blower motor is running.",
    capture: {
      tag: "indoor.blower.running",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "system.call_for_cooling") === "Yes" &&
      ev(ctx, "indoor.power") === "Yes",
  },
  {
    id: "airflow_at_supply",
    title: "Airflow at supply registers?",
    prompt: "Check nearest supply register — is air moving?",
    capture: {
      tag: "airflow.supply_present",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.blower.running") === "Yes",
  },
  {
    id: "filter_condition",
    title: "Air filter condition?",
    prompt: "Inspect the air filter.",
    capture: {
      tag: "airflow.filter_condition",
      type: "SELECT",
      options: [
        "Clean",
        "Moderately dirty",
        "Severely restricted / collapsed",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "indoor.blower.running") === "Yes",
  },
  {
    id: "outdoor_power",
    title: "Outdoor unit power confirmed?",
    prompt:
      "Check outdoor condenser — verify breaker, disconnect, and no blown fuses.",
    capture: {
      tag: "outdoor.power",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) =>
      ev(ctx, "indoor.blower.running") === "Yes" &&
      ev(ctx, "airflow.supply_present") === "Yes",
  },
  {
    id: "outdoor_fan_running",
    title: "Outdoor fan running?",
    prompt:
      "Observe the outdoor condenser unit — is the condenser fan spinning?",
    capture: {
      tag: "outdoor.fan.running",
      type: "YES_NO_UNABLE",
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.power") === "Yes",
  },
  {
    id: "compressor_running",
    title: "Compressor running?",
    prompt:
      "Listen and feel at the outdoor unit — is the compressor operating?",
    hint: "A running compressor produces a low hum or vibration. Humming without starting suggests a capacitor issue.",
    capture: {
      tag: "outdoor.compressor.running",
      type: "SELECT",
      options: [
        "Running normally",
        "Humming but not starting",
        "Not running / silent",
        "Unable to determine",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "outdoor.fan.running") === "Yes",
  },
  {
    id: "supply_temp",
    title: "Supply air temperature?",
    prompt: "Measure supply air temperature at the nearest register.",
    hint: "Needed to validate current condition state.",
    capture: {
      tag: "airflow.supply_temp_f",
      type: "NUMBER",
      unit: "°F",
      placeholder: "e.g. 58",
      required: false,
      sourceType: "TOOL_PROOF",
    },
    requiresTool: true,
    prereq: (ctx) =>
      ev(ctx, "outdoor.compressor.running") === "Running normally",
  },
  {
    id: "return_temp",
    title: "Return air temperature?",
    prompt: "Measure return air temperature at the filter grille.",
    hint: "Delta-T (return minus supply) confirms system performance.",
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
];

const WATER_FLOAT_STEPS: PackStep[] = [
  {
    id: "float_tripped",
    title: "Float switch tripped?",
    prompt:
      "Check the secondary drain pan float switch — is it in the tripped position?",
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
    prompt: "Inspect secondary drain pan — how much standing water is present?",
    capture: {
      tag: "drainage.secondary_pan.water_level",
      type: "SELECT",
      options: [
        "Overflowing",
        "High — near float switch",
        "Low / trace moisture",
        "Dry",
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
    prompt: "Pour one cup of water into primary drain pan. Observe drain flow.",
    capture: {
      tag: "drainage.primary_drain.flow",
      type: "SELECT",
      options: [
        "Flows freely",
        "Slow drain",
        "Does not drain / backs up",
        "Unable to test",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
    prereq: (ctx) => ev(ctx, "drainage.float_switch.tripped") === "Yes",
  },
];

const BREAKER_TRIPS_STEPS: PackStep[] = [
  {
    id: "which_breaker",
    title: "Which circuit trips?",
    prompt: "Identify which breaker is tripping.",
    capture: {
      tag: "electrical.breaker.location",
      type: "SELECT",
      options: [
        "Outdoor condenser circuit",
        "Indoor air handler / furnace circuit",
        "Both circuits",
        "Unknown / not determined",
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
        "After running a few minutes",
        "After running 15+ minutes",
        "Intermittently / no clear pattern",
      ],
      required: true,
      sourceType: "REPORTED",
    },
    requiresTool: false,
  },
];

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
        "2–5 minutes",
        "5–10 minutes",
        "Over 10 minutes (normal range)",
      ],
      required: true,
      sourceType: "REPORTED",
    },
    requiresTool: false,
  },
  {
    id: "fault_code",
    title: "Any fault codes displayed?",
    prompt: "Check the thermostat or control board for fault codes.",
    capture: {
      tag: "control.fault_code",
      type: "SELECT",
      options: [
        "High-pressure fault",
        "Low-pressure fault",
        "Other fault code",
        "No fault code shown",
        "No display available",
      ],
      required: true,
      sourceType: "OBSERVED",
    },
    requiresTool: false,
  },
];

// ─── Condition Mapping ───────────────────────────────────────

const conditionMapFns: ConditionMapFn[] = [
  (tag, value) => {
    if (tag === "system.call_for_cooling" && value === "No")
      return { condition: C.CONTROLS, weight: 4 };
    if (tag === "indoor.power" && value === "No")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "indoor.blower.running" && value === "No")
      return { condition: C.ELECTRICAL, weight: 4 };
    if (tag === "outdoor.power" && value === "No")
      return { condition: C.ELECTRICAL, weight: 5 };
    if (tag === "outdoor.fan.running" && value === "No")
      return { condition: C.ELECTRICAL, weight: 3 };
    if (
      tag === "outdoor.compressor.running" &&
      value === "Humming but not starting"
    )
      return { condition: C.ELECTRICAL, weight: 4 };
    if (
      tag === "outdoor.compressor.running" &&
      value === "Not running / silent"
    )
      return { condition: C.ELECTRICAL, weight: 3 };
    if (tag === "airflow.filter_condition") {
      if (value === "Severely restricted / collapsed")
        return { condition: C.AIRFLOW, weight: 5 };
      if (value === "Moderately dirty")
        return { condition: C.AIRFLOW, weight: 2 };
    }
    if (tag === "drainage.float_switch.tripped" && value === "Yes")
      return { condition: C.DRAINAGE, weight: 4 };
    if (tag === "drainage.secondary_pan.water_level") {
      if (value === "Overflowing") return { condition: C.DRAINAGE, weight: 5 };
      if (value === "High — near float switch")
        return { condition: C.DRAINAGE, weight: 4 };
    }
    if (tag === "drainage.primary_drain.flow") {
      if (value === "Does not drain / backs up")
        return { condition: C.DRAINAGE, weight: 5 };
      if (value === "Slow drain") return { condition: C.DRAINAGE, weight: 3 };
    }
    if (tag === "electrical.breaker.location") {
      if (value !== "Unknown / not determined")
        return { condition: C.ELECTRICAL, weight: 4 };
    }
    if (tag === "control.fault_code") {
      if (value === "High-pressure fault")
        return { condition: C.REFRIGERANT, weight: 3 };
      if (value === "Low-pressure fault")
        return { condition: C.REFRIGERANT, weight: 3 };
    }
    return null;
  },
  (tag, value, ctx) => {
    if (tag !== "airflow.return_temp_f") return null;
    const supplyStr = ctx.evidence["airflow.supply_temp_f"];
    if (!supplyStr) return null;
    const supply = parseFloat(supplyStr);
    const ret = parseFloat(value);
    if (isNaN(supply) || isNaN(ret)) return null;
    const deltaT = ret - supply;
    if (deltaT < 10) return { condition: C.REFRIGERANT, weight: 4 };
    if (deltaT > 22) return { condition: C.AIRFLOW, weight: 4 };
    return null;
  },
];

// ─── Pack Definition ────────────────────────────────────────

export const HVAC_COOLING_PACK: PackDefinition = {
  id: "hvac.cooling.v1",
  name: "HVAC Cooling Pack",
  version: "1.0.0",
  complaintCategories: [
    { id: "no_cooling_at_all", label: "No cooling at all", description: "System runs but produces no cold air" },
    { id: "runs_not_cold", label: "Runs but not cold enough", description: "System operates but doesn't reach setpoint" },
    { id: "no_airflow", label: "No airflow / weak airflow", description: "Little or no air movement from registers" },
    { id: "system_dead", label: "System dead — won't turn on", description: "No response at all when cooling is called" },
    { id: "water_float", label: "Water leak / float trip", description: "Water pooling or float switch has shut system down" },
    { id: "breaker_trips", label: "Breaker tripping", description: "Circuit breaker trips when system runs" },
    { id: "short_cycling", label: "Short cycling / rapid on-off", description: "System starts and stops frequently" },
    { id: "other", label: "Other / unclear", description: "Problem doesn't fit the categories above" },
  ],
  steps: {
    no_cooling_at_all: NO_COOLING_STEPS,
    runs_not_cold: NO_COOLING_STEPS,
    no_airflow: NO_COOLING_STEPS,
    system_dead: NO_COOLING_STEPS,
    water_float: WATER_FLOAT_STEPS,
    breaker_trips: BREAKER_TRIPS_STEPS,
    short_cycling: SHORT_CYCLING_STEPS,
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
    no_cooling_at_all: ["system.call_for_cooling", "indoor.blower.running"],
    runs_not_cold: ["system.call_for_cooling", "indoor.blower.running"],
    no_airflow: ["indoor.blower.running"],
    system_dead: ["indoor.power"],
    water_float: ["drainage.float_switch.tripped", "drainage.primary_drain.flow"],
    breaker_trips: ["electrical.breaker.location", "electrical.breaker.trip_timing"],
    short_cycling: ["operation.cycle_duration", "control.fault_code"],
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
      Electrical:
        "Have a licensed HVAC technician inspect electrical components — capacitors, contactors, wiring, and breaker sizing.",
      "Refrigerant System":
        "A certified HVAC technician must inspect refrigerant charge and coil integrity. EPA 608 certification required.",
      Mechanical:
        "A technician should inspect motors, blower wheels, bearings, and condenser coil for wear or damage.",
      Airflow:
        "Replace the air filter immediately. Inspect ductwork for obstructions or disconnections.",
      Drainage:
        "Clear the condensate drain line with a wet/dry vac at the drain outlet. Check float switch operation.",
      "Control System":
        "Verify thermostat wiring, settings, and battery condition. Check Y-terminal voltage at the control board.",
      Unknown:
        "Insufficient evidence to identify a specific condition. A licensed HVAC technician should perform a full inspection.",
    },
    maintenanceTipsByCondition: {
      Electrical:
        "Annual preventive maintenance should include capacitor testing and contactor inspection.",
      "Refrigerant System":
        "Annual coil cleaning and leak detection extend system life significantly.",
      Mechanical:
        "Lubricate condenser fan motors annually. Replace belts showing cracking or glazing.",
      Airflow:
        "Replace filters every 1–3 months depending on occupancy and filter type.",
      Drainage:
        "Flush the condensate drain line monthly during cooling season. Use condensate treatment tablets.",
      "Control System":
        "Replace thermostat batteries annually. Consider upgrading to a programmable thermostat.",
      Unknown:
        "Annual professional maintenance reduces the risk of undiagnosed failure.",
    },
  },
};