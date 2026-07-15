import React, { useState, useRef } from 'react';
import { analyzeVac } from '../lib/vacHealth.js';

/* VAC health, fully in the browser. Drop the raw SCU log(s) — the tab-delimited
 * "xls" files straight off the train — and the physics runs here. No MATLAB step
 * for the user. (matlab/vac_health.m remains the reference engine.) */

export default function VacPanel() {
  const [units, setUnits] = useState([]);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const pick = useRef();

  async function load(files) {
    const list = Array.from(files).filter((f) => /\.(xls|csv|txt)$/i.test(f.name));
    if (!list.length) { setErr('Drop the raw SCU log files (the .xls exports from the train).'); return; }
    setBusy(true); setErr(null);
    const out = [];
    for (const f of list) {
      try {
        const text = await f.text();
        out.push(analyzeVac(text, f.name));
      } catch (e) { setErr(`${f.name}: ${e.message}`); }
    }
    out.sort((a, b) => a.health - b.health);
    setUnits(out); setSel(out[0] || null); setBusy(false);
  }

  const band = (h) => (h < 50 ? 'crit' : h < 70 ? 'warn' : 'ok');

  if (!units.length) {
    return (
      <div className="landing">
        <div className="drop" onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); load(e.dataTransfer.files); }}
          onClick={() => pick.current.click()}>
          {busy ? <><div className="spinner" /><h2>Analysing…</h2></>
            : <><div className="dropicon">↓</div>
              <h2>Drop VAC SCU logs here</h2>
              <p>The raw <code>.xls</code> logs straight off the train — one or many. The health engine runs right here in your browser.</p>
              <button className="cta">Choose files</button></>}
        </div>
        <input ref={pick} type="file" multiple accept=".xls,.csv,.txt" hidden onChange={(e) => load(e.target.files)} />
        {err && <p className="kbnote" style={{ color: 'var(--crit)' }}>{err}</p>}
        <ul className="how">
          <li><b>Physics, not alarm-counting.</b> Cooling ΔT, compression ratio, condenser fouling, contactor integrity — a 0–100 health index.</li>
          <li><b>Catches what the spreadsheet misses.</b> A unit can be degrading badly with almost no pressure alarms fired.</li>
          <li><b>Fleet view.</b> Drop every car's log in at once; worst-ranked first.</li>
        </ul>
      </div>
    );
  }

  return (
    <main className="main">
      <section className="tiles">
        <Tile label="Units assessed" value={units.length} />
        <Tile label="Degraded" tone="danger" value={units.filter((u) => u.health < 50).length} note="intervene now" />
        <Tile label="Watch" tone="danger" value={units.filter((u) => u.health >= 50 && u.health < 70).length} note="plan maintenance" />
        <Tile label="Healthy" tone="primary" value={units.filter((u) => u.health >= 70).length} />
        <Tile label="" value="" note="" />
        <Tile label="" value={<button className="ghost" onClick={() => setUnits([])}>Load different logs</button>} />
      </section>

      <section className="split">
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Unit</th><th style={{ width: 104 }}>Health</th><th style={{ width: 64 }}>ΔT</th>
                <th style={{ width: 64 }}>HP/LP</th><th style={{ width: 78 }}>Not cooling</th><th>Verdict</th></tr>
            </thead>
            <tbody>
              {units.map((u, i) => (
                <tr key={i} className={sel === u ? 'sel' : ''} onClick={() => setSel(u)}>
                  <td className="mn">T{u.trainset} · {u.car} · VAC{u.vac}</td>
                  <td><div className="hbar"><div className={`hfill h-${band(u.health)}`} style={{ width: `${u.health}%` }} /><span>{Math.round(u.health)}</span></div></td>
                  <td className={u.cooling.dT_median < 8 ? 'hot' : ''}>{u.cooling.dT_median?.toFixed(1)}</td>
                  <td>{(u.circuits.reduce((s, c) => s + c.PR_med, 0) / u.circuits.length).toFixed(2)}</td>
                  <td className={u.cooling.notCoolingPct > 15 ? 'hot' : ''}>{u.cooling.notCoolingPct?.toFixed(0)}%</td>
                  <td className={`v-${band(u.health)}`}>{u.verdict}</td>
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
                  <span className={`sev sev-${band(sel.health) === 'crit' ? 'critical' : band(sel.health) === 'warn' ? 'major' : 'information'}`}>{sel.verdict}</span>
                  <h2>T{sel.trainset} · Car {sel.car} · VAC{sel.vac}</h2>
                  <p className="cdesc">Health index <b>{sel.health.toFixed(1)} / 100</b> · {sel.assessed} of {sel.samples} samples assessed</p>
                </div>
              </div>

              <Spark series={sel.series} />

              <div className="facts">
                <Fact k="Cooling ΔT" v={`${sel.cooling.dT_median?.toFixed(2)} °C`} />
                <Fact k="Not cooling" v={`${sel.cooling.notCoolingPct?.toFixed(1)}% of run time`} />
                {sel.circuits.map((c) => (
                  <React.Fragment key={c.circuit}>
                    <Fact k={`Circuit ${c.circuit} LP/HP`} v={`${c.LP_med?.toFixed(2)} / ${c.HP_med?.toFixed(2)} bar`} />
                    <Fact k={`Circuit ${c.circuit} ratio`} v={c.PR_med?.toFixed(2)} />
                  </React.Fragment>
                ))}
                {Number.isFinite(sel.condenser?.HP_at_45C) && <Fact k="HP at 45 °C" v={`${sel.condenser.HP_at_45C.toFixed(1)} bar`} />}
                {Number.isFinite(sel.trend?.daysToFailure) && <Fact k="Projected failure" v={`~${Math.round(sel.trend.daysToFailure)} days`} />}
              </div>

              <section className="block">
                <h3>Score breakdown</h3>
                {Object.entries(sel.scoreParts).map(([k, v]) => {
                  const max = { cooling: 40, charge: 20, cycling: 20, contactor: 10, flags: 10 }[k];
                  return (
                    <div key={k} className="sbar"><span>{k}</span>
                      <div className="strack"><div className="sfill" style={{ width: `${(v / max) * 100}%` }} /></div>
                      <b>{v.toFixed(1)}/{max}</b></div>
                  );
                })}
              </section>

              <section className="block">
                <h3>Compressors</h3>
                <table className="traces">
                  <thead><tr><th>#</th><th>Duty</th><th>Cycles</th><th>Median run</th><th>Short</th><th>Contactor</th></tr></thead>
                  <tbody>
                    {sel.compressors.map((c) => (
                      <tr key={c.id} className={c.contactorMismatchPct > 1 ? 'changed' : ''}>
                        <td>COMP{c.id}</td><td>{c.dutyPct?.toFixed(1)}%</td><td>{c.cycles}</td>
                        <td>{c.medianRunMin?.toFixed(1)} min</td><td>{c.shortCycles}</td><td>{c.contactorMismatchPct?.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="block accent">
                <h3>Diagnosis</h3>
                <ol className="remedy">{sel.diagnosis.map((d, i) => <li key={i}>{d}</li>)}</ol>
              </section>

              <p className="disclaimer">Computed in-browser from the raw SCU log. Thresholds are engineering assumptions until confirmed against the SCU set-points — the same physics is available as matlab/vac_health.m for offline validation.</p>
            </div>
          )}
        </aside>
      </section>
    </main>
  );
}

function Spark({ series }) {
  if (!series || series.length < 2) return null;
  const w = 420, h = 60, pad = 4;
  const xs = series.map((p) => p[0]), ys = series.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 12);
  const X = (x) => pad + (w - 2 * pad) * (x - x0) / (x1 - x0 || 1);
  const Y = (y) => h - pad - (h - 2 * pad) * (y - y0) / (y1 - y0 || 1);
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  return (
    <div className="spark">
      <div className="sparklab">Cooling ΔT over the log window</div>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h}>
        <line x1={pad} y1={Y(8)} x2={w - pad} y2={Y(8)} stroke="rgba(63,185,80,.5)" strokeDasharray="4 3" />
        <line x1={pad} y1={Y(5)} x2={w - pad} y2={Y(5)} stroke="rgba(248,81,73,.5)" strokeDasharray="4 3" />
        <path d={d} fill="none" stroke="#58a6ff" strokeWidth="1.4" />
      </svg>
      <div className="sparkkey"><span style={{ color: 'var(--acc)' }}>— healthy floor 8°C</span><span style={{ color: 'var(--crit)' }}>— not cooling 5°C</span></div>
    </div>
  );
}

function Tile({ label, value, note, tone }) {
  return <div className={`tile ${tone || ''}`}><div className="tval">{value}</div><div className="tlab">{label}</div>{note && <div className="tnote">{note}</div>}</div>;
}
function Fact({ k, v }) { return <div className="fact"><span>{k}</span><b>{v}</b></div>; }
