import Papa from 'papaparse';

/* ============================================================================
 * CM AUTOPILOT — TrainTracer log parser
 * A TrainTracer CSV export is a nested structure: a PARENT row per fault event
 * followed by CHILD "trace" rows — a freeze-frame of every relevant signal at
 * T0-50 / T0 / T0+50 around the moment the fault fired.
 *
 * Two schemas exist:
 *   SCHEMA A (35 cols) - T5108 / T5117 / T5139. Traces have 3 values.
 *   SCHEMA B (33 cols) - T5112. Traces have 1 value, trainset on a child row.
 * Exports cap at ~65,000 rows, so one train = many files; we stitch and dedup.
 * ==========================================================================*/

const SYSTEM_MNEMONICS = new Set(['EQAPP', 'POWON', 'RESIP', 'EQDIS']);

function toDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?::(\d{1,3}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7] : 0);
}
function trainsetFromFilename(name) {
  const m = String(name).match(/T?(5\d{3})/);
  return m ? m[1] : null;
}

export function parseOneFile(text, filename) {
  const res = Papa.parse(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', delimiter: ',' });
  const rows = res.data;
  if (!rows.length) return { events: [], schema: null, warnings: ['Empty file'] };

  const header = rows[0].map((h) => String(h || '').trim());
  const idx = {};
  header.forEach((h, i) => { if (h && idx[h] === undefined) idx[h] = i; });

  const nCols = header.length;
  const schema = nCols >= 35 ? 'A' : 'B';
  const tracesCol = idx['Traces'];
  if (tracesCol === undefined) return { events: [], schema, warnings: [`${filename}: no "Traces" column — is this a TrainTracer export?`] };

  const traceValueCols = [];
  for (let c = tracesCol + 1; c < nCols; c++) traceValueCols.push(c);

  const fallbackTrainset = trainsetFromFilename(filename);
  const events = [];
  let current = null;
  const g = (r, name) => (idx[name] !== undefined ? String(r[idx[name]] ?? '').trim() : '');

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || !r.length) continue;
    const mnemonic = String(r[idx['Mnemonic'] ?? 0] ?? '').trim();

    if (mnemonic) {
      const occ = toDate(g(r, 'OccurenceDate'));
      current = {
        mnemonic, tcode: g(r, 'TCodeName'), description: g(r, 'Description'),
        category: g(r, 'CategoryName'), device: g(r, 'DeviceName'),
        counter: parseInt(g(r, 'Counter'), 10) || 1,
        occurrence: occ ? occ.getTime() : null,
        recorded: (toDate(g(r, 'RecordDate')) || {}).getTime?.() ?? null,
        hint: g(r, 'HintName'), severity: g(r, 'SeverityName'), fn: g(r, 'FunctionName'),
        location: g(r, 'LocationName'), locationCode: g(r, 'LocationCode'),
        localEventId: g(r, 'LocalEventId'), stack: g(r, 'StackName'),
        status: g(r, 'FaultStatus'), decorationError: g(r, 'DecorationError'),
        trainset: g(r, 'TrainSet.Id') || fallbackTrainset,
        traces: [], sourceFile: filename,
      };
      events.push(current);
    } else if (current) {
      const label = String(r[tracesCol] ?? '').trim();
      if (label) {
        const vals = traceValueCols.map((c) => String(r[c] ?? '').trim()).filter((v) => v !== '');
        if (vals.length) current.traces.push({ signal: label, values: vals });
      } else if (schema === 'B' && r[1] && /^\d{4}$/.test(String(r[1]).trim())) {
        current.trainset = String(r[1]).trim();
      }
    }
  }

  for (const e of events) {
    if (e.traces.length && /^ctx_/i.test(e.traces[0].signal)) {
      e.traceHeaders = e.traces[0].values;
      e.traces = e.traces.slice(1);
    } else {
      e.traceHeaders = schema === 'A' ? ['T0-50', 'T0', 'T0+50'] : ['Value'];
    }
    if (!e.trainset) e.trainset = fallbackTrainset;
  }
  return { events, schema, warnings: [] };
}

export async function parseFiles(fileList, onProgress) {
  const all = [], meta = [], warnings = [];
  for (let i = 0; i < fileList.length; i++) {
    const f = fileList[i];
    onProgress?.(i, fileList.length, f.name);
    const text = await f.text();
    const { events, schema, warnings: w } = parseOneFile(text, f.name);
    warnings.push(...w);
    meta.push({ name: f.name, schema, events: events.length, bytes: f.size });
    all.push(...events);
  }
  const seen = new Set(), unique = [];
  for (const e of all) {
    const key = `${e.trainset}|${e.mnemonic}|${e.occurrence}|${e.localEventId}|${e.location}`;
    if (seen.has(key)) continue;
    seen.add(key); unique.push(e);
  }
  unique.sort((a, b) => (a.occurrence ?? 0) - (b.occurrence ?? 0));
  return { events: unique, meta, warnings, duplicatesRemoved: all.length - unique.length };
}

export { SYSTEM_MNEMONICS };
