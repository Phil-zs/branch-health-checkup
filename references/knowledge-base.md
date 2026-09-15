# Separate cause and measure knowledge workbook

Use one shared XLSX, separate from branch observations. It contains:

- `原因库`: `维度ID`, `状态`, `原因`; optional dimension name and provenance.
- `措施库`: `维度ID`, `状态`, `营业部类别`, `经营标准ID`, `建议措施`, `责任部门`, `资源支持`, `优先级`.

D01–D05 refer to branch dimensions, L01–L05 to leader abilities, not individual metric IDs. Branch states are 红灯/黄灯. Leader states are 优秀/良好/达标/待提升/预警. Empty category or standard is a wildcard; a populated value must match the input profile. Prefer specific matches, then priority, and deduplicate measures.

Pass the supplied file with `--knowledge-base <xlsx>`. An explicit file takes precedence and must exist and contain both sheets. Otherwise the generator discovers `../knowledge/原因措施知识库.xlsx` relative to the branch input directory. This supports relocating the complete input/knowledge folder pair. The knowledge file does not count as a second branch in subject selection.

When an external file or legacy embedded sheet is present but has no matching row, show the rule-gap message instead of inventing a recommendation. Legacy built-in branch fallbacks apply only when no knowledge sheet is supplied. Leader explanations should use the external L-dimension rules.

Knowledge causes are candidate explanations to verify using the input, not proven causal facts. Demo entries are explicitly marked for business review; they are not presented as approved company policy. Keep unprovided departments, resources, and factual events out of conclusions.
