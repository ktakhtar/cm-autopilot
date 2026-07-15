# CM Autopilot

Corrective-maintenance cockpit for Alstom rolling stock (Route 2020 / Dubai Metro).

Everything runs in the browser. Fault logs and SCU logs are read by JavaScript
inside the user's own tab — nothing is uploaded, stored, or transmitted. No
backend, no database, no cloud storage. That means the tool can be used on
confidential operational data with no data-residency review, and it costs
nothing to host. The `.gitignore` hard-blocks `*.csv`, `*.xls*`, `*.pdf`.

## Modules

| # | Module | Status |
|---|--------|--------|
| 1 | Fault triage + repair cards | shipped |
| 2 | VAC health engine (in-browser + MATLAB reference) | shipped |
| 3 | Under-monitoring auto-verifier | next |
| 4 | KPI guardian | planned |
| 5 | Spares predictor (MATLAB) | planned |

## Run locally
```bash
npm install
npm run dev
```

## MATLAB
`matlab/vac_health.m` is the rigorous reference twin of the in-browser VAC
engine (`src/lib/vacHealth.js`). Same physics, same health index. The web app
needs no MATLAB; the script exists to validate the model, produce the
publication-quality diagnostic figure, and write the spreadsheet row.

## Knowledge base
`public/kb/faults_kb.json` — machine-readable index of
AAGC-N0001-RSK-MTV-SYW-MAN-000091 Rev H, Vol 3 Train Level Troubleshooting:
152 IOS procedures. Used with written RTA permission; shipped as a separate
loadable file, not compiled in. Always confirm against the controlled manual.
