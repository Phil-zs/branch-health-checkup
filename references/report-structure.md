# HTML Report Structure

The only deliverable is one self-contained HTML file. It must open from a local file without network access.

## Fixed modules

1. Cover: branch name + "经营体检报告" as the title, with the report date only.
2. Comprehensive health: overall score, current status, key focus, and green/yellow/red dimension counts. Beneath the leader focus, show actual scores in fixed order: 团队 / 经营 / 财富 / 数字 / 合规, separated by vertical bars. Both compact summary rows use gray 9px text, normal weight, and line-height 1.4; branch count digits have no larger font or status color. These five-dimension counts differ from the 41-detail-metric counts in the table below.
3. Dimension summary: branch table with 维度 / 绿 / 黄 / 红 / 得分 and a 合计 row. Green/yellow/red counts count the 41 detail metrics; dimension scores show weighted points / maximum, with total / 100. Leader table has 能力维度 / 得分 / 状态 and a 综合得分 row (total / 100 plus ability level). Match the reference template's compact plain-text table cells and bold totals with a top border. Peer comparisons belong in the radar, not additional summary-table columns.
4. Overall overview: deterministic narrative based on the calculated dimension states.
5. Core abnormal themes: red dimensions only; omit the entire subsection when none exist.
6. Attention themes: yellow dimensions only; omit the entire subsection when none exist.
7. Diagnosis conclusion: one concise, coherent paragraph that follows this information order without visible labels or lists: comprehensive state, branch abnormality, strengths, and solution. Draw the text only from computed overall/dimension states, the selected evidence metrics, and matched knowledge-base measures. Do not infer unprovided facts. The leader conclusion uses the same one-paragraph shape, replacing branch abnormality and solution with leader ability concerns and improvement measures.
8. Appendix: all 41 metric rows grouped by dimension with metric name, total value, online value, offline value, score, and current status.
9. Leader detail appendix: all 19 metrics, grouped by ability, with 方案评价指标 / 本期表现 / 同类均值 / 得分. Means use other same-category, same-period branches with leader data; disclose the sample count. Numeric means use observation units. Rating means use catalog scores and display 分 with an explanatory note. With no peers, retain the column and display `-`.

The leader analysis section follows the same exception-card order as branch analysis. Only `待提升` and `预警` abilities have cards. Each card shows the current ability score and five-level ability thresholds, selected one or two high-impact detail metrics, evidence, possible causes, and suggested measures. It does not use branch red/yellow/green labels.

Each radar uses real subject scores, peer dimension means, and 同类第一名 (the per-dimension maximum including the subject, potentially from different branches). State this definition. Keep the complete SVG styling; remove comparison polygons and their legends when no eligible peer data exists.

## Exception card order

Empty analysis subsections have no heading, zero-count label, dash placeholder, or empty section spacing. Apply this to leader attention abilities as well when there are no below-pass abilities. Keep diagnosis conclusions and dimension summaries.

Each core or attention card uses this order:

1. Dimension name
2. Status
3. Current value / threshold
4. Trend interpretation, followed by supporting trend charts when data supports them; omit both when unsupported.
5. Possible causes: keep 可能原因： and the cause text inline within one paragraph. Natural wrapping is allowed; do not force a break after the label or use flex items to separate it from the text. Causes remain hypotheses to verify.
6. Suggested measures

Do not print profile fields, D IDs, metric IDs, or detail metrics as the title of an exception card. Metric IDs and detail names are appropriate in the appendix only.

## Visual language

Use a restrained blue/teal base, light section backgrounds, and semantic red/yellow/green badges. Use separators between current-value, causes, and measures blocks. Keep long Chinese labels wrapped and avoid external fonts, icons, images, or remote CSS. Do not add a peer-comparison radar chart when no peer data is available.

## Approved color and summary details

Use the consolidated stylesheet in `assets/report-template-reference.html` for both screen and print. Preserve the confirmed layout, table fields, type sizes, spacing, and chart geometry. Bind real data in the generator; preview values and example grades are not defaults.

| Role | Color |
| --- | --- |
| Page and table body | White `#FFFFFF` |
| Section bands and table heads | Light gray `#F3F5F7` |
| Titles and chapter accents | Deep blue `#243B53` |
| Body text / secondary text | `#303741` / `#667381` |
| Borders | `#DFE5EA` |
| Subject radar and trend series | Teal `#168C86` |
| Peer mean / dimension leader | Blue-gray `#94A3B8` / muted gold `#B38A3D` |
| Green / yellow / red status text | `#2E7D5B` / `#A66B13` / `#C04B50` |
| Green / yellow / red badge fill | `#EDF6F0` / `#FFF7E8` / `#FBEFF0` |

- Radars use a solid teal subject outline with 0.10 fill opacity, blue-gray dashed means, and gold dash-dot leaders. Legend swatches match each series. Grid circles have no fill.
- Leader 优秀, 良好, and 达标 all use the same green as branch green lights; 待提升 uses amber, 预警 uses red. Apply this mapping to ability status labels in the summary table and appendix, and to leader badges.
- Only the leader's large overall number follows the actual overall ability level; the 综合得分 table value uses the same dark text as ordinary score cells. Keep the entire 综合能力等级 heading deep blue, including the grade text. Ordinary dimension and metric score cells remain dark text.
- The branch's large overall number follows its actual health status. Compact light counts remain gray `#666666`, matching the leader's five-score row. Do not color their digits.
- Leader appendix 同类均值 values use muted text `#64748B` on the normal white table body, with no dedicated column background.
- Anomaly cards use a narrow status-colored left border and pale status badges, keeping their main text on white. Avoid assigning a different decorative color to each dimension.
- Preserve colors when printing with `print-color-adjust: exact`; all styling stays inline in the delivered HTML.

负责人五维能力汇总表中，所有得分数字（包括“综合得分”的总分 / 100）使用与普通得分一致的深色文字，不按能力等级着色；状态列保留等级颜色，顶部大号综合能力分数仍按实际等级着色。
