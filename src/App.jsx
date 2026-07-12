import React, { useState, useEffect, useMemo, useRef } from 'react';
import { parseFiles } from './lib/parseTrainTracer.js';
import { loadKB, lookup, SYSTEM_EVENT_MEANING } from './lib/kb.js';
import { triage, summarise, DEFAULTS, SEV_ORDER, fmtDate, fmtDuration } from './lib/triage.js';
import RepairCard from './components/RepairCard.jsx';

export default function App() {
  const [kbReady, setKbReady] = useState(false);
  const [busy, setBusy] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [opts, setOpts] = useState(DEFAULTS);
  const [selected, setSelected] = useState(null);
  const [filterSev, setFilterSev] = useState('All');
  const [filterFn, setFilterFn] = useState('All');
  const [filterTs, setFilterTs] = useState('All');
  const [query, setQuery] = useState('');
  const inputRef = useRef();

  useEffect(() => { loadKB().then(() => setKbReady(true)); }, []);

  async function handleFiles(files) {
    const list = Array.from(files).filter((f) => /\.csv$/i.test(f.name));
    if (!list.length) { alert('Please drop TrainTracer .csv exports.'); return; }
    setSelected(null);
    setBusy({ i: 0, n: list.length, name: '' });
    const result = await parseFiles(list, (i, n, name) => setBusy({ i, n, name }));
    setParsed(result);
    setBusy(null);
  }

  const { incidents, stats } = useMemo(
    () => (parsed ? triage(parsed.events, opts) : { incidents: [], stats: null }),
    [parsed, opts]
  );
  const sums = useMemo(() => summarise(incidents), [incidents]);

  const visible = useMemo(() => incidents.filter((i) => {
    if (filterSev !== 'All' && i.severity !== filterSev) return false;
    if (filterFn !== 'All' && i.fn !== filterFn) return false;
    if (filterTs !== 'All' && i.trainset !== filterTs) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!(`${i.mnemonic} ${i.description} ${i.location} ${i.tcode}`.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [incidents, filterSev, filterFn, filterTs, query]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">CM</div>
          <div>
            <h1>CM Autopilot</h1>
            <span className="sub">Rolling Stock · Corrective Maintenance Triage</span>
          </div>
        </div>
        <div className="privacy" title="Files are read by JavaScript inside this browser tab. Nothing is transmitted.">
          <span className="dot" /> Local processing · no data leaves this device
        </div>
      </header>

      {!parsed && (
        <Landing
          kbReady={kbReady}
          busy={busy}
          onPick={() => inputRef.current.click()}
          onDrop={handleFiles}
        />
      )}

      <input ref={inputRef} type="file" multiple accept=".csv" hidden
        onChange={(e) => handleFiles(e.target.files)} />

      {parsed && stats && (
        <main className="main">
          <section className="tiles">
            <Tile label="Raw log rows" value={stats.total.toLocaleString()}
              note={`${parsed.meta.length} file${parsed.meta.length > 1 ? 's' : ''} · ${parsed.duplicatesRemoved.toLocaleString()} dup removed`} />
            <Tile label="Noise suppressed"
              value={(stats.systemFiltered + stats.infoFiltered).toLocaleString()}
              note={`${stats.systemFiltered.toLocaleString()} TCMS housekeeping · ${stats.infoFiltered.toLocaleString()} informational`}
              tone="muted" />
            <Tile label="Storms collapsed" value={stats.collapsed.toLocaleString()}
              note={`repeat firings merged into incidents`} tone="muted" />
            <Tile label="Actionable incidents" value={stats.incidents.toLocaleString()}
              note={stats.window ? `${fmtDate(stats.window.from)} → ${fmtDate(stats.window.to)}` : ''}
              tone="primary" />
            <Tile label="Critical + Major"
              value={((sums.bySeverity.Critical || 0) + (sums.bySeverity.Major || 0)).toLocaleString()}
              note={`${sums.bySeverity.Critical || 0} critical · ${sums.bySeverity.Major || 0} major`}
              tone="danger" />
            <Tile label="Repeat offenders" value={(stats.badActors || 0).toLocaleString()}
              note="same fault, same place, 3+ separate returns"
              tone="danger" />
          </section>

          <section className="reduction">
            <div className="bar">
              <div className="seg seg-noise" style={{ flex: stats.systemFiltered + stats.infoFiltered || 0.001 }} />
              <div className="seg seg-storm" style={{ flex: stats.collapsed || 0.001 }} />
              <div className="seg seg-real" style={{ flex: stats.incidents || 0.001 }} />
            </div>
            <p>
              <b>{stats.total.toLocaleString()}</b> rows of log reduced to <b>{stats.incidents.toLocaleString()}</b> incidents
              — a <b>{stats.total ? (stats.total / Math.max(stats.incidents, 1)).toFixed(0) : 0}×</b> reduction
              in what a technician has to read.
            </p>
          </section>

          <section className="controls">
            <div className="filters">
              <Select label="Severity" value={filterSev} onChange={setFilterSev}
                options={['All', ...SEV_ORDER.filter((s) => sums.bySeverity[s])]} />
              <Select label="Function" value={filterFn} onChange={setFilterFn}
                options={['All', ...Object.keys(sums.byFunction).sort()]} />
              <Select label="Trainset" value={filterTs} onChange={setFilterTs}
                options={['All', ...Object.keys(sums.byTrainset).sort()]} />
              <input className="search" placeholder="Search mnemonic, description, location…"
                value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="toggles">
              <Toggle checked={opts.hideSystemEvents} label="Hide TCMS housekeeping"
                title={Object.entries(SYSTEM_EVENT_MEANING).map(([k, v]) => `${k}: ${v}`).join('\n')}
                onChange={(v) => setOpts({ ...opts, hideSystemEvents: v })} />
              <Toggle checked={opts.hideInformation} label="Hide informational"
                onChange={(v) => setOpts({ ...opts, hideInformation: v })} />
              <label className="gap">
                Storm gap
                <input type="range" min="5" max="240" step="5" value={opts.stormGapMin}
                  onChange={(e) => setOpts({ ...opts, stormGapMin: +e.target.value })} />
                <b>{opts.stormGapMin} min</b>
              </label>
              <button className="ghost" onClick={() => { setParsed(null); setSelected(null); }}>
                Load different logs
              </button>
            </div>
          </section>

          <section className="split">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th style={{ width: 74 }}>Sev</th>
                    <th>Fault</th>
                    <th style={{ width: 84 }}>Train</th>
                    <th style={{ width: 76 }}>Loc</th>
                    <th style={{ width: 70 }}>Firings</th>
                    <th style={{ width: 70 }}>Returns</th>
                    <th style={{ width: 88 }}>Duration</th>
                    <th style={{ width: 132 }}>Last seen</th>
                    <th style={{ width: 62 }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 400).map((inc, n) => (
                    <tr key={inc.id}
                      className={selected?.id === inc.id ? 'sel' : ''}
                      onClick={() => setSelected(inc)}>
                      <td className="dim">{n + 1}</td>
                      <td><span className={`sev sev-${(inc.severity || 'x').toLowerCase()}`}>{inc.severity?.slice(0, 4)}</span></td>
                      <td>
                        <div className="mn">{inc.mnemonic}{inc.endedActive && <span className="live" title="Still active at end of log">ACTIVE</span>}</div>
                        <div className="desc">{inc.description || inc.fn}</div>
                      </td>
                      <td>{inc.trainset}</td>
                      <td>{inc.location}</td>
                      <td className={inc.firings > 20 ? 'hot' : ''}>{inc.firings}</td>
                      <td>{inc.repeats >= 3
                        ? <span className="badactor" title="This fault has come back on separate occasions — it was never actually fixed">×{inc.repeats}</span>
                        : <span className="dim">×{inc.repeats}</span>}</td>
                      <td className="dim">{fmtDuration(inc.durationMs)}</td>
                      <td className="dim">{fmtDate(inc.lastSeen)}</td>
                      <td><b>{Math.round(inc.score)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length > 400 && <p className="dim pad">Showing top 400 of {visible.length}. Narrow the filters.</p>}
              {!visible.length && <p className="dim pad">No incidents match these filters.</p>}
            </div>

            <aside className="panel">
              {selected ? (
                <RepairCard incident={selected} kbResult={lookup(selected.mnemonic)} />
              ) : (
                <div className="empty">
                  <h3>Select an incident</h3>
                  <p>The repair card is generated from the Level&nbsp;3 troubleshooting manual — probable cause, remedial action, circuit breaker, and which manual to open next.</p>
                </div>
              )}
            </aside>
          </section>
        </main>
      )}
    </div>
  );
}

/* ---------- small pieces ---------- */

function Landing({ kbReady, busy, onPick, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div className="landing">
      <div
        className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(e.dataTransfer.files); }}
        onClick={onPick}
      >
        {busy ? (
          <>
            <div className="spinner" />
            <h2>Parsing {busy.name}</h2>
            <p>{busy.i + 1} of {busy.n}</p>
          </>
        ) : (
          <>
            <div className="dropicon">↓</div>
            <h2>Drop TrainTracer CSV exports here</h2>
            <p>All files for a trainset at once — <code>T5112_1.csv … T5112_13.csv</code>.
              They are stitched, de-duplicated and triaged.</p>
            <button className="cta">Choose files</button>
          </>
        )}
      </div>
      <div className="kbnote">
        {kbReady
          ? <>✓ Knowledge base loaded — <b>152 IOS procedures</b> indexed from <i>Volume 3, Train Level Troubleshooting (Train Tracer), Rev H</i></>
          : <>Loading troubleshooting knowledge base…</>}
      </div>
      <ul className="how">
        <li><b>1 · Triage</b> Fault storms collapsed, TCMS chatter suppressed, incidents ranked by severity × recurrence × recency.</li>
        <li><b>2 · Diagnose</b> Each incident is matched to its manual procedure — cause, remedy, breaker, schematic.</li>
        <li><b>3 · Freeze frame</b> The T0−50 / T0 / T0+50 signal snapshot around the fault, read for you.</li>
      </ul>
    </div>
  );
}

function Tile({ label, value, note, tone }) {
  return (
    <div className={`tile ${tone || ''}`}>
      <div className="tval">{value}</div>
      <div className="tlab">{label}</div>
      {note && <div className="tnote">{note}</div>}
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <label className="sel">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

function Toggle({ checked, label, onChange, title }) {
  return (
    <label className="tog" title={title}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
