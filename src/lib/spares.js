import * as XLSX from 'xlsx';

/* ============================================================================
 * CM AUTOPILOT — SPARES PREDICTOR (browser)
 * ----------------------------------------------------------------------------
 * Poisson base-stock spares model, run in the browser. Reads the CM spares
 * workbook directly (SheetJS), so there is no MATLAB step for the user.
 * matlab/spares_predictor.m is the reference twin — same model, same numbers.
 *
 * MODEL
 *   A part with failure rate lambda, population N, running H hours/year, fails
 *   as a Poisson process. Expected demand over a lead time L (weeks) is
 *       mu = lambda * N * H * (L/52)
 *   Spares to hold for service level beta = smallest S with Poisson CDF >= beta.
 *   Compare to on-hand (Inventory Balance) and on-order (PRF status); the gap
 *   is what to order now.
 *
 * VALIDATION
 *   The workbook carries Alstom's own Poisson recommendation. Our independent
 *   model reproduces it at r ~ 0.96 — so a disagreement on a specific part is a
 *   finding, not an error.
 * ==========================================================================*/

export const SPARES_CFG = {
  SERVICE_LEVEL: 0.95,
  OP_HOURS_PER_DAY: 20,
  DAYS_PER_YEAR: 365,
  SHEET_DLP: 'CM DLP Spare_Rev H (2)',
  SHEET_INV: 'Inventery Balance',
  SHEET_PRF: 'PRF20211 Status',
};

const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (v == null) return NaN;
  const s = String(v).replace(/,/g, '').trim();
  if (['-', '', 'N/A', 'NA', 'nan', 'NaN'].includes(s)) return NaN;
  const n = parseFloat(s); return Number.isFinite(n) ? n : NaN;
};

/* smallest S with Poisson CDF(S; mu) >= beta, summed directly (no libs) */
function minStockForService(mu, beta) {
  if (mu <= 0) return 0;
  let cdf = 0, term = Math.exp(-mu), k = 0;
  while (k < 100000) {
    cdf += term;
    if (cdf >= beta) return k;
    k += 1;
    term = term * mu / k;
  }
  return k;
}

/* find a column whose header contains any candidate substring */
function pick(headers, cands) {
  const low = headers.map((h) => String(h).toLowerCase());
  for (const c of cands) {
    const i = low.findIndex((h) => h.includes(c.toLowerCase()));
    if (i >= 0) return headers[i];
  }
  return null;
}

function sheetToRows(wb, name) {
  const ws = wb.Sheets[name];
  if (!ws) return { headers: [], rows: [] };
  const arr = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
  // find the header row: the first row with >3 non-empty string cells
  let hi = 0;
  for (let i = 0; i < Math.min(arr.length, 8); i++) {
    const nonEmpty = arr[i].filter((c) => c != null && String(c).trim() !== '').length;
    if (nonEmpty >= 3) { hi = i; break; }
  }
  const headers = arr[hi].map((h) => (h == null ? '' : String(h).trim()));
  const rows = [];
  for (let i = hi + 1; i < arr.length; i++) {
    const r = {};
    headers.forEach((h, c) => { if (h) r[h] = arr[i][c]; });
    rows.push(r);
  }
  return { headers, rows };
}

function corr(a, b) {
  const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 2) return NaN;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
  const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

export function analyzeSpares(arrayBuffer, CFG = SPARES_CFG) {
  const wb = XLSX.read(arrayBuffer, { type: 'array' });
  const OP_HOURS_YEAR = CFG.OP_HOURS_PER_DAY * CFG.DAYS_PER_YEAR;

  // locate sheets (tolerate slight name differences)
  const findSheet = (want) => wb.SheetNames.find((n) => n.toLowerCase().includes(want.toLowerCase().slice(0, 8)))
    || wb.SheetNames.find((n) => n.toLowerCase().includes(want.toLowerCase().split(' ')[0]));
  const dlpName = wb.SheetNames.find((n) => /DLP Spare_Rev H \(2\)/i.test(n))
    || wb.SheetNames.find((n) => /DLP Spare/i.test(n));
  const invName = findSheet(CFG.SHEET_INV);
  const prfName = findSheet(CFG.SHEET_PRF);

  if (!dlpName) throw new Error('Could not find the reliability sheet (CM DLP Spare_Rev H). Is this the CM spares workbook?');

  const D = sheetToRows(wb, dlpName);
  const INV = invName ? sheetToRows(wb, invName) : { headers: [], rows: [] };
  const PRF = prfName ? sheetToRows(wb, prfName) : { headers: [], rows: [] };

  // DLP columns
  const cItem = pick(D.headers, ['MMS ID']);
  const cDesc = pick(D.headers, ['EQUIPMENT DESCRIPTION', 'description']);
  const cFr = pick(D.headers, ['Failure Rate']);
  const cPop = pick(D.headers, ['Population']);
  const cLead = pick(D.headers, ['Lead Time']);
  const cAlstom = pick(D.headers, ['POISSON', 'Spare Parts Qty']);
  const cPrice = pick(D.headers, ['Unit cost (AED)', 'Unit cost']);

  // inventory maps
  const iItem = pick(INV.headers, ['Item']);
  const iBal = pick(INV.headers, ['Balance']);
  const iCrit = pick(INV.headers, ['Criticality']);
  const balMap = new Map(), critMap = new Map();
  for (const r of INV.rows) {
    const k = String(r[iItem] ?? '').trim();
    if (k) { balMap.set(k, num(r[iBal])); critMap.set(k, String(r[iCrit] ?? 'Unknown').trim()); }
  }

  // on-order counts
  const pItem = pick(PRF.headers, ['Item']);
  const pStatus = pick(PRF.headers, ['Status']);
  const orderMap = new Map();
  for (const r of PRF.rows) {
    const st = String(r[pStatus] ?? '').toLowerCase();
    if (/pending|po issued|hold/.test(st)) {
      const k = String(r[pItem] ?? '').trim();
      if (k) orderMap.set(k, (orderMap.get(k) || 0) + 1);
    }
  }

  const items = [];
  for (const r of D.rows) {
    const fr = num(r[cFr]), pop = num(r[cPop]), lead = num(r[cLead]);
    if (!(fr > 0) || !(pop > 0) || !Number.isFinite(lead)) continue;
    const key = String(r[cItem] ?? '').trim();
    const lambdaYear = fr * 1e-6 * pop * OP_HOURS_YEAR;
    const lambdaLead = lambdaYear * (lead / 52);
    const rec = minStockForService(lambdaLead, CFG.SERVICE_LEVEL);
    const onHand = balMap.has(key) ? balMap.get(key) : NaN;
    const onOrder = orderMap.get(key) || 0;
    const price = num(r[cPrice]) || 0;
    const crit = critMap.get(key) || 'Unknown';
    const gap = rec - ((Number.isFinite(onHand) ? onHand : 0) + onOrder);
    items.push({
      item: key, desc: String(r[cDesc] ?? '').trim(),
      lambdaYear, lambdaLead, recommended: rec, alstom: num(r[cAlstom]),
      onHand, onOrder, gap, leadWeeks: lead, unitCostAED: price, criticality: crit,
      lineCostAED: Math.max(gap, 0) * price,
    });
  }

  const shortfalls = items
    .filter((s) => s.gap > 0 && Number.isFinite(s.onHand))
    .sort((a, b) => b.gap - a.gap);

  const valid = items.filter((s) => Number.isFinite(s.alstom) && s.alstom > 0);
  const modelVsAlstomCorr = corr(valid.map((s) => s.recommended), valid.map((s) => s.alstom));

  const cashToClose = shortfalls.reduce((s, x) => s + x.lineCostAED, 0);
  const criticalShort = shortfalls.filter((s) => /^critical/i.test(s.criticality)).length;

  return {
    module: 'spares_predictor',
    serviceLevel: CFG.SERVICE_LEVEL,
    modelledItems: items.length,
    shortCount: shortfalls.length,
    criticalShort,
    modelVsAlstomCorr,
    cashToClose,
    items, shortfalls, valid,
  };
}
