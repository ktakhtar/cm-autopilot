import React, { useState, useEffect, useMemo, useRef } from 'react';
import { parseFiles } from './lib/parseTrainTracer.js';
import { loadKB, lookup, SYSTEM_EVENT_MEANING } from './lib/kb.js';
import { triage, summarise, sortIncidents, SORT_OPTIONS, DEFAULTS, SEV_ORDER, plainFunction, fmtDate, fmtDuration } from './lib/triage.js';
import RepairCard from './components/RepairCard.jsx';
import VacPanel from './components/VacPanel.jsx';
import SparesPanel from './components/SparesPanel.jsx';
import Glossary from './components/Glossary.jsx';

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
  const [sortKey, setSortKey] = useState('critical-first');
  const [tab, setTab] = useState('faults');
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

  const visible = useMemo(() => {
    const filtered = incidents.filter((i) => {
      if (filterSev !== 'All' && i.severity !== filterSev) return false;
      if (filterFn !== 'All' && i.plainFn !== filterFn) return false;
      if (filterTs !== 'All' && i.trainset !== filterTs) return false;
      if (query) {
        const q = query.toLowerCase();
        if (!(`${i.plainName} ${i.mnemonic} ${i.description} ${i.location} ${i.tcode}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
    return sortIncidents(filtered, sortKey);
  }, [incidents, filterSev, filterFn, filterTs, query, sortKey]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">CM</div>
          <div>
            <h1>CM Autopilot</h1>
            <span className="sub">Train maintenance, made simple</span>
          </div>
        </div>

        <nav className="tabs">
          <button className={tab === 'faults' ? 'on' : ''} onClick={() => setTab('faults')}>Fault finder</button>
          <button className={tab === 'vac' ? 'on' : ''} onClick={() => setTab('vac')}>AC health</button>
          <button className={tab === 'spares' ? 'on' : ''} onClick={() => setTab('spares')}>Spare parts</button>
          <button className={tab === 'glossary' ? 'on' : ''} onClick={() => setTab('glossary')}>What do these mean?</button>
        </nav>

        <div className="privacy" title="Everything you load is opened right here on your own computer, the same way a file opens in Excel. Nothing is sent anywhere — not to us, not to any server.">
          <span className="dot" /> Your files stay on your computer — nothing is uploaded
        </div>
      </header>

      {tab === 'vac' && <VacPanel />}
      {tab === 'spares' && <SparesPanel />}
      {tab === 'glossary' && <Glossary />}

      {tab === 'faults' && !parsed && (
        <Landing kbReady={kbReady} busy={busy} onPick={() => inputRef.current.click()} onDrop={handleFiles} />
      )}

      <input ref={inputRef} type="file" multiple accept=".csv" hidden onChange={(e) => handleFiles(e.target.files)} />

      {tab === 'faults' && parsed && stats && (
        <main className="main">
          <section className="tiles">
            <Tile label="Log lines read" value={stats.total.toLocaleString()}
              note={`${parsed.meta.length} file${parsed.meta.length > 1 ? 's' : ''} · ${parsed.duplicatesRemoved.toLocaleString()} duplicates removed`} />
            <Tile label="Routine messages set aside" value={(stats.systemFiltered + stats.infoFiltered).toLocaleString()}
              note={`${stats.systemFiltered.toLocaleString()} normal system activity · ${stats.infoFiltered.toLocaleString()} information-only`} tone="muted" />
            <Tile label="Repeats grouped together" value={stats.collapsed.toLocaleString()} note="the same fault firing over and over, merged into one" tone="muted" />
            <Tile label="Real problems to look at" value={stats.incidents.toLocaleString()}
              note={stats.window ? `${fmtDate(stats.window.from)} → ${fmtDate(stats.window.to)}` : ''} tone="primary" />
            <Tile label="Critical + Major"
              value={((sums.bySeverity.Critical || 0) + (sums.bySeverity.Major || 0)).toLocaleString()}
              note={`${sums.bySeverity.Critical || 0} critical · ${sums.bySeverity.Major || 0} major`} tone="danger" />
            <Tile label="Faults that keep coming back" value={(stats.badActors || 0).toLocaleString()}
              note="same fault, same place, 3+ times — never properly fixed" tone="danger" />
          </section>

          <section className="reduction hero">
            <div className="herohead">
              <div className="herobig">{stats.total ? (100 * (1 - stats.incidents / Math.max(stats.total, 1))).toFixed(1) : 0}%</div>
              <div className="herotext">
                <b>less to read.</b> CM Autopilot turned <b>{stats.total.toLocaleString()}</b> lines of raw log
                into <b>{stats.incidents.toLocaleString()}</b> real problems worth a technician's time —
                that's <b>{stats.total ? (stats.total / Math.max(stats.incidents, 1)).toFixed(0) : 0}× fewer things</b> to
                check by hand.
              </div>
            </div>
            <div className="bar">
              <div className="seg seg-noise" style={{ flex: stats.systemFiltered + stats.infoFiltered || 0.001 }} title="Routine system messages — not faults" />
              <div className="seg seg-storm" style={{ flex: stats.collapsed || 0.001 }} title="Repeated firings of the same fault, grouped" />
              <div className="seg seg-real" style={{ flex: stats.incidents || 0.001 }} title="Real problems to look at" />
            </div>
            <div className="barkey">
              <span><i className="k-noise" /> routine system messages</span>
              <span><i className="k-storm" /> repeats grouped</span>
              <span><i className="k-real" /> real problems</span>
            </div>
          </section>

          <section className="controls">
            <div className="filters">
              <Select label="Sort by" value={sortKey} onChange={setSortKey}
                options={Object.keys(SORT_OPTIONS)} labels={Object.fromEntries(Object.entries(SORT_OPTIONS).map(([k, v]) => [k, v.label]))} />
              <Select label="Severity" value={filterSev} onChange={setFilterSev} options={['All', ...SEV_ORDER.filter((s) => sums.bySeverity[s])]} />
              <Select label="System" value={filterFn} onChange={setFilterFn} options={['All', ...Object.keys(sums.byFunction).sort()]} />
              <Select label="Train" value={filterTs} onChange={setFilterTs} options={['All', ...Object.keys(sums.byTrainset).sort()]} />
              <input className="search" placeholder="Search a fault, part or location…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="toggles">
              <Toggle checked={opts.hideSystemEvents} label="Hide routine system messages"
                title={'These are normal start-up / shutdown / network messages the train logs constantly. They are not faults.\n' + Object.entries(SYSTEM_EVENT_MEANING).map(([k, v]) => `${k}: ${v}`).join('\n')}
                onChange={(v) => setOpts({ ...opts, hideSystemEvents: v })} />
              <Toggle checked={opts.hideInformation} label="Hide information-only entries" onChange={(v) => setOpts({ ...opts, hideInformation: v })} />
              <label className="gap" title="How far apart two firings of the same fault can be and still count as one problem, rather than two separate ones.">Group repeats within
                <input type="range" min="5" max="240" step="5" value={opts.stormGapMin} onChange={(e) => setOpts({ ...opts, stormGapMin: +e.target.value })} />
                <b>{opts.stormGapMin} min</b>
              </label>
              <button className="ghost" onClick={() => { setParsed(null); setSelected(null); }}>Load different logs</button>
            </div>
          </section>

          <section className="split">
            <div className="tablewrap">
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th><th style={{ width: 72 }}>How bad</th><th>Problem</th>
                    <th style={{ width: 78 }}>Train</th><th style={{ width: 72 }}>Where</th>
                    <th style={{ width: 64 }}>Times</th><th style={{ width: 74 }}>Came back</th>
                    <th style={{ width: 80 }}>Lasted</th><th style={{ width: 124 }}>Last seen</th><th style={{ width: 58 }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, 400).map((inc, n) => (
                    <tr key={inc.id} className={selected?.id === inc.id ? 'sel' : ''} onClick={() => setSelected(inc)}>
                      <td className="dim">{n + 1}</td>
                      <td><span className={`sev sev-${(inc.severity || 'x').toLowerCase()}`}>{inc.severity?.slice(0, 4)}</span></td>
                      <td>
                        <div className="pname">{inc.plainName}{inc.endedActive && <span className="live" title="Was still happening at the end of the log">ONGOING</span>}</div>
                        <div className="mncode">{inc.plainFn} · {inc.mnemonic}</div>
                      </td>
                      <td>{inc.trainset}</td><td>{inc.location}</td>
                      <td className={inc.firings > 20 ? 'hot' : ''}>{inc.firings}</td>
                      <td>{inc.repeats >= 3
                        ? <span className="badactor" title="This exact problem returned on separate occasions — it was never properly fixed">{inc.repeats}×</span>
                        : <span className="dim">{inc.repeats}×</span>}</td>
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
              {selected ? <RepairCard incident={selected} kbResult={lookup(selected.mnemonic)} />
                : <div className="empty"><h3>Pick a problem to see how to fix it</h3><p>Click any row and this panel fills with a repair card built from the official troubleshooting manual — the likely cause, the steps to fix it, the circuit breaker to check, and the manual page to open next.</p></div>}
            </aside>
          </section>
        </main>
      )}
    </div>
  );
}

function Landing({ kbReady, busy, onPick, onDrop }) {
  const [over, setOver] = useState(false);
  return (
    <div className="landing">
      <div className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); onDrop(e.dataTransfer.files); }}
        onClick={onPick}>
        {busy ? (
          <><div className="spinner" /><h2>Parsing {busy.name}</h2><p>{busy.i + 1} of {busy.n}</p></>
        ) : (
          <><div className="dropicon">↓</div>
            <h2>Drop your train's fault logs here</h2>
            <p>All the log files for one train at once — <code>T5139_1.csv … T5139_8.csv</code>. We join them, remove duplicates, and show you what actually needs attention.</p>
            <button className="cta">Choose files</button></>
        )}
      </div>
      <div className="kbnote">
        {kbReady ? <>✓ Repair guide loaded — <b>152 fault procedures</b> from the official Route 2020 troubleshooting manual, ready to match to your logs.</>
          : <>Loading the repair guide…</>}
      </div>
      <ul className="how">
        <li><b>1 · Sort the noise</b> The train logs thousands of routine messages. We set those aside and merge the repeats, so you're left with a short list of real problems — ranked most serious first.</li>
        <li><b>2 · Say what to do</b> Click any problem and get a plain repair card: what's likely wrong, the steps to fix it, which circuit breaker to check, and which manual page to open.</li>
        <li><b>3 · Show the moment it happened</b> Every problem comes with a snapshot of the train's signals right before, during and after — so you can see what changed.</li>
      </ul>
    </div>
  );
}

function Tile({ label, value, note, tone }) {
  return <div className={`tile ${tone || ''}`}><div className="tval">{value}</div><div className="tlab">{label}</div>{note && <div className="tnote">{note}</div>}</div>;
}
function Select({ label, value, onChange, options, labels }) {
  return <label className="sel"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{labels ? labels[o] : o}</option>)}</select></label>;
}
function Toggle({ checked, label, onChange, title }) {
  return <label className="tog" title={title}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{label}</span></label>;
}
