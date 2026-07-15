/* CM AUTOPILOT — Troubleshooting knowledge base
 * faults_kb.json is a machine-readable index of AAGC-N0001-RSK-MTV-SYW-MAN-000091
 * Rev H, Vol 3 Train Level Troubleshooting (357 pages): 152 IOS entries with
 * mnemonics, trigger logic, remedial actions, breaker locations, schematics. */

let KB = null;
let COMPILED = [];

function toRegex(m) {
  const esc = m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = esc.replace(/<[a-z]>/g, '\\d+');
  return new RegExp('^' + body + '(?:_[A-Za-z0-9]+)?$');
}

export async function loadKB() {
  if (KB) return KB;
  const res = await fetch(`${import.meta.env.BASE_URL}kb/faults_kb.json`);
  KB = await res.json();
  COMPILED = [];
  for (const entry of KB.entries)
    for (const m of entry.mnemonics)
      COMPILED.push({ re: toRegex(m), entry, specificity: m.length });
  COMPILED.sort((a, b) => b.specificity - a.specificity);
  return KB;
}
export function getKB() { return KB; }

export function lookup(mnemonic) {
  if (!KB) return { entry: null, match: 'none' };
  for (const c of COMPILED) if (c.re.test(mnemonic)) return { entry: c.entry, match: 'exact' };
  const m = mnemonic.match(/^[EF]_([A-Z]{3})_/);
  if (m && KB.functionSections[m[1]]) {
    const fs = KB.functionSections[m[1]];
    return {
      match: 'function',
      entry: {
        section: fs.section, page: fs.page, title: fs.title, ios: null, function: m[1],
        mnemonics: [mnemonic],
        description: `No dedicated IOS entry for this mnemonic. It belongs to the ${KB.functions[m[1]] || m[1]} function — start at section ${fs.section} (page ${fs.page}) of the Level 3 troubleshooting manual.`,
        reason: '', remedy: [], manualRefs: [], breakers: [], schematics: [], associatedOCS: [], locations: [],
      },
    };
  }
  return { entry: null, match: 'none' };
}

export const SYSTEM_EVENT_MEANING = {
  EQAPP: 'Equipment applied — TCMS lifecycle housekeeping, logged on every equipment registration.',
  POWON: 'Power on — trainset energised. Normal start-of-day event.',
  RESIP: 'Reset IP — network stack reset. Normal, follows power cycles.',
  EQDIS: 'Equipment disabled — TCMS lifecycle housekeeping, logged on de-registration.',
};
