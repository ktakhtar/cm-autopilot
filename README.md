# CM Autopilot

Corrective-maintenance cockpit for Alstom rolling stock (Route 2020 / Dubai Metro).

Everything runs in the browser. Fault logs, SCU logs and the spares workbook are
read by JavaScript inside the user's own tab — nothing is uploaded, stored or
transmitted. No backend, no database, no cloud storage. The tool can be used on
confidential operational data with no data-residency review, and it costs
nothing to host. The `.gitignore` hard-blocks `*.csv`, `*.xls*`, `*.pdf`.

## Modules

| # | Module | Runs in | Status |
|---|--------|---------|--------|
| 1 | Fault triage + repair cards | browser | shipped |
| 2 | VAC health engine | browser (+ MATLAB reference) | shipped |
| 3 | Spares predictor (Poisson) | browser (+ MATLAB reference) | shipped |

Modules 2 and 3 have a MATLAB reference twin in `matlab/` — same physics, same
numbers — for offline validation and publication-quality figures. The end user
never needs MATLAB.

## Run locally
```bash
npm install
npm run dev
```

## Knowledge base
`public/kb/faults_kb.json` — machine-readable index of
AAGC-N0001-RSK-MTV-SYW-MAN-000091 Rev H (152 IOS procedures). Used with written
RTA permission; shipped as a separate loadable file, not compiled in.
