import React from 'react';
import { fmtDate, fmtDuration } from '../lib/triage.js';
import { SYSTEM_EVENT_MEANING } from '../lib/kb.js';

export default function RepairCard({ incident: inc, kbResult }) {
  const { entry, match } = kbResult;
  const sys = SYSTEM_EVENT_MEANING[inc.mnemonic];
  function copy() { navigator.clipboard.writeText(asText(inc, entry, match)); }

  return (
    <div className="card">
      <div className="cardhead">
        <div>
          <span className={`sev sev-${(inc.severity || 'x').toLowerCase()}`}>{inc.severity}</span>
          {inc.endedActive && <span className="live">STILL HAPPENING</span>}
          <h2>{inc.plainName}</h2>
          <p className="cdesc"><span className="codetag">{inc.mnemonic}</span> · {inc.description}</p>
        </div>
        <button className="ghost sm" onClick={copy}>Copy</button>
      </div>

      <div className="facts">
        <Fact k="Trainset" v={inc.trainset} />
        <Fact k="Location" v={`${inc.location}${inc.locationCode ? ` (${inc.locationCode})` : ''}`} />
        <Fact k="Function" v={inc.fn} />
        <Fact k="TCMS stack" v={inc.stack} />
        <Fact k="T-code" v={inc.tcode} />
        <Fact k="Firings" v={`${inc.firings} (${inc.rows} log rows)`} />
        <Fact k="First seen" v={fmtDate(inc.firstSeen)} />
        <Fact k="Last seen" v={fmtDate(inc.lastSeen)} />
        <Fact k="Standing for" v={fmtDuration(inc.durationMs)} />
      </div>

      <div className="scoreline">
        <b>Priority score {Math.round(inc.score)}</b>
        <span className="dim">how bad ({inc.scoreParts.sev}) × how often ({inc.scoreParts.rec}) × how recent ({inc.scoreParts.age}) × still happening ({inc.scoreParts.per}) × keeps returning ({inc.scoreParts.rpt}). Higher means look at it sooner.</span>
      </div>

      {inc.repeats >= 3 && (
        <section className="block repeatbanner">
          <h3>This one keeps coming back</h3>
          <p>This exact problem has come back <b>{inc.repeats} separate times</b> on train {inc.trainset} at {inc.location}. Earlier fixes did not hold, so this isn’t a fresh fault — it’s an ongoing one. Worth escalating rather than just resetting it again.</p>
        </section>
      )}

      {sys && <Block title="This isn’t a fault"><p className="note">{sys}</p></Block>}
      {match === 'none' && !sys && <Block title="Not in the manual index"><p className="note">This fault code isn’t in the main troubleshooting manual. It may belong to a specific sub-system — check that sub-system’s own repair manual.</p></Block>}

      {entry && (
        <>
          <Block title={match === 'exact' ? 'How to fix it (from the manual)' : 'Closest manual section'}>
            <div className="iosbar">{entry.ios && <span className="ios">{entry.ios}</span>}<span className="secref">§{entry.section} · page {entry.page}</span></div>
            <h4>{entry.title}</h4>
            {entry.description && <p>{entry.description}</p>}
          </Block>
          {entry.reason && <Block title="What sets this fault off"><pre className="logic">{entry.reason}</pre></Block>}
          {entry.remedy?.length > 0 && <Block title="Steps to fix it" accent><ol className="remedy">{entry.remedy.map((r, i) => <li key={i}>{r}</li>)}</ol></Block>}
          {(entry.breakers?.length > 0 || entry.locations?.length > 0) && (
            <Block title="Circuit breakers to check">
              <div className="chips">{entry.breakers.map((b) => <span key={b} className="chip cb">{b}</span>)}</div>
              {entry.locations?.length > 0 && <p className="note">Located in: {entry.locations.join(' · ')}</p>}
            </Block>
          )}
          {(entry.schematics?.length > 0 || entry.manualRefs?.length > 0) && (
            <Block title="Documents to open">
              <div className="chips">{entry.schematics.map((s) => <span key={s} className="chip">Schematic {s}</span>)}{entry.manualRefs.map((r) => <span key={r} className="chip doc">{r}</span>)}</div>
            </Block>
          )}
          {entry.associatedOCS?.length > 0 && (
            <Block title="Related driver-cab alarm(s)"><div className="chips">{entry.associatedOCS.slice(0, 12).map((o) => <span key={o} className="chip">{o}</span>)}</div></Block>
          )}
        </>
      )}

      {inc.traces?.length > 0 && (
        <Block title={`What the train was doing at that moment (${inc.traces.length} signals)`}>
          <table className="traces">
            <thead><tr><th>Signal</th>{inc.traceHeaders.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>
              {inc.traces.map((t, i) => {
                const changed = new Set(t.values).size > 1;
                return (
                  <tr key={i} className={changed ? 'changed' : ''}>
                    <td>{t.signal}</td>
                    {t.values.map((v, j) => <td key={j} className={`val v-${String(v).toLowerCase()}`}>{v}</td>)}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">The highlighted rows are the signals that <b>changed</b> right as the fault happened — usually the best clue to the cause.</p>
        </Block>
      )}

      <p className="disclaimer">Built from the official Route 2020 troubleshooting manual. Always double-check against the current controlled manual before starting work.</p>
    </div>
  );
}

function Fact({ k, v }) { if (!v) return null; return <div className="fact"><span>{k}</span><b>{v}</b></div>; }
function Block({ title, children, accent }) { return <section className={`block ${accent ? 'accent' : ''}`}><h3>{title}</h3>{children}</section>; }

function asText(inc, entry) {
  const L = ['CM AUTOPILOT — REPAIR CARD', `${inc.mnemonic}  [${inc.severity}]`, inc.description || '', '',
    `Trainset:   ${inc.trainset}`, `Location:   ${inc.location} ${inc.locationCode || ''}`, `Function:   ${inc.fn}`,
    `Firings:    ${inc.firings}`, `First seen: ${fmtDate(inc.firstSeen)}`, `Last seen:  ${fmtDate(inc.lastSeen)}`, `Priority:   ${Math.round(inc.score)}`];
  if (entry) {
    L.push('', `MANUAL: ${entry.ios || ''} ${entry.title}  (§${entry.section}, p.${entry.page})`);
    if (entry.remedy?.length) { L.push('', 'REMEDIAL ACTION:'); entry.remedy.forEach((r, i) => L.push(`  ${i + 1}. ${r}`)); }
    if (entry.breakers?.length) L.push(`\nBREAKERS: ${entry.breakers.join(', ')}  ${entry.locations?.join(' / ') || ''}`);
    if (entry.manualRefs?.length) L.push(`DOCUMENTS: ${entry.manualRefs.join(', ')}`);
  }
  L.push('', 'Confirm against the controlled manual before intervention.');
  return L.join('\n');
}
