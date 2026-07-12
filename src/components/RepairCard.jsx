import React from 'react';
import { fmtDate, fmtDuration } from '../lib/triage.js';
import { SYSTEM_EVENT_MEANING } from '../lib/kb.js';

/* The repair card. This is the artefact the technician actually carries to the
 * train. Everything on it is derived — nothing is typed by a human. */

export default function RepairCard({ incident: inc, kbResult }) {
  const { entry, match } = kbResult;
  const sys = SYSTEM_EVENT_MEANING[inc.mnemonic];

  function copy() {
    navigator.clipboard.writeText(asText(inc, entry, match));
  }

  return (
    <div className="card">
      <div className="cardhead">
        <div>
          <span className={`sev sev-${(inc.severity || 'x').toLowerCase()}`}>{inc.severity}</span>
          {inc.endedActive && <span className="live">STILL ACTIVE</span>}
          <h2>{inc.mnemonic}</h2>
          <p className="cdesc">{inc.description}</p>
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
        <b>Priority {Math.round(inc.score)}</b>
        <span className="dim">
          = severity {inc.scoreParts.sev} × recurrence {inc.scoreParts.rec} ×
          recency {inc.scoreParts.age} × persistence {inc.scoreParts.per} ×
          repeat {inc.scoreParts.rpt}
        </span>
      </div>

      {inc.repeats >= 3 && (
        <section className="block repeatbanner">
          <h3>Repeat offender</h3>
          <p>
            This exact fault has returned <b>{inc.repeats} separate times</b> on
            trainset {inc.trainset} at {inc.location}. Previous corrective actions did
            not hold. Treat as a <b>recurring defect</b>, not a fresh fault — escalate
            rather than reset.
          </p>
        </section>
      )}

      {sys && (
        <Block title="Not a defect">
          <p className="note">{sys}</p>
        </Block>
      )}

      {match === 'none' && !sys && (
        <Block title="No manual entry">
          <p className="note">
            This mnemonic is not indexed in Volume 3. It may be a subsystem-internal
            code — check the subsystem's own repair manual.
          </p>
        </Block>
      )}

      {entry && (
        <>
          <Block title={match === 'exact' ? 'Manual procedure' : 'Nearest manual section'}>
            <div className="iosbar">
              {entry.ios && <span className="ios">{entry.ios}</span>}
              <span className="secref">§{entry.section} · page {entry.page}</span>
            </div>
            <h4>{entry.title}</h4>
            {entry.description && <p>{entry.description}</p>}
          </Block>

          {entry.reason && (
            <Block title="Trigger condition">
              <pre className="logic">{entry.reason}</pre>
            </Block>
          )}

          {entry.remedy?.length > 0 && (
            <Block title="Remedial action" accent>
              <ol className="remedy">
                {entry.remedy.map((r, i) => <li key={i}>{r}</li>)}
              </ol>
            </Block>
          )}

          {(entry.breakers?.length > 0 || entry.locations?.length > 0) && (
            <Block title="Circuit breakers to check">
              <div className="chips">
                {entry.breakers.map((b) => <span key={b} className="chip cb">{b}</span>)}
              </div>
              {entry.locations?.length > 0 && (
                <p className="note">Located in: {entry.locations.join(' · ')}</p>
              )}
            </Block>
          )}

          {(entry.schematics?.length > 0 || entry.manualRefs?.length > 0) && (
            <Block title="Documents to open">
              <div className="chips">
                {entry.schematics.map((s) => <span key={s} className="chip">Schematic {s}</span>)}
                {entry.manualRefs.map((r) => <span key={r} className="chip doc">{r}</span>)}
              </div>
            </Block>
          )}

          {entry.associatedOCS?.length > 0 && (
            <Block title="Associated OCS alarm(s)">
              <div className="chips">
                {entry.associatedOCS.slice(0, 12).map((o) => <span key={o} className="chip">{o}</span>)}
              </div>
            </Block>
          )}
        </>
      )}

      {inc.traces?.length > 0 && (
        <Block title={`Freeze frame — ${inc.traces.length} signals captured at the moment of fault`}>
          <table className="traces">
            <thead>
              <tr>
                <th>Signal</th>
                {inc.traceHeaders.map((h) => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {inc.traces.map((t, i) => {
                const changed = new Set(t.values).size > 1;
                return (
                  <tr key={i} className={changed ? 'changed' : ''}>
                    <td>{t.signal}</td>
                    {t.values.map((v, j) => (
                      <td key={j} className={`val v-${String(v).toLowerCase()}`}>{v}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="note">
            Highlighted rows are signals that <b>changed state</b> across the fault window —
            these are the ones worth looking at.
          </p>
        </Block>
      )}

      <p className="disclaimer">
        Generated index of AAGC-N0001-RSK-MTV-SYW-MAN-000091 Rev H. Always confirm
        against the controlled manual before intervention.
      </p>
    </div>
  );
}

function Fact({ k, v }) {
  if (!v) return null;
  return <div className="fact"><span>{k}</span><b>{v}</b></div>;
}

function Block({ title, children, accent }) {
  return (
    <section className={`block ${accent ? 'accent' : ''}`}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function asText(inc, entry, match) {
  const L = [];
  L.push(`CM AUTOPILOT — REPAIR CARD`);
  L.push(`${inc.mnemonic}  [${inc.severity}]`);
  L.push(inc.description || '');
  L.push('');
  L.push(`Trainset:   ${inc.trainset}`);
  L.push(`Location:   ${inc.location} ${inc.locationCode || ''}`);
  L.push(`Function:   ${inc.fn}`);
  L.push(`Firings:    ${inc.firings}`);
  L.push(`First seen: ${fmtDate(inc.firstSeen)}`);
  L.push(`Last seen:  ${fmtDate(inc.lastSeen)}`);
  L.push(`Priority:   ${Math.round(inc.score)}`);
  if (entry) {
    L.push('');
    L.push(`MANUAL: ${entry.ios || ''} ${entry.title}  (§${entry.section}, p.${entry.page})`);
    if (entry.remedy?.length) {
      L.push('');
      L.push('REMEDIAL ACTION:');
      entry.remedy.forEach((r, i) => L.push(`  ${i + 1}. ${r}`));
    }
    if (entry.breakers?.length) L.push(`\nBREAKERS: ${entry.breakers.join(', ')}  ${entry.locations?.join(' / ') || ''}`);
    if (entry.manualRefs?.length) L.push(`DOCUMENTS: ${entry.manualRefs.join(', ')}`);
  }
  L.push('');
  L.push('Confirm against the controlled manual before intervention.');
  return L.join('\n');
}
