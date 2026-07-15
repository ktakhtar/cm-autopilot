# CM Autopilot — MATLAB reference engines

Base MATLAB only. No toolboxes.

## vac_health.m — VAC health (reference twin of the in-browser engine)
```matlab
>> vac_health('T5125_car_A_vac_1.xls')
```
Same physics and health index as the web app's VAC tab. Produces the 6-panel
diagnostic figure and writes the spreadsheet row.

## spares_predictor.m — Poisson base-stock spares model
```matlab
>> spares_predictor('CM_spare_need_urgently_Updated_on_24_04.xlsx')
```

Reliability-engineering model of the CM spares holding.

**Model.** A part with failure rate λ, fleet population N, running H hours/year,
fails as a Poisson process. Expected demand over its lead time L is
`μ = λ·N·H·(L/52)`. The spares to hold for a 95% service level is the smallest
S with Poisson CDF(S; μ) ≥ 0.95 — the classic (S−1,S) base-stock model.
Compare to on-hand and on-order; the gap is the order list.

**Validation.** The DLP sheet carries Alstom's own Poisson-recommended quantity.
This independent model reproduces it at **r = 0.96**, so a disagreement on a
specific part is a genuine finding, not model error.

**Findings on the reference workbook (404 items with complete data):**
- 56 items are below the 95%-service stock level for their lead time
- 21 of those are flagged Critical
- ≈ AED 3.9M to close every gap at 95% service
- highest-demand parts: LED strips, contactors, the ELM battery-box RC, axlebox
  bearing, traction control unit

**Outputs:** ranked report, 4-panel figure, `spares_order_list.csv`,
`spares_predictor.json`.

**Assumptions** (operating hours, service level) live in the `CFG` block and
nowhere else — change them there when you have the real figures.
