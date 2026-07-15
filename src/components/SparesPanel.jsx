import React, { useState, useRef } from 'react';
import { analyzeSpares } from '../lib/spares.js';

/* Spares Predictor tab. Drop the CM spares workbook (.xlsx) and the Poisson
 * base-stock model runs in the browser. matlab/spares_predictor.m is the twin. */

export default function SparesPanel() {
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState('short');
  const pick = useRef();

  async function load(files) {
    const f = Array.from(files).find((x) => /\.(xlsx|xls)$/i.test(x.name));
    if (!f) { setErr('Drop the CM spares workbook (.xlsx).'); return; }
    setBusy(true); setErr(null);
    try {
      const buf = await f.arrayBuffer();
      const r = analyzeSpares(buf);
      setRes(r); setSel(r.shortfalls[0] || null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  }

  function downloadOrderCSV() {
    const rows = [['Item', 'Description', 'Criticality', 'ExpectedFailuresPerYear',
      'Recommended95', 'OnHand', 'OnOrder', 'OrderQty', 'LeadWeeks', 'UnitCostAED', 'LineCostAED']];
    for (const s of res.shortfalls) {
      rows.push([s.item, `"${s.desc}"`, s.criticality, s.lambdaYear.toFixed(2),
        s.recommended, s.onHand, s.onOrder, Math.max(s.gap, 0), s.leadWeeks,
        s.unitCostAED.toFixed(2), s.lineCostAED.toFixed(2)]);
    }
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'spares_order_list.csv'; a.click();
  }

  if (!res) {
    return (
      <div className="landing">
        <div className="drop" onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); load(e.dataTransfer.files); }}
          onClick={() => pick.current.click()}>
          {busy ? <><div className="spinner" /><h2>Running the reliability model…</h2></>
            : <><div className="dropicon">↓</div>
              <h2>Drop the CM spares workbook here</h2>
              <p>The <code>.xlsx</code> with the DLP reliability sheet, inventory balance and PRF status. A Poisson base-stock model runs right here in your browser.</p>
              <button className="cta">Choose file</button></>}
        </div>
        <input ref={pick} type="file" accept=".xlsx,.xls" hidden onChange={(e) => load(e.target.files)} />
        {err && <p className="kbnote" style={{ color: 'var(--crit)' }}>{err}</p>}
        <ul className="how">
          <li><b>Demand as physics.</b> Failure rate × fleet population × operating hours → expected demand over each part's lead time.</li>
          <li><b>Base-stock model.</b> Poisson service level tells you how many to hold so a failure doesn't strand a train.</li>
          <li><b>Validated against Alstom.</b> The model reproduces the manufacturer's own recommendation — so disagreements are findings.</li>
        </ul>
      </div>
    );
  }

  const list = tab === 'short' ? res.shortfalls
    : [...res.valid].filter((s) => s.recommended - s.alstom >= 3).sort((a, b) => (b.recommended - b.alstom) - (a.recommended - a.alstom));

  return (
    <main className="main">
      <section className="tiles">
        <Tile label="Items modelled" value={res.modelledItems} note="with full reliability data" />
        <Tile label="Below service level" value={res.shortCount} tone="danger" note={`${res.criticalShort} critical`} />
        <Tile label="Model vs Alstom" value={`r = ${res.modelVsAlstomCorr.toFixed(2)}`} tone="primary" note="independent agreement" />
        <Tile label="Cash to close gaps" value={`AED ${Math.round(res.cashToClose).toLocaleString()}`} note="at 95% service level" />
        <Tile label="" value={<button className="ghost" onClick={downloadOrderCSV}>Download order list</button>} />
        <Tile label="" value={<button className="ghost" onClick={() => setRes(null)}>Load different file</button>} />
      </section>

      <section className="controls">
        <div className="tabs">
          <button className={tab === 'short' ? 'on' : ''} onClick={() => setTab('short')}>Shortfalls ({res.shortCount})</button>
          <button className={tab === 'delta' ? 'on' : ''} onClick={() => setTab('delta')}>Model vs Alstom</button>
        </div>
      </section>

      <section className="split">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Description</th><th style={{ width: 62 }}>λ/yr</th>
                <th style={{ width: 54 }}>Rec</th><th style={{ width: 54 }}>Hand</th>
                {tab === 'short' ? <><th style={{ width: 54 }}>Order</th><th style={{ width: 70 }}>Lead</th></>
                  : <th style={{ width: 64 }}>Alstom</th>}
                <th style={{ width: 44 }} />
              </tr>
            </thead>
            <tbody>
              {list.slice(0, 200).map((s, i) => (
                <tr key={i} className={sel === s ? 'sel' : ''} onClick={() => setSel(s)}>
                  <td className="mn">{s.item}</td>
                  <td className="desc" style={{ maxWidth: 220 }}>{s.desc}</td>
                  <td className={s.lambdaYear > 10 ? 'hot' : 'dim'}>{s.lambdaYear.toFixed(1)}</td>
                  <td><b>{s.recommended}</b></td>
                  <td className={s.onHand === 0 ? 'hot' : ''}>{Number.isFinite(s.onHand) ? s.onHand : '—'}</td>
                  {tab === 'short'
                    ? <><td><span className="badactor">{Math.max(s.gap, 0)}</span></td><td className="dim">{s.leadWeeks}w</td></>
                    : <td className="dim">{s.alstom}</td>}
                  <td>{/^critical/i.test(s.criticality) && <span className="live" title="Critical part">C</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <aside className="panel">
          {sel && (
            <div className="card">
              <div className="cardhead">
                <div>
                  {/^critical/i.test(sel.criticality) && <span className="sev sev-critical">CRITICAL PART</span>}
                  <h2>{sel.item}</h2>
                  <p className="cdesc">{sel.desc}</p>
                </div>
              </div>

              <div className="facts">
                <Fact k="Expected demand" v={`${sel.lambdaYear.toFixed(1)} / year`} />
                <Fact k="Over lead time" v={`${sel.lambdaLead.toFixed(2)} (${sel.leadWeeks} wk)`} />
                <Fact k="Recommended (95%)" v={sel.recommended} />
                <Fact k="Alstom Poisson qty" v={Number.isFinite(sel.alstom) ? sel.alstom : '—'} />
                <Fact k="On hand" v={Number.isFinite(sel.onHand) ? sel.onHand : '—'} />
                <Fact k="On order" v={sel.onOrder} />
                <Fact k="Order now" v={Math.max(sel.gap, 0)} />
                <Fact k="Unit cost" v={sel.unitCostAED ? `AED ${sel.unitCostAED.toLocaleString()}` : '—'} />
              </div>

              {sel.gap > 0 && (
                <section className="block accent">
                  <h3>Action</h3>
                  <p>Order <b>{Math.max(sel.gap, 0)}</b> unit(s) now. At the current holding of {Number.isFinite(sel.onHand) ? sel.onHand : 0}
                    {sel.onOrder ? ` (+${sel.onOrder} on order)` : ''}, the chance a failure is <b>not</b> covered
                    from stock over the {sel.leadWeeks}-week lead time exceeds the 5% service threshold.
                    {sel.lineCostAED > 0 && <> Line cost ≈ <b>AED {Math.round(sel.lineCostAED).toLocaleString()}</b>.</>}</p>
                </section>
              )}

              {Number.isFinite(sel.alstom) && Math.abs(sel.recommended - sel.alstom) >= 3 && (
                <section className="block">
                  <h3>Model vs Alstom</h3>
                  <p>Our model recommends <b>{sel.recommended}</b>; Alstom's DLP lists <b>{sel.alstom}</b>.
                    {sel.recommended > sel.alstom
                      ? ' Our figure is higher — worth checking whether the design failure rate understates field experience for this part.'
                      : ' Our figure is lower — the DLP may be conservative here.'}</p>
                </section>
              )}

              <section className="block">
                <h3>How this number is derived</h3>
                <pre className="logic">{`μ(year) = failure_rate × population × ${20}h × 365d
μ(lead) = μ(year) × lead_weeks / 52
hold S  = smallest S with  P(demand ≤ S) ≥ 0.95
          (Poisson CDF)`}</pre>
              </section>

              <p className="disclaimer">Poisson base-stock model, computed in-browser. Operating hours and service level are assumptions (see the CONFIG block); matlab/spares_predictor.m is the reference twin.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Tile({ label, value, note, tone }) {
  return <div className={`tile ${tone || ''}`}><div className="tval">{value}</div><div className="tlab">{label}</div>{note && <div className="tnote">{note}</div>}</div>;
}
function Fact({ k, v }) { return <div className="fact"><span>{k}</span><b>{v}</b></div>; }
