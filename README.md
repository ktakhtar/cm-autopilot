# CM Autopilot

Corrective-maintenance triage for Alstom rolling stock (Route 2020 / Dubai Metro).

Drop TrainTracer CSV exports in. Get back a ranked list of actionable incidents,
each with an auto-generated repair card drawn from the Level 3 troubleshooting
manual: probable cause, remedial action, circuit breaker designation and
location, schematic reference, and the next manual to open.

## Architecture

**Everything runs in the browser.** Fault logs are read by JavaScript inside the
user's own tab. Nothing is uploaded, stored, or transmitted. There is no backend,
no database and no cloud storage. This is deliberate: it means the tool can be
used on confidential operational data without any data-residency or IT security
review, and it costs nothing to host.

The `.gitignore` hard-blocks `*.csv`, `*.xls*` and `*.pdf` so operational data
cannot be committed by accident.

## Modules

| # | Module | Status |
|---|--------|--------|
| 1 | Fault triage + repair cards | shipped |
| 2 | VAC health engine (MATLAB) | next |
| 3 | Under-monitoring auto-verifier | planned |
| 4 | KPI guardian | planned |
| 5 | Spares predictor (MATLAB) | planned |

## Run locally

```bash
npm install
npm run dev
```

## Knowledge base

`public/kb/faults_kb.json` is a machine-readable index of
AAGC-N0001-RSK-MTV-SYW-MAN-000091 Rev H, *Volume 3 — Train Level Troubleshooting
(Train Tracer)*: 152 IOS procedures, 113 with remedial actions, 62 with circuit
breaker locations.

Used with written permission from RTA. The index is a separate loadable file, not
compiled into the application, so it can be swapped or removed per deployment.
Always confirm against the controlled manual before intervention.
