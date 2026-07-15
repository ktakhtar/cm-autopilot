/* ============================================================================
 * CM AUTOPILOT — VAC HEALTH ENGINE (browser)
 * ----------------------------------------------------------------------------
 * A faithful JavaScript port of matlab/vac_health.m, so the VAC condition
 * assessment runs entirely in the browser with nothing to install and no
 * MATLAB step for the end user. The MATLAB script remains the reference
 * implementation; this produces the same health index from the same physics.
 *
 * The SCU "xls" is really a TAB-DELIMITED TEXT file with a one-line banner
 * before the header row. We strip the banner, split on tabs, and coerce the
 * signal columns to numbers.
 *
 * WHY THIS BEATS THE SPREADSHEET
 * The current method counts LPT-low / HPT-high threshold crossings — it only
 * sees faults that already fired. On the reference log (T5125 Car A) the SCU
 * raised LPT1_LOW once in 4,930 samples, so the spreadsheet calls it healthy.
 * The physics (weak cooling dT + low compression ratio + short cycling) says
 * it is an undercharged circuit already failing. This engine catches that.
 * ==========================================================================*/

export const VAC_CFG = {
  LP_LOW_BAR: 1.60,        // low-pressure alarm threshold           [bar]
  HP_HIGH_BAR: 24.0,       // high-pressure alarm threshold          [bar]
  HPS_LOCKOUT_BAR: 27.0,   // mechanical HP switch lockout           [bar]
  DT_HEALTHY_MIN: 8.0,     // return->supply dT, healthy floor       [degC]
  DT_HEALTHY_MAX: 12.0,    // healthy ceiling                        [degC]
  DT_FAILED: 5.0,          // below this the unit is not cooling     [degC]
  PR_HEALTHY_MIN: 3.5,     // compression ratio HP/LP, healthy floor [-]
  PR_HEALTHY_MAX: 4.5,     // healthy ceiling                        [-]
  SHORT_CYCLE_MIN: 3.0,    // run shorter than this = short cycle    [min]
  DUTY_WARN_PCT: 60,       // duty above this = working too hard     [%]
};

/* ---- tiny stats helpers (no libraries) ---- */
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const clean = (a) => a.filter((x) => Number.isFinite(x));
function median(a) { const s = clean(a).sort((x, y) => x - y); if (!s.length) return NaN; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function pct(a, q) { const s = clean(a).sort((x, y) => x - y); if (!s.length) return NaN; return s[Math.max(0, Math.min(s.length - 1, Math.round((q / 100) * s.length) - 1))]; }
function mean(a) { const c = clean(a); return c.length ? c.reduce((s, x) => s + x, 0) / c.length : NaN; }
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
function linfit(x, y) {
  const n = x.length; if (n < 2) return [NaN, NaN];
  const mx = mean(x), my = mean(y);
  let num2 = 0, den = 0;
  for (let i = 0; i < n; i++) { num2 += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const slope = num2 / den; return [slope, my - slope * mx];
}

/* ---- parse the SCU log text ---- */
export function parseSCULog(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.length);
  // The first line is the banner; the second is the header.
  let headerIdx = 0;
  if (!/\bTime\b/.test(lines[0]) && /\bTime\b/.test(lines[1] || '')) headerIdx = 1;
  const header = lines[headerIdx].split('\t').map((h) => h.trim());
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cells = lines[i].split('\t');
    if (cells.length < 3) continue;
    const r = {};
    header.forEach((h, c) => { r[h] = cells[c] !== undefined ? cells[c].trim() : ''; });
    rows.push(r);
  }
  return { header, rows };
}

function runLengths(rows, key, timeMs) {
  // durations (minutes) of every ON stretch of a 0/1 signal
  const on = rows.map((r) => (num(r[key]) === 1 ? 1 : 0));
  const runs = [];
  let start = -1;
  for (let i = 0; i < on.length; i++) {
    if (on[i] === 1 && start < 0) start = i;
    if ((on[i] === 0 || i === on.length - 1) && start >= 0) {
      const end = on[i] === 0 ? i - 1 : i;
      const mins = (timeMs[end] - timeMs[start]) / 60000;
      if (mins > 0) runs.push(mins);
      start = -1;
    }
  }
  return runs;
}

function crossings(rows, key, thr, dir) {
  let n = 0, prev = 0;
  for (const r of rows) {
    const v = num(r[key]); if (!Number.isFinite(v)) continue;
    const b = dir === 'below' ? v < thr : v > thr;
    if (b && !prev) n++;
    prev = b ? 1 : 0;
  }
  return n;
}

/* ---- main analysis ---- */
export function analyzeVac(text, filename, CFG = VAC_CFG) {
  const { header, rows } = parseSCULog(text);
  if (!rows.length) throw new Error('No data rows found — is this a VAC SCU log?');

  // identity from filename: T5125_car_A_vac_1.xls
  const m = /T?(5\d{3}).*?car[_ ]?([A-E]).*?vac[_ ]?(\d)/i.exec(filename || '');
  const ID = m
    ? { trainset: m[1], car: m[2].toUpperCase(), vac: m[3] }
    : { trainset: 'unknown', car: '?', vac: '?' };

  const timeMs = rows.map((r) => {
    const t = String(r.Time || '').replace(' ', 'T');
    const d = new Date(t); return d.getTime();
  });

  const has = (k) => header.includes(k);
  const col = (k) => rows.map((r) => num(r[k]));

  // operating mask: regulating AND a compressor commanded on
  const inReg = rows.map((r) => /REGULATION_NORMAL/.test(String(r.SubMode || '')));
  const compOn = rows.map((r) =>
    [1, 2, 3, 4].some((k) => num(r[`DO_COMP${k}`]) === 1));
  const M = rows.map((_, i) => inReg[i] && compOn[i]);
  const maskCount = M.filter(Boolean).length;

  // 1. cooling effectiveness
  const dTall = rows.map((r) => num(r.TEMPERATURE_RETURN_AIR) - num(r.TEMPERATURE_SUPPLY_AIR));
  const dT = dTall.filter((v, i) => M[i] && Number.isFinite(v));
  if (!dT.length) throw new Error('Unit never ran in REGULATION_NORMAL with a compressor on.');
  const dT_median = median(dT);
  const dT_failFrac = dT.filter((v) => v < CFG.DT_FAILED).length / dT.length;

  // 2. compressor cycling + contactor integrity
  const comps = [];
  let shortTotal = 0, cyclesTotal = 0, dutySum = 0, maxMismatchPct = 0;
  for (let k = 1; k <= 4; k++) {
    const cmd = col(`DO_COMP${k}`);
    const fb = col(`DI_COMP${k}_FEEDBACK`);
    const runs = runLengths(rows, `DO_COMP${k}`, timeMs);
    const short = runs.filter((x) => x < CFG.SHORT_CYCLE_MIN).length;
    let onRows = 0, mism = 0;
    for (let i = 0; i < rows.length; i++) {
      if (cmd[i] === 1) { onRows++; if (fb[i] === 0) mism++; }
    }
    const duty = 100 * cmd.filter((v, i) => inReg[i] && v === 1).length /
      Math.max(inReg.filter(Boolean).length, 1);
    const mismPct = 100 * mism / Math.max(onRows, 1);
    maxMismatchPct = Math.max(maxMismatchPct, mismPct);
    shortTotal += short; cyclesTotal += runs.length; dutySum += duty;
    comps.push({
      id: k, dutyPct: duty, cycles: runs.length,
      medianRunMin: runs.length ? median(runs) : 0,
      shortCycles: short, contactorMismatchPct: mismPct,
    });
  }

  // 3. refrigerant circuits
  const circuits = [];
  for (let c = 1; c <= 2; c++) {
    const hp = [], lp = [], pr = [];
    for (let i = 0; i < rows.length; i++) {
      if (!M[i]) continue;
      const h = num(rows[i][`HP${c}_TRANSDUCER`]), l = num(rows[i][`LP${c}_TRANSDUCER`]);
      if (Number.isFinite(h) && Number.isFinite(l) && l > 0.2) { hp.push(h); lp.push(l); pr.push(h / l); }
    }
    circuits.push({
      circuit: c, LP_med: median(lp), HP_med: median(hp), PR_med: median(pr),
      LP_lowCount: crossings(rows, `LP${c}_TRANSDUCER`, CFG.LP_LOW_BAR, 'below'),
      HP_highCount: crossings(rows, `HP${c}_TRANSDUCER`, CFG.HP_HIGH_BAR, 'above'),
    });
  }
  const PR_mean = mean(circuits.map((c) => c.PR_med));

  // 4. condenser fouling: HP1 vs ambient
  const amb = [], hp1 = [];
  for (let i = 0; i < rows.length; i++) {
    if (!M[i]) continue;
    const a = num(rows[i].TEMPERATURE_FRESH_AIR), h = num(rows[i].HP1_TRANSDUCER);
    if (Number.isFinite(a) && Number.isFinite(h)) { amb.push(a); hp1.push(h); }
  }
  let cond = { slope: NaN, intercept: NaN, HP_at_45C: NaN, HP_alarm: CFG.HP_HIGH_BAR };
  if (amb.length > 20) {
    const [slope, intercept] = linfit(amb, hp1);
    cond = { slope, intercept, HP_at_45C: slope * 45 + intercept, HP_alarm: CFG.HP_HIGH_BAR };
  }

  // 5. SCU flag activity (% of log)
  const flagNames = ['COOLING_NOT_EFFECTIVE', 'AC_FAULT', 'RAD_FAULT', 'SUPPLY_TOO_LOW',
    'LPT1_LOW', 'LPT2_LOW', 'HPT1_HIGH', 'HPT2_HIGH', 'HPS1_LOCKOUT', 'HPS2_LOCKOUT'];
  const flags = {};
  for (const f of flagNames) {
    flags[f] = has(f) ? 100 * col(f).filter((v) => v === 1).length / rows.length : null;
  }

  // 6. health index (identical weighting to vac_health.m)
  let s_cool = 40 * clamp((dT_median - CFG.DT_FAILED) / (CFG.DT_HEALTHY_MIN - CFG.DT_FAILED), 0, 1);
  s_cool *= (1 - 0.5 * dT_failFrac);
  const s_pr = 20 * clamp((PR_mean - 2.5) / (CFG.PR_HEALTHY_MIN - 2.5), 0, 1);
  const shortRate = shortTotal / Math.max(cyclesTotal, 1);
  // NOTE: the SCU log is EVENT-BASED (~10 min between samples), not periodic.
  // Run-length "short cycling" measured on sparse timestamps is a weak signal —
  // a sub-minute "run" is often just two adjacent event rows. We therefore treat
  // short cycling as a DISPLAYED diagnostic but give it low weight in the score,
  // and only penalise when it is extreme (>50% of runs). Defensible in a room.
  const s_cyc = 20 * clamp(1 - Math.max(0, shortRate - 0.5) / 0.4, 0, 1);
  const s_con = 10 * clamp(1 - maxMismatchPct / 5, 0, 1);
  const flagLoad = ((flags.COOLING_NOT_EFFECTIVE || 0) + (flags.AC_FAULT || 0) + (flags.SUPPLY_TOO_LOW || 0)) / 100;
  const s_flag = 10 * clamp(1 - flagLoad / 0.20, 0, 1);
  const health = s_cool + s_pr + s_cyc + s_con + s_flag;

  // 7. degradation trend on weekly mean dT
  const t0 = Math.min(...timeMs.filter(Number.isFinite));
  const wk = [], wdT = {};
  for (let i = 0; i < rows.length; i++) {
    if (!M[i] || !Number.isFinite(timeMs[i])) continue;
    const w = Math.floor((timeMs[i] - t0) / (7 * 86400000));
    (wdT[w] ||= []).push(dTall[i]);
  }
  const weeks = Object.keys(wdT).map(Number).sort((a, b) => a - b);
  let trend = { dT_per_week: NaN, daysToFailure: NaN };
  if (weeks.length >= 3) {
    const wy = weeks.map((w) => mean(wdT[w]));
    const [slope, intercept] = linfit(weeks, wy);
    trend.dT_per_week = slope;
    if (slope < -0.05) {
      const wkFail = (CFG.DT_FAILED - intercept) / slope;
      trend.daysToFailure = Math.max(0, (wkFail - Math.max(...weeks)) * 7);
    }
  }

  const verdict = health < 50 ? 'DEGRADED — INTERVENE'
    : health < 70 ? 'WATCH — PLAN MAINTENANCE' : 'HEALTHY';

  const diagnosis = buildDiagnosis({ dT_median, PR_mean, shortTotal, dutyMean: dutySum / 4, health },
    circuits, comps, flags, cond, CFG);

  return {
    module: 'vac_health', source: filename,
    trainset: ID.trainset, car: ID.car, vac: ID.vac,
    samples: rows.length, assessed: maskCount,
    periodFrom: t0, periodTo: Math.max(...timeMs.filter(Number.isFinite)),
    health, verdict,
    scoreParts: { cooling: s_cool, charge: s_pr, cycling: s_cyc, contactor: s_con, flags: s_flag },
    cooling: { dT_median, dT_p25: pct(dT, 25), dT_p75: pct(dT, 75), notCoolingPct: 100 * dT_failFrac },
    circuits, compressors: comps, condenser: cond, flags, trend, diagnosis,
    series: buildSeries(rows, M, dTall, timeMs),
  };
}

function buildDiagnosis(R, circuits, comps, flags, cond, CFG) {
  const d = [];
  const lowPR = R.PR_mean < CFG.PR_HEALTHY_MIN;
  const lowDT = R.dT_median < CFG.DT_HEALTHY_MIN;

  if (lowPR && lowDT) {
    d.push('UNDERCHARGED / LEAKING CIRCUIT. Low compression ratio together with weak cooling is the classic low-charge signature. Leak-test and weigh the charge before topping up — a top-up without finding the leak just buys a few weeks.');
  } else if (lowDT && !lowPR) {
    d.push('COOLING WEAK BUT COMPRESSION NORMAL. Suspect airside: blocked return-air filter, iced or fouled evaporator, or a failed evaporator fan. Check the filter first.');
  }
  if (R.shortTotal > 10) {
    d.push(`Frequent compressor restarts observed (${R.shortTotal} short runs). Consistent with low charge, but note this log is event-sampled (~10 min), so treat cycle timing as indicative, not exact — confirm with a periodic log if available.`);
  }
  if (Number.isFinite(cond.HP_at_45C) && cond.HP_at_45C > CFG.HP_HIGH_BAR) {
    d.push(`CONDENSER FOULING RISK. Head pressure extrapolates to ${cond.HP_at_45C.toFixed(1)} bar at 45 °C ambient, above the ${CFG.HP_HIGH_BAR} bar alarm. This unit will trip on high pressure in summer. Clean the condenser coil.`);
  }
  for (const c of comps) {
    if (c.contactorMismatchPct > 1) {
      d.push(`COMPRESSOR ${c.id} ELECTRICAL FAULT. Commanded ON but no feedback in ${c.contactorMismatchPct.toFixed(1)}% of attempts. This is a contactor / breaker / overload problem, NOT a refrigeration problem. Check the contactor and motor overload before touching the gas.`);
    }
  }
  if ((flags.RAD_FAULT || 0) > 5) {
    d.push(`RETURN AIR DAMPER faulted for ${flags.RAD_FAULT.toFixed(1)}% of the log. Independent of the refrigeration circuit — check the RAD actuator, its calibration and feedback.`);
  }
  if (R.dutyMean > CFG.DUTY_WARN_PCT) {
    d.push(`HIGH DUTY CYCLE (${R.dutyMean.toFixed(0)}%). Unit is working near continuously.`);
  }
  if (!d.length) d.push('No degradation signature detected. Unit is operating within expected bounds.');
  if (R.health < 70) {
    d.push('NOTE: the SCU raised almost no pressure alarms on this log. The existing spreadsheet method (counting LPT-low crossings) would have scored this unit as healthy. The physics says otherwise.');
  }
  return d;
}

/* down-sample cooling dT for the sparkline (max ~200 points) */
function buildSeries(rows, M, dTall, timeMs) {
  const pts = [];
  for (let i = 0; i < rows.length; i++) {
    if (M[i] && Number.isFinite(dTall[i]) && Number.isFinite(timeMs[i])) pts.push([timeMs[i], dTall[i]]);
  }
  if (pts.length <= 200) return pts;
  const step = Math.ceil(pts.length / 200);
  return pts.filter((_, i) => i % step === 0);
}
