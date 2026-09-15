# Input Contract

Input files contain observed data, not scoring weights or thresholds. Match names to the bundled 41-metric branch catalog and 19-metric leader catalog. XLSX is the full demonstration format; CSV/JSON remain supported for branch metric inputs.

## XLSX sheets

- `营业部信息`: first row is the header; column A contains field keys and column B values. Descriptions and units may appear in additional columns. Required identification: `branch_name`, `period`. Complete examples also include `prior_period`, `branch_class` (A/B/C/D), `region_type`, `development_stage`, `operating_standard_id`, `manager_name`, `manager_tenure_start`, `established_at`, `staff_count`, `annual_revenue` (万元), `annual_profit` (万元), `peer_rank`, `total_assets` (亿元), `asset_over_10k_count` (户). Optional `channel_value_basis` accepts `sum` when total equals online plus offline, or `independent` when channels are independently calculated and must not be summed. Unknown optional facts display as `-`, never template example values. Numeric basic information stays numeric in Excel; render known units in the HTML.
- `指标数据`: one row per metric; columns `指标名称`, `本期总值`, `本期线上值`, `本期线下值`, `上期总值`, `上期线上值`, `上期线下值`. `指标ID`, `维度`, and `单位` are optional reference columns. Legacy `当前值/总值`, `线上值`, `线下值`, `上期值` are aliases.
- `历史趋势`: long table, `指标名称`, `期间`, `本营业部值`; optional `单位` and `期间口径`. Complete examples contain five observations for each of the 41 metrics (205 rows). Store historical annual total values; use current total in the current-year slot. Do not put precomputed peer averages into single-branch demo files.
- `负责人数据`: `指标名称`, `本期值` (alias `当前值`), `上期值`; optional rule-catalog ID, dimension and unit. Include all 19 rule-catalog metrics. `团队凝聚力` is A/B/C/D; all other values are numeric. Do not substitute a numeric zero for missing observations.
- `负责人历史趋势`: `指标名称`, `期间`, `本年度值`; five observations for each leader metric (95 rows). Current-year entries equal the current values. Rating history remains A/B/C/D in the input; convert to scores only for plotting where appropriate.
- `填写说明`: human-readable data basis; not a source of metric observations or calculation-rule overrides.

The branch workbook contains no cause or measure sheets in the current demo format. Provide a separate `原因措施知识库.xlsx`; see [knowledge-base.md](knowledge-base.md).

## Value and period semantics

Store rates as numeric fractions (0.85 means 85%), counts as integers, amounts in the stated units. Distinguish contribution values under a shared denominator from independently calculated channel ratios. The demonstration defines total = online + offline, including contribution values for ratios/growth/per-capita metrics; this must not be generalized to unrelated input data without its declared basis.

Current/prior periods are explicitly labeled. Annual series may mix previous complete years with this year's current cutoff. Do not annualize, fabricate missing months, or describe a year-to-date decline against full-year totals as comparable deterioration. Asset stocks may be compared at stated dates; cumulative measures require comparable periods for growth judgments.

## CSV and JSON compatibility

CSV accepts Chinese column names above and legacy names; English aliases include `name`, `current/total`, `online`, `offline`, `prior`, `prior_online`, `prior_offline`, and `id`. Supply branch/period columns or `--branch-name` and `--period`.

JSON contains `metrics` and profile metadata (top-level or `profile`). Optional `history` rows use `name`, `period`, `value`. Full leader demonstration currently uses XLSX. Retain legacy embedded knowledge compatibility, but prefer an explicit external workbook for new cases.

## Validation

For comparisons, pass other branch files using `--peer-inputs` (comma-separated paths). Only known matching branch categories and identical reporting periods are eligible. Exclude the subject and duplicate branch names from peer means. Dimension leaders include the subject. Leader means use only eligible branches with complete leader data, and rating means use catalog scores. Never treat missing comparison data as zero.

Missing branch metrics: list the missing catalog names and stop before writing HTML. Missing any required leader metric when a leader sheet is supplied: likewise stop and request supplementation. Extra branch names are ignored and reported. Repeated recognized names, invalid numeric current values, mismatched provided branch IDs, and invalid leader rating grades stop processing. Names determine matching; user files cannot override catalog thresholds or weights.

Before output, the generator also emits non-blocking data-quality warnings defined in [data-quality-rules.md](data-quality-rules.md). These warnings never change a score or inferred status. They identify input conditions that should be reviewed, such as incomplete channel values, a possible total/channel mismatch, incomplete historical series, missing recommended profile fields, and a clear contradiction between the branch and leader overall scores.

Portable example (paths are relative to the extracted demo folder):

```sh
node branch-health-checkup/scripts/generate_report.mjs --input input/观沙岭营业部_2026年7月_模拟数据.xlsx --knowledge-base knowledge/原因措施知识库.xlsx --output-dir output
```
