import { SYSTEM_MNEMONICS } from './parseTrainTracer.js';

/* ============================================================================
 * CM AUTOPILOT — Triage engine
 * Turns a wall of raw log rows into a short, ranked list of real problems.
 *
 *   1. Filter out the routine system chatter that isn't a fault
 *   2. Merge repeated firings of the same fault into one incident
 *   3. Spot faults that keep coming back (never properly fixed)
 *   4. Rank everything by an importance score you can read and argue with:
 *
 *        score = severity x how-often x how-recent x still-happening x keeps-returning
 *
 * Every part of that score is shown in the app, so nothing is a black box.
 * ==========================================================================*/

export const DEFAULTS = { hideSystemEvents: true, hideInformation: true, stormGapMin: 60 };
const SEV_WEIGHT = { Critical: 100, Major: 40, Minor: 10, Information: 1 };
export const SEV_RANK = { Critical: 4, Major: 3, Minor: 2, Information: 1 };
export const SEV_ORDER = ['Critical', 'Major', 'Minor', 'Information'];

/* ---- Plain-language fault names ----------------------------------------
 * A code like F_TBS_PCE4PropNotOper means nothing to most people. We turn it
 * into a short phrase anyone can read ("Propulsion unit not working"), while
 * still showing the original code for the technician who needs the exact one.
 * The mapping is best-effort: known patterns first, then a tidy-up of the
 * manual's own description text. */
const NAME_PATTERNS = [
  [/PropNotOper|PropFault/i, 'Propulsion unit not working'],
  [/EDBNotOper/i, 'Electric brake not working'],
  [/PCE\d*.*Prop/i, 'Propulsion unit not working'],
  [/EchelonDbleFlt/i, 'Double brake-control failure'],
  [/CriticalFltPres/i, 'Critical brake fault present'],
  [/NoBCEMaster/i, 'Brake controller lost its master'],
  [/DutyCyc/i, 'Air compressor overworking'],
  [/AirDryer/i, 'Air dryer fault'],
  [/CMP.*OPInfo/i, 'Compressor contactor fault'],
  [/IESNotCollFlt|IESNotColl/i, 'Power collection inconsistency'],
  [/Undershoot/i, 'Train stopped short of target'],
  [/Overshoot/i, 'Train overshot the stop'],
  [/FSB/i, 'Full-service braking triggered'],
  [/CrewSw|crew switch/i, 'Crew switch activated'],
  [/DoorIsol|DoorNotOper/i, 'Door isolated / not working'],
  [/ObstDet/i, 'Obstacle detected on door'],
  [/Cooling/i, 'Air-conditioning cooling fault'],
  [/TempFlt|TripTemp/i, 'Cabin temperature out of range'],
  [/Vent/i, 'Ventilation fault'],
  [/ComNOk|ComNok/i, 'Communication lost with a unit'],
  [/DPGTransfer/i, 'Network data-transfer event'],
  [/WSP/i, 'Wheel-slide protection fault'],
  [/ParkBrk/i, 'Parking-brake fault'],
  [/EBrake|EmergBrk|EB_/i, 'Emergency-brake event'],
];

const FUNCTION_PLAIN = {
  'Traction Brake system': 'Traction & braking',
  'Braking': 'Braking',
  'Air Compressor': 'Compressed air',
  'Access Doors': 'Doors',
  'Driving': 'Driving / ATO',
  'High Voltage System': 'High-voltage power',
  'Medium Voltage System': 'Medium-voltage power',
  'Train Control Network': 'Onboard network',
  'Heating Ventilation and Air Conditioning': 'Air-conditioning',
  'Public Address Intercom': 'PA & intercom',
  'Automatic Train Control': 'Train control',
};

export function plainName(mnemonic, description, fn) {
  for (const [re, label] of NAME_PATTERNS) if (re.test(mnemonic)) return label;
  // fall back to the manual's description, cleaned up
  let d = (description || '').trim();
  if (d) {
    d = d.replace(/\bfault\b/gi, '').replace(/\bevent\b/gi, '').replace(/\s+/g, ' ').trim();
    if (d.length > 2) return d.charAt(0).toUpperCase() + d.slice(1);
  }
  return FUNCTION_PLAIN[fn] || fn || 'Fault';
}

export function plainFunction(fn) { return FUNCTION_PLAIN[fn] || fn || 'Other'; }

function recencyFactor(lastMs, nowMs) {
  const days = (nowMs - lastMs) / 86400000;
  if (days <= 7) return 1.0;
  if (days >= 90) return 0.3;
  return 1.0 - 0.7 * ((days - 7) / 83);
}

export function triage(events, opts = DEFAULTS) {
  const stats = { total: events.length, systemFiltered: 0, infoFiltered: 0 };
  let working = events;

  if (opts.hideSystemEvents) {
    const b = working.length;
    working = working.filter((e) => !SYSTEM_MNEMONICS.has(e.mnemonic));
    stats.systemFiltered = b - working.length;
  }
  if (opts.hideInformation) {
    const b = working.length;
    working = working.filter((e) => e.severity !== 'Information');
    stats.infoFiltered = b - working.length;
  }

  const gapMs = opts.stormGapMin * 60000;
  const buckets = new Map();
  for (const e of working) {
    const key = `${e.trainset}|${e.mnemonic}|${e.location}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(e);
  }

  const incidents = [];
  for (const [key, list] of buckets) {
    list.sort((a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0));
    let group = [list[0]];
    const flush = () => {
      const first = group[0], last = group[group.length - 1];
      incidents.push({
        id: `${key}|${first.occurrence}`, trainset: first.trainset, mnemonic: first.mnemonic,
        tcode: first.tcode, description: first.description, severity: first.severity,
        plainName: plainName(first.mnemonic, first.description, first.fn),
        plainFn: plainFunction(first.fn),
        severityRank: SEV_RANK[first.severity] ?? 0,
        hint: first.hint, fn: first.fn, location: first.location, locationCode: first.locationCode,
        stack: first.stack, firstSeen: first.occurrence, lastSeen: last.occurrence,
        firings: group.reduce((s, g) => s + (g.counter || 1), 0), rows: group.length,
        wasActive: group.some((g) => g.status === 'Active'), endedActive: last.status === 'Active',
        durationMs: (last.occurrence ?? 0) - (first.occurrence ?? 0),
        traces: (group.find((g) => g.traces?.length) || first).traces || [],
        traceHeaders: first.traceHeaders || [],
        sourceFiles: [...new Set(group.map((g) => g.sourceFile))],
      });
    };
    for (let i = 1; i < list.length; i++) {
      const prev = group[group.length - 1];
      if ((list[i].occurrence ?? 0) - (prev.occurrence ?? 0) <= gapMs) group.push(list[i]);
      else { flush(); group = [list[i]]; }
    }
    flush();
  }

  // Repeat-offender detection: same fault, same place, returning on separate
  // occasions = a defect that was never actually fixed. Invisible in Excel.
  const repeatCount = new Map();
  for (const inc of incidents) {
    const k = `${inc.trainset}|${inc.mnemonic}|${inc.location}`;
    repeatCount.set(k, (repeatCount.get(k) || 0) + 1);
  }
  for (const inc of incidents) inc.repeats = repeatCount.get(`${inc.trainset}|${inc.mnemonic}|${inc.location}`);

  const nowMs = Math.max(...incidents.map((i) => i.lastSeen ?? 0), 0);
  for (const inc of incidents) {
    const sev = SEV_WEIGHT[inc.severity] ?? 1;
    const rec = 1 + Math.log(1 + inc.firings);
    const age = recencyFactor(inc.lastSeen ?? nowMs, nowMs);
    const per = inc.endedActive ? 1.5 : 1.0;
    const rpt = Math.min(1 + 0.25 * (inc.repeats - 1), 2.5);
    inc.score = sev * rec * age * per * rpt;
    inc.scoreParts = { sev, rec: +rec.toFixed(2), age: +age.toFixed(2), per, rpt: +rpt.toFixed(2) };
  }

  // Default order: most critical first, and within the same severity, the
  // highest-scoring (most urgent) first.
  incidents.sort((a, b) => (b.severityRank - a.severityRank) || (b.score - a.score));

  stats.incidents = incidents.length;
  stats.badActors = [...new Set(incidents.filter((i) => i.repeats >= 3)
    .map((i) => `${i.trainset}|${i.mnemonic}|${i.location}`))].length;
  stats.collapsed = working.length - incidents.length;
  stats.trainsets = [...new Set(incidents.map((i) => i.trainset))].sort();
  stats.window = incidents.length ? { from: Math.min(...incidents.map((i) => i.firstSeen)), to: nowMs } : null;

  return { incidents, stats };
}

export function summarise(incidents) {
  const bySeverity = {}, byFunction = {}, byTrainset = {};
  for (const i of incidents) {
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    byFunction[i.plainFn || 'Other'] = (byFunction[i.plainFn || 'Other'] || 0) + 1;
    byTrainset[i.trainset] = (byTrainset[i.trainset] || 0) + 1;
  }
  return { bySeverity, byFunction, byTrainset };
}

export function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDuration(ms) {
  if (!ms || ms < 60000) return '<1 min';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min`;
  const hrs = mins / 60;
  if (hrs < 48) return `${hrs.toFixed(1)} h`;
  return `${(hrs / 24).toFixed(1)} d`;
}

// Sort helper used by the dropdown in the UI.
export const SORT_OPTIONS = {
  'critical-first': { label: 'Most critical first', fn: (a, b) => (b.severityRank - a.severityRank) || (b.score - a.score) },
  'least-first': { label: 'Least critical first', fn: (a, b) => (a.severityRank - b.severityRank) || (a.score - b.score) },
  'importance': { label: 'Overall importance', fn: (a, b) => b.score - a.score },
  'most-frequent': { label: 'Happens most often', fn: (a, b) => b.firings - a.firings },
  'most-returns': { label: 'Comes back the most', fn: (a, b) => b.repeats - a.repeats || b.score - a.score },
  'newest': { label: 'Most recent', fn: (a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) },
};

export function sortIncidents(incidents, key) {
  const opt = SORT_OPTIONS[key] || SORT_OPTIONS['critical-first'];
  return [...incidents].sort(opt.fn);
}
