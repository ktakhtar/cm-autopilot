import { SYSTEM_MNEMONICS } from './parseTrainTracer.js';

/* ============================================================================
 * CM AUTOPILOT — Triage engine
 * Noise filter (TCMS housekeeping) -> storm collapse -> repeat-offender
 * detection -> transparent priority score.
 *
 *   score = SEV x recurrence x recency x persistence x repeat
 *
 * Every term is visible in the UI so the engineer can argue with it.
 * ==========================================================================*/

export const DEFAULTS = { hideSystemEvents: true, hideInformation: true, stormGapMin: 60 };
const SEV_WEIGHT = { Critical: 100, Major: 40, Minor: 10, Information: 1 };
export const SEV_ORDER = ['Critical', 'Major', 'Minor', 'Information'];

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

  incidents.sort((a, b) => b.score - a.score);

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
    byFunction[i.fn || 'Unknown'] = (byFunction[i.fn || 'Unknown'] || 0) + 1;
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
