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

## Repair guide
`public/kb/faults_kb.json` — a machine-readable index of the Route 2020 train
troubleshooting manual (152 fault procedures), kept as a separate loadable file
so it can be swapped or updated without touching the app. It should be used
alongside the current controlled manual, not in place of it.
