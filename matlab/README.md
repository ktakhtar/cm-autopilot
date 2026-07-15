# CM Autopilot — MATLAB reference engine

`vac_health.m` — base MATLAB only, no toolboxes.

```matlab
>> vac_health('T5125_car_A_vac_1.xls')
```

This is the **offline twin** of the in-browser VAC engine. The end user never
needs MATLAB — the web app runs the same physics. This script exists to:
- validate the browser model (same health index on the same log),
- produce the 6-panel publication-quality diagnostic figure,
- write `vac_template_row.csv` for the existing VAC Logs spreadsheet.

## The finding
On the reference log (T5125, Car A) the SCU raised `LPT1_LOW` once in 4,930
samples — the current spreadsheet method calls that healthy. The physics
(cooling ΔT 6.7 °C vs 8–12 healthy; compression ratio 3.2 vs 3.5–4.5) says it
is an undercharged circuit. Score **66/100, WATCH**.

## A note on short cycling
This SCU log is event-based (~10 min between rows), not periodic. Run-length
"short cycling" on sparse timestamps is a weak signal, so it is **displayed but
given low weight** in the score. Don't oversell it in a room — the timestamps
can't support a hard claim. The score is driven by the metrics the data does
support: cooling ΔT and compression ratio.
