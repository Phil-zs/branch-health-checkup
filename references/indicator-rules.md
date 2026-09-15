# Indicator And Dimension Rules

## Dimension map

| ID | Name | Weight |
| --- | --- | --- |
| D01 | 经营效益 | 0.50 |
| D02 | 资产与客群 | 0.15 |
| D03 | 二次业务开发 | 0.15 |
| D04 | 团队效能 | 0.10 |
| D05 | 合规与风控 | 0.10 |

The complete per-metric rule set is embedded in [metric-catalog.json](metric-catalog.json). It is the source of truth for all 41 metric weights, directions, units, and red/yellow/green thresholds. Input workbooks only provide observed values matched by metric name.

## Metric status

For `higher`, green is `current >= green threshold`, yellow is `yellow threshold <= current < green threshold`, and red is below the yellow threshold.

For `lower`, green is `current <= green threshold`, yellow is `green threshold < current <= yellow threshold`, and red is above the yellow threshold.

The three thresholds are retained in the appendix. They are never generated or changed by AI.

## Scores

Metric status scores are fixed at green 100, yellow 65, and red 25. A dimension score is the weighted average of its metric scores. Dimension status is green for `>=80`, yellow for `>=60 and <80`, and red for `<60`.

The overall health score is the weighted average of the five dimension scores using the dimension weights above. Core abnormal themes are red dimensions; attention themes are yellow dimensions; green dimensions are summary-only.

If any metric is missing, report generation stops before HTML output and the user is asked to provide the missing data. A complete report is generated only after all 41 catalog metrics are matched.

## Display

For an abnormal dimension, `当前值 / 阈值` means the dimension score and its status band: red `<60分`, yellow `60-79.99分`. This prevents a detail metric from being mistaken for the dimension-level conclusion.
