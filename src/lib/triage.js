import { SYSTEM_MNEMONICS } from './parseTrainTracer.js';

/* ============================================================================
 * CM AUTOPILOT — Triage engine
 * ----------------------------------------------------------------------------
 * THE PROBLEM
 * A single week of TrainTracer log for one trainset is ~10,000 rows. A
 * technician sits at a laptop and scrolls it. Most of it is the same fault
 * firing over and over ("fault storms") plus TCMS housekeeping chatter. The
 * real actionable defects are buried.
 *
 * WHAT THIS DOES
 *  1. NOISE FILTER   Strips TCMS lifecycle events (EQAPP / POWON / RESIP /
 *                    EQDIS). In the reference dataset these were 14,346 of
 *                    79,317 events (18%) and none of them is a defect.
 *                    Counted and reversible - never silently deleted.
 *
 *  2. STORM COLLAPSE Groups repeated firings of the same mnemonic, on the same
 *                    trainset, at the same location, into ONE INCIDENT, as long
 *                    as consecutive firings are within STORM_GAP_MIN of each
 *                    other. 400 rows of "E_BRK_FSB_1" become one line that
 *                    says "fired 400x over 6 h".
 *
 *  3. ACTIVE WINDOW  Pairs Active -> Inactive transitions to measure how long
 *                    the fault was actually standing.
 *
 *  4. PRIORITY SCORE Ranks what to fix first. Deliberately simple and
 *                    explainable - you must be able to defend it in a room:
 *
 *        score = SEV x (1 + ln(1 + firings)) x RECENCY x PERSISTENCE
 *
 *        SEV          Critical 100 | Major 40 | Minor 10 | Information 1
 *                     (straight from the SeverityName field - not invented)
 *        firings      how many times it fired (a fault that fires 400x is a
 *                     real defect; one that fired once may be a glitch)
 *        RECENCY      1.0 if seen in the last 7 days, decaying to 0.3 at 90 d
 *                     (an old cleared fault is not today's problem)
 *        PERSISTENCE  1.5 if the fault was still ACTIVE at the end of the log
 *
 *     Every term is visible in the UI so the engineer can argue with it.
 * ==========================================================================*/

export const DEFAULTS = {
  hideSystemEvents: true,   // EQAPP / POWON / RESIP / EQDIS
  hideInformation: true,    // SeverityName == "Information"
  stormGapMin: 60,          // minutes; firings closer than this = one incident
};

const SEV_WEIGHT = { Critical: 100, Major: 40, Minor: 10, Information: 1 };
export const SEV_ORDER = ['Critical', 'Major', 'Minor', 'Information'];

function recencyFactor(lastMs, nowMs) {
  const days = (nowMs - lastMs) / 86400000;
  if (days <= 7) return 1.0;
  if (days >= 90) return 0.3;
  return 1.0 - 0.7 * ((days - 7) / 83);
}

export function triage(events, opts = DEFAULTS) {
  const stats = {
    total: events.length,
    systemFiltered: 0,
    infoFiltered: 0,
  };

  let working = events;

  if (opts.hideSystemEvents) {
    const before = working.length;
    working = working.filter((e) => !SYSTEM_MNEMONICS.has(e.mnemonic));
    stats.systemFiltered = before - working.length;
  }
  if (opts.hideInformation) {
    const before = working.length;
    working = working.filter((e) => e.severity !== 'Information');
    stats.infoFiltered = before - working.length;
  }

  // ---- Storm collapse -----------------------------------------------------
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
      const first = group[0];
      const last = group[group.length - 1];
      const wasActive = group.some((g) => g.status === 'Active');
      const endedActive = last.status === 'Active';
      incidents.push({
        id: `${key}|${first.occurrence}`,
        trainset: first.trainset,
        mnemonic: first.mnemonic,
        tcode: first.tcode,
        description: first.description,
        severity: first.severity,
        hint: first.hint,
        fn: first.fn,
        location: first.location,
        locationCode: first.locationCode,
        stack: first.stack,
        firstSeen: first.occurrence,
        lastSeen: last.occurrence,
        firings: group.reduce((s, g) => s + (g.counter || 1), 0),
        rows: group.length,
        wasActive,
        endedActive,
        durationMs: (last.occurrence ?? 0) - (first.occurrence ?? 0),
        traces: (group.find((g) => g.traces?.length) || first).traces || [],
        traceHeaders: first.traceHeaders || [],
        sourceFiles: [...new Set(group.map((g) => g.sourceFile))],
      });
    };

    for (let i = 1; i < list.length; i++) {
      const prev = group[group.length - 1];
      if ((list[i].occurrence ?? 0) - (prev.occurrence ?? 0) <= gapMs) {
        group.push(list[i]);
      } else {
        flush();
        group = [list[i]];
      }
    }
    flush();
  }

  // ---- Repeat-offender detection ------------------------------------------
  // A fault that fires 400x in one afternoon is ONE incident. A fault that
  // comes back on five SEPARATE occasions weeks apart is a bad actor — the
  // defect was never really fixed. That distinction is the whole game, and it
  // is invisible in Excel. We count how many distinct incidents share the same
  // (trainset, mnemonic, location) and flag it.
  const repeatCount = new Map();
  for (const inc of incidents) {
    const k = `${inc.trainset}|${inc.mnemonic}|${inc.location}`;
    repeatCount.set(k, (repeatCount.get(k) || 0) + 1);
  }
  for (const inc of incidents) {
    const k = `${inc.trainset}|${inc.mnemonic}|${inc.location}`;
    inc.repeats = repeatCount.get(k);
  }

  // ---- Priority score -----------------------------------------------------
  const nowMs = Math.max(...incidents.map((i) => i.lastSeen ?? 0), 0);
  for (const inc of incidents) {
    const sev = SEV_WEIGHT[inc.severity] ?? 1;
    const rec = 1 + Math.log(1 + inc.firings);                    // recurrence within an incident
    const age = recencyFactor(inc.lastSeen ?? nowMs, nowMs);       // how recent
    const per = inc.endedActive ? 1.5 : 1.0;                       // still standing?
    const rpt = Math.min(1 + 0.25 * (inc.repeats - 1), 2.5);       // bad actor?
    inc.score = sev * rec * age * per * rpt;
    inc.scoreParts = {
      sev,
      rec: +rec.toFixed(2),
      age: +age.toFixed(2),
      per,
      rpt: +rpt.toFixed(2),
    };
  }

  incidents.sort((a, b) => b.score - a.score);

  stats.incidents = incidents.length;
  stats.badActors = [...new Set(incidents.filter((i) => i.repeats >= 3)
    .map((i) => `${i.trainset}|${i.mnemonic}|${i.location}`))].length;
  stats.collapsed = working.length - incidents.length;
  stats.trainsets = [...new Set(incidents.map((i) => i.trainset))].sort();
  stats.window = incidents.length
    ? { from: Math.min(...incidents.map((i) => i.firstSeen)), to: nowMs }
    : null;

  return { incidents, stats };
}

/** Rollups for the dashboard tiles. */
export function summarise(incidents) {
  const bySeverity = {};
  const byFunction = {};
  const byTrainset = {};
  for (const i of incidents) {
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
    byFunction[i.fn || 'Unknown'] = (byFunction[i.fn || 'Unknown'] || 0) + 1;
    byTrainset[i.trainset] = (byTrainset[i.trainset] || 0) + 1;
  }
  return { bySeverity, byFunction, byTrainset };
}

export function fmtDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
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
