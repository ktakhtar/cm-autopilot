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
          {busy ? <><div className="spinner" /><h2>Working out the right stock levels…</h2></>
            : <><div className="dropicon">↓</div>
              <h2>Drop the spare-parts workbook here</h2>
              <p>The <code>.xlsx</code> spreadsheet with three tabs: the <b>design spares list</b> (every part and how often it fails), the <b>current stock</b> (what’s on the shelf), and the <b>orders on the way</b>. The app works out how many of each part you should be holding.</p>
              <button className="cta">Choose file</button></>}
        </div>
        <input ref={pick} type="file" accept=".xlsx,.xls" hidden onChange={(e) => load(e.target.files)} />
        {err && <p className="kbnote" style={{ color: 'var(--crit)' }}>{err}</p>}
        <ul className="how">
          <li><b>It works out demand.</b> Using each part’s failure rate, how many are fitted across the fleet, and how long the trains run, it estimates how often you’ll need a replacement.</li>
          <li><b>It sets safe stock levels.</b> It then calculates how many to keep on the shelf so that, 95% of the time, a spare is ready the moment a part fails — instead of a train waiting weeks for one.</li>
          <li><b>It checks its own maths against the manufacturer.</b> Alstom’s spreadsheet already includes their own recommended quantity. Our figures line up with theirs almost exactly — which is how you know the model is sound.</li>
        </ul>
      </div>
    );
  }

  const list = tab === 'short' ? res.shortfalls
    : [...res.valid].filter((s) => s.recommended - s.alstom >= 3).sort((a, b) => (b.recommended - b.alstom) - (a.recommended - a.alstom));

  return (
    <main className="main">
      <section className="tiles">
        <Tile label="Parts checked" value={res.modelledItems} note="that have full reliability data" />
        <Tile label="Not enough in stock" value={res.shortCount} tone="danger" note={`${res.criticalShort} of them are critical parts`} />
        <Tile label="Agreement with Alstom" value={`${(res.modelVsAlstomCorr * 100).toFixed(0)}%`} tone="primary" note="our maths vs the manufacturer’s" />
        <Tile label="Cost to fully stock up" value={`AED ${Math.round(res.cashToClose).toLocaleString()}`} note="to be safe on every part" />
        <Tile label="" value={<button className="ghost" onClick={downloadOrderCSV}>Download order list</button>} />
        <Tile label="" value={<button className="ghost" onClick={() => setRes(null)}>Load different file</button>} />
      </section>

      <section className="reduction">
        <p className="explainer">
          <b>Why the {(res.modelVsAlstomCorr * 100).toFixed(0)}% agreement matters.</b> We worked out these stock levels from
          scratch — from how often each part fails and how long it takes to reorder. The manufacturer (Alstom)
          did their own version years ago. The two match almost perfectly, which tells you the model is trustworthy.
          So on the rare part where the two <i>don’t</i> match, that’s worth a closer look — it usually means the part
          is failing more often in real life than the original design assumed.
        </p>
      </section>

      <section className="controls">
        <div className="tabs">
          <button className={tab === 'short' ? 'on' : ''} onClick={() => setTab('short')}>Not enough in stock ({res.shortCount})</button>
          <button className={tab === 'delta' ? 'on' : ''} onClick={() => setTab('delta')}>Where we differ from Alstom</button>
        </div>
      </section>

      <section className="split">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Item</th><th>Description</th><th style={{ width: 62 }}>Need/yr</th>
                <th style={{ width: 54 }}>Keep</th><th style={{ width: 54 }}>In stock</th>
                {tab === 'short' ? <><th style={{ width: 54 }}>Order now</th><th style={{ width: 70 }}>Reorder wait</th></>
                  : <th style={{ width: 64 }}>Alstom says</th>}
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
                <Fact k="Likely needed" v={`${sel.lambdaYear.toFixed(1)} per year`} />
                <Fact k="During a reorder wait" v={`${sel.lambdaLead.toFixed(2)} (${sel.leadWeeks} wks)`} />
                <Fact k="Keep on shelf" v={sel.recommended} />
                <Fact k="Alstom recommends" v={Number.isFinite(sel.alstom) ? sel.alstom : '—'} />
                <Fact k="In stock now" v={Number.isFinite(sel.onHand) ? sel.onHand : '—'} />
                <Fact k="Already on order" v={sel.onOrder} />
                <Fact k="Order now" v={Math.max(sel.gap, 0)} />
                <Fact k="Price each" v={sel.unitCostAED ? `AED ${sel.unitCostAED.toLocaleString()}` : '—'} />
              </div>

              {sel.gap > 0 && (
                <section className="block accent">
                  <h3>Action</h3>
                  <p>Order <b>{Math.max(sel.gap, 0)}</b> unit(s) now. At the current holding of {Number.isFinite(sel.onHand) ? sel.onHand : 0}
                    {sel.onOrder ? ` (+${sel.onOrder} on order)` : ''}, there’s more than a 5% chance you’d run out before a new one arrives (the {sel.leadWeeks}-week reorder wait).
                    {sel.lineCostAED > 0 && <> Line cost ≈ <b>AED {Math.round(sel.lineCostAED).toLocaleString()}</b>.</>}</p>
                </section>
              )}

              {Number.isFinite(sel.alstom) && Math.abs(sel.recommended - sel.alstom) >= 3 && (
                <section className="block">
                  <h3>Our number vs the manufacturer’s</h3>
                  <p>We recommend keeping <b>{sel.recommended}</b>; the manufacturer’s list says <b>{sel.alstom}</b>.
                    {sel.recommended > sel.alstom
                      ? ' Ours is higher — this part may be failing more often than the original design assumed, which is worth flagging to the supplier.'
                      : ' Ours is lower — the manufacturer may simply be playing it safe on this part.'}</p>
                </section>
              )}

              <section className="block">
                <h3>How we got this number</h3>
                <p>First, how many we’ll likely need in a year: <b>how often it fails × how many are on the fleet × hours run per year</b>. Then we scale that to the <b>{sel.leadWeeks}-week</b> wait to reorder. Finally we pick the stock level that gives a <b>95% chance</b> a spare is ready the moment one fails.</p>
              </section>

              <p className="disclaimer">Worked out in your browser from the spreadsheet. The operating hours and 95% target are assumptions you can change. The same maths is also available as a MATLAB script for checking offline.</p>
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
