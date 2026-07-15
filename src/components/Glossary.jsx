import React, { useState } from 'react';

/* A plain-English dictionary for every abbreviation and bit of jargon in the
 * app. Built because remembering all these codes is genuinely hard when you're
 * new — so here they are, sorted and searchable, in one place. */

const GLOSSARY = [
  {
    group: 'The systems on the train (fault code prefixes)',
    intro: 'Every fault code starts with a three-letter tag telling you which system it came from. For example, a code starting F_BRK_ is a braking fault.',
    items: [
      ['AIR', 'Compressed air', 'Makes and stores the compressed air used for brakes and doors.'],
      ['BRK', 'Braking', 'The braking system and its control units.'],
      ['TBS', 'Traction & braking', 'Combined traction (making the train move) and braking control.'],
      ['CLM', 'Air-conditioning', 'Cooling and ventilation for the passenger cabins.'],
      ['CPL', 'Coupling', 'The couplers that join train cars together.'],
      ['DRS', 'Doors', 'The passenger access doors.'],
      ['DRV', 'Driving / ATO', 'Driving and Automatic Train Operation.'],
      ['ESG', 'External signalling', 'Lights and signals on the outside of the train.'],
      ['FSD', 'Fire & smoke detection', 'Fire and smoke detection.'],
      ['HVS', 'High-voltage power', 'The high-voltage electrical system (power pickup).'],
      ['MVS', 'Medium-voltage power', 'The medium-voltage electrical system.'],
      ['LIG', 'Lighting', 'Interior and exterior lighting.'],
      ['PAI', 'PA & intercom', 'Public address and passenger intercom.'],
      ['TCN', 'Onboard network', 'The data network that lets the train’s computers talk to each other.'],
      ['ATC', 'Train control', 'Automatic Train Control — the signalling that keeps trains safely apart.'],
    ],
  },
  {
    group: 'Fault codes & how they read',
    intro: 'A code like F_TBS_PCE4PropNotOper looks scary but reads left to right.',
    items: [
      ['F_ / E_', 'Fault / Event', 'A code starting F_ is a Fault (something is wrong). Starting E_ is an Event (something worth noting, not always a fault).'],
      ['IOS', 'Onboard status message', 'A numbered status message the train raises (e.g. IOS001 = “loss of one compressor”). The manual has a page for each one.'],
      ['OCS', 'Driver-cab alarm', 'The on-screen alarm the driver sees in the cab when a fault fires.'],
      ['PCE', 'Propulsion control', 'A propulsion control unit — the electronics that drive the motors.'],
      ['BCE / BCU', 'Brake control unit', 'The unit that controls braking on a bogie.'],
      ['WSP', 'Wheel-slide protection', 'Anti-skid for the wheels, like ABS on a car.'],
      ['VAC', 'Air-conditioning unit', 'One air-conditioning unit on the roof of a car.'],
      ['SCU', 'AC control unit', 'The controller inside a VAC that runs the compressors and fans.'],
      ['Mnemonic', 'The fault code itself', 'The exact code text, e.g. F_TBS_PCE4PropNotOper. Technicians use it to look things up precisely.'],
    ],
  },
  {
    group: 'What the fault list shows you',
    intro: 'The words used on the fault-triage screen, in plain terms.',
    items: [
      ['Problem', 'What’s wrong, in plain words', 'We translate the raw code into a short phrase anyone can read.'],
      ['How bad', 'Severity', 'Critical, Major, Minor or Information — taken straight from the train’s own rating.'],
      ['Times', 'How many times it fired', 'How often this fault appeared in the log.'],
      ['Came back', 'How many separate returns', 'How many separate occasions this same fault reappeared — 3 or more means it was never properly fixed.'],
      ['Ongoing', 'Still happening', 'The fault was still active at the end of the log — it hadn’t cleared.'],
      ['Priority score', 'What to look at first', 'A single number combining how bad, how often, how recent, whether it’s ongoing, and whether it keeps returning.'],
    ],
  },
  {
    group: 'Air-conditioning (VAC) health',
    intro: 'The measurements on the VAC health screen.',
    items: [
      ['ΔT (delta-T)', 'Cooling power', 'How many degrees the unit removes from the air. A healthy unit drops the air 8–12°C. Low means it’s struggling.'],
      ['HP / LP', 'High / low pressure', 'The pressure on each side of the refrigerant loop. Their ratio tells you if the unit is properly charged.'],
      ['Compression ratio', 'HP ÷ LP', 'A quick health check of the refrigerant charge. Too low usually means the unit is low on gas.'],
      ['Short cycling', 'Stopping and starting too fast', 'A compressor that keeps switching on and off — often a sign it’s low on refrigerant, and hard on the machine.'],
      ['Condenser fouling', 'A blocked cooling coil', 'Dust and sand block the outdoor coil so the unit can’t shed heat — the top cause of AC failure in Dubai.'],
      ['Contactor', 'The compressor’s on/off switch', 'An electrical relay. If it fails, the compressor is told to run but doesn’t — an electrical fault, not a gas fault.'],
    ],
  },
  {
    group: 'Spare parts & the workbook tabs',
    intro: 'The spares screen reads a workbook with a few tabs. Here’s what each one is.',
    items: [
      ['DLP', 'Design spares list', 'The “Detailed Logistics Provisioning” sheet — the manufacturer’s official list of every spare part, with its failure rate, fleet quantity and lead time.'],
      ['Inventory balance', 'What’s on the shelf now', 'The live count of how many of each part are physically in the store right now.'],
      ['PRF status', 'What’s already on order', 'The “Purchase Request Form” tracker — which parts have been ordered and where each order is (issued, pending, delivered).'],
      ['Failure rate', 'How often a part fails', 'Failures per million hours of running — the manufacturer’s reliability figure for the part.'],
      ['Lead time', 'How long to get more', 'How many weeks it takes to receive a part after ordering it.'],
      ['MTTR', 'Time to repair', 'Mean Time To Repair — the average hours to replace or fix the part.'],
      ['TAT', 'Turnaround time', 'How long a part takes to come back from repair.'],
      ['Poisson model', 'The maths behind the stock levels', 'A standard way to work out how many spares to hold, based on how randomly parts fail. See the spares screen for the plain-English version.'],
      ['Service level', 'The safety target', 'Set to 95% — meaning we want a 95% chance that a spare is on the shelf the moment a part fails.'],
    ],
  },
  {
    group: 'Where the data comes from',
    intro: 'The files you load into the app.',
    items: [
      ['Fault log (CSV)', 'The train’s fault recorder', 'A download of every fault and event the train logged, taken off the train with a laptop.'],
      ['SCU log (XLS)', 'The AC recorder', 'A download from an air-conditioning control unit, with temperatures, pressures and compressor activity over time.'],
      ['Spares workbook (XLSX)', 'The parts spreadsheet', 'The spreadsheet holding the design spares list, current stock and orders on the way.'],
    ],
  },
];

export default function Glossary() {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();

  const groups = GLOSSARY.map((g) => ({
    ...g,
    items: g.items.filter(([a, b, c]) =>
      !query || `${a} ${b} ${c}`.toLowerCase().includes(query)),
  })).filter((g) => g.items.length);

  return (
    <main className="main">
      <div className="glosshead">
        <div>
          <h2 className="glosstitle">Plain-English dictionary</h2>
          <p className="glosssub">Every abbreviation and bit of jargon in one place. Rolling stock is full of codes,
            and remembering them all is genuinely hard when you’re new — so here they are, grouped and searchable.</p>
        </div>
        <input className="search glosssearch" placeholder="Search any term, e.g. “VAC” or “lead time”"
          value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {groups.map((g) => (
        <section key={g.group} className="glossgroup">
          <h3>{g.group}</h3>
          {g.intro && <p className="glossintro">{g.intro}</p>}
          <div className="glossgrid">
            {g.items.map(([abbr, short, long]) => (
              <div key={abbr} className="glosscard">
                <div className="glossabbr">{abbr}</div>
                <div className="glossshort">{short}</div>
                <div className="glosslong">{long}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
      {!groups.length && <p className="dim pad">No terms match “{q}”.</p>}
    </main>
  );
}
