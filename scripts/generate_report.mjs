import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadInput } from "./input-adapters.mjs";
import { readLeaderWorkbook, leaderLevel, scoreLeaderMetric, formatLeaderValue } from "./leader-scoring.mjs";
import METRIC_CATALOG from "../references/metric-catalog.json" with { type: "json" };

const DIMENSIONS = [
  { id: "D01", name: "经营效益", weight: 0.50 },
  { id: "D02", name: "资产与客群", weight: 0.15 },
  { id: "D03", name: "二次业务开发", weight: 0.15 },
  { id: "D04", name: "团队效能", weight: 0.10 },
  { id: "D05", name: "合规与风控", weight: 0.10 },
];

const STATUS_SCORE = { green: 100, yellow: 65, red: 25 };
const STATUS_LABEL = { green: "绿灯", yellow: "黄灯", red: "红灯", missing: "无数据" };
const STATUS_CLASS = { green: "status-green", yellow: "status-yellow", red: "status-red", missing: "status-missing" };
const RULE_GAP = "暂无已配置的维度级规则，需补充原因或措施配置。";

const DEFAULT_CAUSES = {
  "D01:red": [
    "收入与利润目标完成度不足，经营效益指标整体承压。",
    "收入结构改善尚未形成稳定增量，重点业务贡献不足。",
    "经营资源投入与有效产出不匹配，费用和产出效率需要复盘。",
  ],
  "D01:yellow": [
    "利润或主要收入指标接近预警区间，增长动能不足。",
    "收入结构仍偏单一，新业务增量尚未完全抵消传统业务波动。",
  ],
  "D02:red": [
    "存量资产承接和客户新增不足，客户资产基础出现收缩。",
    "重点客群经营深度不足，新增客户资产转化率偏低。",
    "客户流失管理和活跃度维护未形成稳定机制。",
  ],
  "D02:yellow": [
    "客户资产和新增客户质量处于关注区间，增长稳定性不足。",
    "客户结构经营存在短板，资产增长尚未覆盖流失和低活跃影响。",
  ],
  "D03:red": [
    "两融、产品、投顾或量化等二次业务开发转化不足。",
    "客户需求识别与二次开发触达不足，重点产品覆盖不够。",
    "业务团队缺少持续跟进和过程复盘，开发结果波动较大。",
  ],
  "D03:yellow": [
    "二次业务开发已有基础，但业务转化和收入贡献仍未达到健康区间。",
    "重点产品触达覆盖不均衡，客户经营动作需要进一步标准化。",
  ],
  "D04:red": [
    "团队人均产出和服务执行能力不足，经营动作难以稳定复制。",
    "人员能力结构与重点业务要求不完全匹配，专业资质和线索执行存在缺口。",
    "过程管理和客户服务覆盖不足，团队产能释放不充分。",
  ],
  "D04:yellow": [
    "团队产出接近关注区间，人员能力和过程执行仍有提升空间。",
    "线索跟进、客户服务和专业能力建设尚未形成稳定闭环。",
  ],
  "D05:red": [
    "合规扣分或投诉事件达到预警水平，风险事件控制需要立即加强。",
    "重点岗位的合规教育、过程留痕和问题整改闭环不充分。",
  ],
  "D05:yellow": [
    "已出现合规扣分或投诉信号，需要加强日常监测与整改跟踪。",
    "合规要求落实存在薄弱环节，但尚未形成重大风险事件。",
  ],
};

const DEFAULT_MEASURES = {
  D01: [
    { summary: "组织月度收入与费用复盘，拆解到业务线和责任人。", owner: "经纪业务管理部", resource: "收入结构诊断及目标拆解模板", priority: "高" },
    { summary: "对重点收入来源建立周度跟进清单，滚动纠偏。", owner: "营业部负责人", resource: "重点业务经营看板", priority: "高" },
  ],
  D02: [
    { summary: "建立存量、新增、流失客户资产清单，按周跟进重点客户。", owner: "经纪业务管理部", resource: "客户分层与资产保有活动素材", priority: "高" },
    { summary: "围绕重点客群设置资产提升和活跃度回访动作。", owner: "营业部负责人", resource: "客户经营任务包", priority: "中" },
  ],
  D03: [
    { summary: "建立二次业务机会清单和周度转化复盘机制。", owner: "经纪业务管理部", resource: "两融、产品、投顾业务培训与线索", priority: "高" },
    { summary: "对重点客户补齐需求识别、触达、成交和复购链路。", owner: "营业部负责人", resource: "重点产品专项活动支持", priority: "中" },
  ],
  D04: [
    { summary: "建立理财经理行动看板，按周复盘人均产出和线索执行。", owner: "经纪业务管理部", resource: "线索执行报表与服务覆盖清单", priority: "高" },
    { summary: "按岗位开展专业能力辅导，明确月度服务覆盖目标。", owner: "营业部负责人", resource: "岗位训练营与案例库", priority: "中" },
  ],
  D05: [
    { summary: "完成当月合规复盘和投诉闭环清单，逐项确认整改证据。", owner: "合规管理部", resource: "合规案例培训与整改模板", priority: "高" },
    { summary: "对重点岗位开展抽查和回访，形成问题台账与升级机制。", owner: "营业部负责人", resource: "风险检查清单与升级支持", priority: "高" },
  ],
};

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    args[key] = argv[++i];
  }
  if (!args.input || !args["output-dir"]) {
    throw new Error("Usage: generate_report.mjs --input <xlsx|csv|json> --output-dir <directory> [--branch-name <name>] [--period <period>]");
  }
  return {
    inputPath: path.resolve(args.input),
    outputDir: path.resolve(args["output-dir"]),
    branchName: text(args["branch-name"]),
    period: text(args.period),
    knowledgePath: args['knowledge-base'] ? path.resolve(args['knowledge-base']) : null,
    peerInputPaths: text(args["peer-inputs"])
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => path.resolve(item)),
  };
}

function text(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseNumber(value, label) {
  if (typeof value === "number") {
    if (Number.isFinite(value)) return value;
  } else {
    const raw = text(value).replace(/,/g, "").replace(/％/g, "%");
    if (!raw) throw new Error(`${label} must be numeric; received an empty value`);
    if (raw.endsWith("%")) {
      const percent = Number.parseFloat(raw.slice(0, -1));
      if (Number.isFinite(percent)) return percent / 100;
    }
    const number = Number(raw);
    if (Number.isFinite(number)) return number;
  }
  throw new Error(`${label} must be numeric; received ${JSON.stringify(value)}`);
}

function normalizeWeight(value, label) {
  const number = parseNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero`);
  return number > 1 ? number / 100 : number;
}

function formatNumber(value, digits = 1) {
  return Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function compactNumber(value) {
  return Number(value).toLocaleString("zh-CN", { maximumFractionDigits: 1 });
}

function formatMetricValue(value, unit) {
  const unitText = text(unit);
  const percentage = /率|占比|比例|%/.test(unitText);
  if (percentage) return `${formatNumber(value * 100)}%`;
  return `${formatNumber(value)}${unitText ? ` ${unitText}` : ""}`;
}

function classifyMetricValue(row, value) {
  if (row.direction === "higher") {
    if (value >= row.greenThreshold) return "green";
    if (value >= row.yellowThreshold) return "yellow";
    return "red";
  }
  if (value <= row.greenThreshold) return "green";
  if (value <= row.yellowThreshold) return "yellow";
  return "red";
}

function classifyMetric(row) {
  return classifyMetricValue(row, row.current);
}

function scoreStatus(status) {
  return STATUS_SCORE[status];
}

function getSheetValues(workbook, sheetName) {
  return workbook?.sheets?.get(sheetName) ?? null;
}

function nonEmptyRows(values) {
  return (values ?? []).filter((row) => row.some((value) => text(value) !== ""));
}

function headerIndex(headers, name) {
  const index = headers.indexOf(name);
  if (index < 0) throw new Error(`Missing required column: ${name}`);
  return index;
}

function headerIndexByAliases(headers, aliases, label) {
  const index = aliases.map((alias) => headers.indexOf(alias)).find((candidate) => candidate >= 0);
  if (index === undefined) throw new Error(`Missing required column: ${label}`);
  return index;
}

function readProfile(workbook) {
  const values = getSheetValues(workbook, "营业部信息");
  if (!values) throw new Error("Missing required sheet: 营业部信息");
  const profile = {};
  for (const row of nonEmptyRows(values)) {
    if (text(row[0])) profile[text(row[0])] = text(row[1]);
  }
  for (const [field,unit] of Object.entries({annual_revenue:'万元',annual_profit:'万元',total_assets:'亿元',asset_over_10k_count:'户',staff_count:'人'})) {
    if (profile[field] && /^-?\d+(\.\d+)?$/.test(profile[field])) profile[field] = `${Number(profile[field]).toLocaleString('zh-CN',{maximumFractionDigits:2})}${unit}`;
  }
  for (const field of ["branch_name", "period"]) if (!profile[field]) throw new Error(`营业部信息 missing required field: ${field}`);
  for (const field of ["branch_class", "region_type", "development_stage", "operating_standard_id", "manager_name", "manager_tenure_start"]) if (!profile[field]) profile[field] = "-";
  // Optional measure rules use the workbook's Chinese column labels; keep the
  // input contract's stable English keys and expose explicit matching aliases.
  profile["营业部类别"] = profile.branch_class || "";
  profile["经营标准ID"] = profile.operating_standard_id || "";
  return profile;
}

function normalizeMetricName(value) {
  return text(value)
    .replace(/[（）()【】\[\]{}]/g, "")
    .replace(/[\s_\-\/]+/g, "")
    .replace(/[：:]/g, "")
    .toLowerCase();
}

function validateMetricCatalog() {
  if (!Array.isArray(METRIC_CATALOG) || METRIC_CATALOG.length !== 41) {
    throw new Error(`内置指标规则必须包含 41 项，当前为 ${METRIC_CATALOG?.length ?? 0} 项`);
  }
  const seen = new Set();
  for (const rule of METRIC_CATALOG) {
    if (seen.has(rule.id)) throw new Error(`内置指标规则存在重复指标ID ${rule.id}`);
    seen.add(rule.id);
    if (!/^M(01|02|03|04|05)\d{2}$/.test(rule.id)) throw new Error(`内置指标规则存在非法指标ID ${rule.id}`);
    if (!/^D0[1-5]$/.test(rule.dimensionId) || rule.id.slice(1, 3) !== rule.dimensionId.slice(1, 3)) {
      throw new Error(`内置指标规则 ${rule.id} 的维度归属无效`);
    }
    for (const field of ["weight", "greenThreshold", "yellowThreshold", "redThreshold"]) {
      if (typeof rule[field] !== "number" || !Number.isFinite(rule[field])) throw new Error(`内置指标规则 ${rule.id} 的 ${field} 无效`);
    }
  }
}

function readMetrics(workbook) {
  const values = getSheetValues(workbook, "指标数据");
  if (!values || values.length === 0) throw new Error("Missing required sheet or data: 指标数据");
  const headers = values[0].map((value) => text(value));
  const index = {
    "指标名称": headerIndex(headers, "指标名称"),
    "当前值": headerIndexByAliases(headers, ["本期总值", "当前值", "总值"], "本期总值/当前值/总值"),
  };
  for (const [field, aliases] of Object.entries({
    "线上值": ["本期线上值", "线上值"],
    "线下值": ["本期线下值", "线下值"],
    "指标ID": ["指标ID"],
    "上期值": ["上期总值", "上期值"],
    "上期线上值": ["上期线上值"],
    "上期线下值": ["上期线下值"],
    "取数来源": ["取数来源"],
  })) {
    const candidate = aliases.map((alias) => headers.indexOf(alias)).find((value) => value >= 0);
    if (candidate !== undefined) index[field] = candidate;
  }
  const rows = nonEmptyRows(values.slice(1));
  if (!rows.length) throw new Error("指标数据 must contain at least one metric row");
  const rulesByName = new Map();
  for (const rule of METRIC_CATALOG) {
    for (const name of [rule.name, ...(rule.aliases ?? [])]) rulesByName.set(normalizeMetricName(name), rule);
  }
  const seen = new Set();
  const observed = new Map();
  const ignoredMetrics = [];
  for (const [rowIndex, row] of rows.entries()) {
    const excelRow = rowIndex + 2;
    const inputName = text(row[index["指标名称"]]);
    if (!inputName) throw new Error(`指标数据 row ${excelRow}: 指标名称不能为空`);
    const rule = rulesByName.get(normalizeMetricName(inputName));
    if (!rule) {
      ignoredMetrics.push({ row: excelRow, name: inputName, reason: "未在内置41项指标目录中" });
      continue;
    }
    if (index["指标ID"] !== undefined && text(row[index["指标ID"]]) && text(row[index["指标ID"]]) !== rule.id) {
      throw new Error(`指标数据 row ${excelRow}: 指标ID ${text(row[index["指标ID"]])} 与指标名称 ${inputName} 不匹配`);
    }
    if (seen.has(rule.id)) throw new Error(`指标数据 row ${excelRow}: duplicate 指标名称 ${inputName}（对应 ${rule.id}）`);
    seen.add(rule.id);
    const current = parseNumber(row[index["当前值"]], `指标数据 row ${excelRow} 当前值`);
    const online = index["线上值"] === undefined || text(row[index["线上值"]]) === "" ? null : parseNumber(row[index["线上值"]], `指标数据 row ${excelRow} 线上值`);
    const offline = index["线下值"] === undefined || text(row[index["线下值"]]) === "" ? null : parseNumber(row[index["线下值"]], `指标数据 row ${excelRow} 线下值`);
    const prior = index["上期值"] === undefined || text(row[index["上期值"]]) === "" ? null : parseNumber(row[index["上期值"]], `指标数据 row ${excelRow} 上期值`);
    const priorOnline = index['上期线上值'] === undefined ? null : parseNumber(row[index['上期线上值']], '上期线上值');
    const priorOffline = index['上期线下值'] === undefined ? null : parseNumber(row[index['上期线下值']], '上期线下值');
    observed.set(rule.id, { rule, inputName, current, online, offline, prior, priorOnline, priorOffline, source: index["取数来源"] === undefined ? "" : text(row[index["取数来源"]]) });
  }
  const metrics = METRIC_CATALOG.map((rule) => {
    const item = observed.get(rule.id);
    if (!item) {
      return {
        ...rule,
        status: "missing",
        statusLabel: STATUS_LABEL.missing,
        statusClass: STATUS_CLASS.missing,
        score: null,
        current: null,
        online: null,
        offline: null,
        prior: null,
        currentDisplay: "无数据",
        onlineDisplay: "无数据",
        offlineDisplay: "无数据",
        priorDisplay: "无数据",
        greenDisplay: formatMetricValue(rule.greenThreshold, rule.unit),
        yellowDisplay: formatMetricValue(rule.yellowThreshold, rule.unit),
        redDisplay: formatMetricValue(rule.redThreshold, rule.unit),
        source: rule.source,
      };
    }
    const metric = { ...item.rule, current: item.current, online: item.online, offline: item.offline, prior: item.prior, priorOnline: item.priorOnline, priorOffline: item.priorOffline, source: item.source || item.rule.source };
    metric.status = classifyMetric(metric);
    metric.statusLabel = STATUS_LABEL[metric.status];
    metric.statusClass = STATUS_CLASS[metric.status];
    metric.score = scoreStatus(metric.status);
    metric.currentDisplay = formatMetricValue(metric.current, metric.unit);
    metric.onlineDisplay = metric.online === null ? "无数据" : formatMetricValue(metric.online, metric.unit);
    metric.offlineDisplay = metric.offline === null ? "无数据" : formatMetricValue(metric.offline, metric.unit);
    metric.priorDisplay = metric.prior === null ? "无数据" : formatMetricValue(metric.prior, metric.unit);
    metric.greenDisplay = formatMetricValue(metric.greenThreshold, metric.unit);
    metric.yellowDisplay = formatMetricValue(metric.yellowThreshold, metric.unit);
    metric.redDisplay = formatMetricValue(metric.redThreshold, metric.unit);
    return metric;
  });
  return { metrics, ignoredMetrics };
}

function readTrendHistory(workbook, metrics) {
  const values = getSheetValues(workbook, "历史趋势");
  if (!values || values.length < 2) return metrics;
  const headers = values[0].map(v => text(v));
  const ni = headers.findIndex(h => ["指标名称","metric_name","name"].includes(h));
  const pi = headers.findIndex(h => ["期间","统计期间","period"].includes(h));
  const vi = headers.findIndex(h => ["本营业部值","当前值","总值","value"].includes(h));
  const qi = headers.findIndex(h => ["同类均值","peer_mean","peer"].includes(h));
  if (ni < 0 || pi < 0 || vi < 0) return metrics;
  const byName = new Map(metrics.map(m => [normalizeMetricName(m.name), m]));
  for (const row of values.slice(1)) {
    const metric = byName.get(normalizeMetricName(row[ni]));
    if (!metric || text(row[pi]) === "" || text(row[vi]) === "") continue;
    try {
      const point = { period: text(row[pi]), value: parseNumber(row[vi], `历史趋势 ${metric.name}`) };
      if (qi >= 0 && text(row[qi]) !== "") point.peer = parseNumber(row[qi], `历史趋势 ${metric.name} 同类均值`);
      (metric.history ??= []).push(point);
    } catch { /* invalid optional history is ignored; current metric remains authoritative */ }
  }
  return metrics;
}


function aggregateDimensions(metrics) {
  return DIMENSIONS.map((definition) => {
    const rows = metrics.filter((metric) => metric.dimensionId === definition.id);
    if (!rows.length) throw new Error(`No metrics found for ${definition.id}`);
    const missingRows = rows.filter((metric) => metric.status === "missing");
    if (missingRows.length) {
      return {
        ...definition,
        score: null,
        status: "missing",
        statusLabel: STATUS_LABEL.missing,
        statusClass: STATUS_CLASS.missing,
        dataStatus: "incomplete",
        metricCount: rows.length,
        metrics: rows,
        missingCount: missingRows.length,
        missingMetricNames: missingRows.map((row) => row.name),
        redCount: 0,
        yellowCount: 0,
        greenCount: rows.filter((row) => row.status === "green").length,
        currentThreshold: `数据不足 / 缺失 ${missingRows.length} 项指标`,
      };
    }
    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    const score = rows.reduce((sum, row) => sum + row.score * row.weight, 0) / totalWeight;
    const status = score < 60 ? "red" : score < 80 ? "yellow" : "green";
    const weightedScore = score * definition.weight;
    const maxScore = definition.weight * 100;
    return {
      ...definition,
      score,
      weightedScore,
      maxScore,
      scoreDisplay: `${formatNumber(weightedScore)} / ${formatNumber(maxScore)}`,
      status,
      statusLabel: STATUS_LABEL[status],
      statusClass: STATUS_CLASS[status],
      dataStatus: "complete",
      metricCount: rows.length,
      metrics: rows,
      missingCount: 0,
      redCount: rows.filter((row) => row.status === "red").length,
      yellowCount: rows.filter((row) => row.status === "yellow").length,
      greenCount: rows.filter((row) => row.status === "green").length,
      currentThreshold: `${formatNumber(weightedScore)} / ${formatNumber(maxScore)}，${STATUS_LABEL[status]} | 阈值：${status === "red" ? "维度综合得分 <60分" : status === "yellow" ? "维度综合得分 60-79.99分" : "维度综合得分 >=80分"}`,
    };
  });
}

function aggregateOverall(dimensions) {
  if (dimensions.some((dimension) => dimension.score === null)) return null;
  return dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0);
}

const RECOMMENDED_PROFILE_FIELDS = [
  ["branch_class", "营业部类别"],
  ["region_type", "区域类型"],
  ["development_stage", "发展阶段"],
  ["operating_standard_id", "经营标准"],
  ["manager_name", "负责人"],
  ["manager_tenure_start", "负责人任职时间"],
];

function qualityIssue(code, message, items = []) {
  return {
    severity: "warning",
    code,
    message,
    count: items.length || 1,
    examples: items.length ? items.slice(0, 5) : [],
  };
}

function isBoundedRatio(metric) {
  return /(占比|转化率|覆盖率|渗透率|活跃率|留存率|执行率|使用率|添加率)/.test(metric.name);
}

function evaluateDataQuality(profile, metrics, leader, ignoredMetrics = [], overallScore = null) {
  const issues = [];
  const profileMissing = RECOMMENDED_PROFILE_FIELDS
    .filter(([field]) => !text(profile[field]) || text(profile[field]) === "-")
    .map(([, label]) => label);
  if (profileMissing.length) {
    issues.push(qualityIssue("profile_fields_missing", `基础信息缺少${profileMissing.join("、")}，报告将以“-”显示。`, profileMissing));
  }

  const channelIncomplete = [];
  const channelMismatch = [];
  const ratioOutOfRange = [];
  for (const metric of metrics) {
    for (const [periodLabel, total, online, offline] of [
      ["本期", metric.current, metric.online, metric.offline],
      ["上期", metric.prior, metric.priorOnline, metric.priorOffline],
    ]) {
      if (!Number.isFinite(total)) continue;
      if (online === null && offline === null) {
        channelIncomplete.push(`${metric.name}（${periodLabel}）`);
      } else if (!Number.isFinite(online) || !Number.isFinite(offline)) {
        channelIncomplete.push(`${metric.name}（${periodLabel}）`);
      } else if (text(profile.channel_value_basis).toLowerCase() !== "independent") {
        const tolerance = /率|占比|比例|%/.test(metric.unit) ? 0.0001 : Math.max(0.01, Math.abs(total) * 0.005);
        if (Math.abs(total - online - offline) > tolerance) channelMismatch.push(`${metric.name}（${periodLabel}）`);
      }
      if (isBoundedRatio(metric)) {
        for (const [channel, value] of [["总值", total], ["线上值", online], ["线下值", offline]]) {
          if (Number.isFinite(value) && (value < 0 || value > 1)) ratioOutOfRange.push(`${metric.name}（${periodLabel}${channel}）`);
        }
      }
    }
  }
  if (channelIncomplete.length) {
    issues.push(qualityIssue("channel_values_incomplete", `检索到${channelIncomplete.length}项指标的线上或线下值不完整，请补充后再核验渠道结构。`, channelIncomplete));
  }
  if (channelMismatch.length) {
    issues.push(qualityIssue("channel_total_mismatch", `检索到${channelMismatch.length}项指标的总值与线上、线下之和存在差异；请确认渠道数值口径。`, channelMismatch));
  }
  if (ratioOutOfRange.length) {
    issues.push(qualityIssue("bounded_ratio_out_of_range", `检索到${ratioOutOfRange.length}项占比或转化类指标超出0%至100%范围，请核验单位或数值。`, ratioOutOfRange));
  }

  const missingPrior = metrics.filter((metric) => metric.prior === null).map((metric) => metric.name);
  const missingHistory = metrics.filter((metric) => !(metric.history?.length)).map((metric) => metric.name);
  const partialHistory = metrics.filter((metric) => metric.history?.length && metric.history.length < 5).map((metric) => metric.name);
  if (missingPrior.length) {
    issues.push(qualityIssue("branch_prior_missing", `检索到${missingPrior.length}项营业部指标缺少上期总值，相关趋势仅按现有期间展示。`, missingPrior));
  }
  if (missingHistory.length) {
    issues.push(qualityIssue("branch_history_missing", `检索到${missingHistory.length}项营业部指标缺少历史序列，相关趋势图将省略。`, missingHistory));
  }
  if (partialHistory.length) {
    issues.push(qualityIssue("branch_history_incomplete", `检索到${partialHistory.length}项营业部指标历史序列不足5期，图表仅展示已提供期间。`, partialHistory));
  }

  let leaderSummary = { provided: false, metricCount: 0, historyCompleteCount: 0 };
  if (leader) {
    const leaderMetrics = leader.dimensions.flatMap((dimension) => dimension.metrics);
    const leaderMissingPrior = leaderMetrics.filter((metric) => metric.prior === null || metric.prior === undefined || metric.prior === "").map((metric) => metric.name);
    const leaderMissingHistory = leaderMetrics.filter((metric) => !(metric.history?.length)).map((metric) => metric.name);
    const leaderPartialHistory = leaderMetrics.filter((metric) => metric.history?.length && metric.history.length < 5).map((metric) => metric.name);
    if (leaderMissingPrior.length) {
      issues.push(qualityIssue("leader_prior_missing", `检索到${leaderMissingPrior.length}项负责人指标缺少上期值，相关趋势仅按现有期间展示。`, leaderMissingPrior));
    }
    if (leaderMissingHistory.length) {
      issues.push(qualityIssue("leader_history_missing", `检索到${leaderMissingHistory.length}项负责人指标缺少历史序列，相关趋势图将省略。`, leaderMissingHistory));
    }
    if (leaderPartialHistory.length) {
      issues.push(qualityIssue("leader_history_incomplete", `检索到${leaderPartialHistory.length}项负责人指标历史序列不足5期，图表仅展示已提供期间。`, leaderPartialHistory));
    }
    if (Number.isFinite(overallScore) && (overallScore >= 85 && leader.overall < 60 || overallScore < 60 && leader.overall >= 85)) {
      issues.push(qualityIssue("branch_leader_consistency", "营业部与负责人综合表现存在明显反向差异，请核验数据期间、负责人归属及指标口径。"));
    }
    leaderSummary = {
      provided: true,
      metricCount: leaderMetrics.length,
      historyCompleteCount: leaderMetrics.filter((metric) => metric.history?.length >= 5).length,
    };
  }
  if (ignoredMetrics.length) {
    issues.push(qualityIssue("unrecognized_metrics", `检索到${ignoredMetrics.length}项未纳入41项目录的指标，已忽略且不会参与计算。`, ignoredMetrics.map((metric) => metric.name)));
  }
  return {
    status: issues.length ? "warning" : "passed",
    warningCount: issues.length,
    coverage: {
      branchMetricCount: metrics.length,
      branchPriorCompleteCount: metrics.length - missingPrior.length,
      branchHistoryCompleteCount: metrics.filter((metric) => metric.history?.length >= 5).length,
      leader: leaderSummary,
    },
    issues,
  };
}

function conciseQualitySummary(quality) {
  return quality.status === "passed"
    ? "通过，未发现需复核的数据质量提示。"
    : `发现${quality.warningCount}类需复核提示；评分与报告结构未受影响。`;
}

function buildRunSummary(report, quality, outputPath) {
  const branchEvidence = report.dimensions
    .filter((dimension) => dimension.status !== "green")
    .map((dimension) => ({
      dimension: dimension.name,
      status: dimension.statusLabel,
      keyMetrics: selectBranchEvidenceMetrics(dimension).map((metric) => metric.name),
    }));
  const leaderEvidence = (report.leader?.dimensions ?? [])
    .filter((dimension) => ["待提升", "预警"].includes(dimension.status))
    .map((dimension) => ({
      dimension: dimension.name,
      status: dimension.status,
      keyMetrics: selectLeaderEvidenceMetrics(dimension).map((metric) => metric.name),
    }));
  return {
    schemaVersion: "2026-09-15",
    report: {
      branchName: report.branchName,
      period: report.period,
      branchClass: report.branchClass || "-",
      outputFile: path.basename(outputPath),
    },
    dataQuality: {
      status: quality.status,
      warningCount: quality.warningCount,
      coverage: quality.coverage,
    },
    branch: {
      overallScore: report.overallScore === null ? null : Number(report.overallScore.toFixed(2)),
      dimensions: report.dimensions.map((dimension) => ({ name: dimension.name, status: dimension.statusLabel, score: Number(dimension.score.toFixed(2)) })),
      keyEvidence: branchEvidence,
    },
    leader: report.leader ? {
      overallScore: Number(report.leader.overall.toFixed(2)),
      dimensions: report.leader.dimensions.map((dimension) => ({ name: dimension.name, status: dimension.status, score: Number(dimension.score.toFixed(2)) })),
      keyEvidence: leaderEvidence,
    } : null,
    comparison: report.peer ? { branchCount: report.peer.count, leaderCount: report.peer.leaderCount } : { branchCount: 0, leaderCount: 0 },
  };
}

function average(values) {
  const usable = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function buildPeerComparisons(profile, metrics, dimensions, leader, peerRecords) {
  // Comparisons are always derived from supplied peer workbooks.
  for (const metric of metrics) for (const point of metric.history ?? []) delete point.peer;
  const seenBranches = new Set();
  const peers = peerRecords.filter((record) =>
    profile.branch_class !== "-"
    && record.profile.branch_class === profile.branch_class
    && record.profile.period === profile.period
    && record.profile.branch_name !== profile.branch_name
  ).filter((record) => {
    if (seenBranches.has(record.profile.branch_name)) throw new Error(`重复同类营业部：${record.profile.branch_name}`);
    seenBranches.add(record.profile.branch_name);
    return true;
  });
  if (!peers.length) return null;

  const peerDimensions = dimensions.map((dimension) => ({
    id: dimension.id,
    name: dimension.name,
    score: average(peers.map((peer) => peer.dimensions.find((item) => item.id === dimension.id)?.score)),
  }));
  const topDimensions = dimensions.map((dimension) => ({
    id: dimension.id,
    score: Math.max(dimension.score, ...peers.map((peer) => peer.dimensions.find((item) => item.id === dimension.id).score)),
  }));
  for (const dimension of dimensions) {
    dimension.peerScore = peerDimensions.find((item) => item.id === dimension.id)?.score ?? null;
  }

  for (const metric of metrics) {
    const peerMetrics = peers
      .map((peer) => peer.metrics.find((item) => item.id === metric.id))
      .filter(Boolean);
    metric.peerCurrent = average(peerMetrics.map((item) => item.current));
    if (metric.history?.length) {
      const peerHistory = new Map();
      for (const peerMetric of peerMetrics) {
        for (const point of peerMetric.history ?? []) {
          const values = peerHistory.get(point.period) ?? [];
          values.push(point.value);
          peerHistory.set(point.period, values);
        }
      }
      metric.history = metric.history.map((point) => ({
        ...point,
        peer: average(peerHistory.get(point.period) ?? []),
      }));
    }
  }

  const leaderPeers = peers.filter((peer) => peer.leader);
  const leaderDimensions = leader && leaderPeers.length
    ? leader.dimensions.map((dimension) => ({
      id: dimension.id,
      name: dimension.name,
      score: average(peers.map((peer) => peer.leader?.dimensions.find((item) => item.id === dimension.id)?.score)),
    }))
    : null;

  const topLeaderDimensions = leaderDimensions?.map((dimension) => ({
    id: dimension.id,
    score: Math.max(leader.dimensions.find((item) => item.id === dimension.id).score,
      ...leaderPeers.map((peer) => peer.leader.dimensions.find((item) => item.id === dimension.id).score)),
  })) ?? null;
  for (const dimension of leader?.dimensions ?? []) {
    for (const metric of dimension.metrics) {
      const peerMetrics = leaderPeers.map((peer) =>
        peer.leader.dimensions.find((item) => item.id === dimension.id).metrics.find((item) => item.id === metric.id)).filter(Boolean);
      // Rating means use the catalog's scores, regardless of whether history was supplied.
      metric.peerValue = average(peerMetrics.map((item) => metric.direction === "rating" ? item.score : Number(item.value)));
      metric.peerValueDisplay = metric.peerValue === null ? "-"
        : formatMetricValue(metric.peerValue, metric.direction === "rating" ? "分" : metric.unit);
      if (metric.history?.length) {
        const peerHistory = new Map();
        for (const peerMetric of peerMetrics) {
          for (const point of peerMetric.history ?? []) {
            const values = peerHistory.get(point.period) ?? [];
            values.push(point.value);
            peerHistory.set(point.period, values);
          }
        }
        metric.history = metric.history.map((point) => ({
          ...point,
          peer: average(peerHistory.get(point.period) ?? []),
        }));
      }
    }
  }

  return {
    count: peers.length,
    dimensions: peerDimensions,
    topDimensions,
    overall: average(peers.map((peer) => peer.overall)),
    leaderOverall: leader ? average(peers.map((peer) => peer.leader?.overall)) : null,
    leaderDimensions,
    topLeaderDimensions,
    leaderCount: leaderPeers.length,
  };
}

function buildFocusText(dimensions) {
  const red = dimensions.filter((dimension) => dimension.status === "red").map((dimension) => `${dimension.name}处于红灯状态`);
  const yellow = dimensions.filter((dimension) => dimension.status === "yellow").map((dimension) => `${dimension.name}需持续改善`);
  return [...red, ...yellow].join("，") || "各维度均处于绿灯状态，保持现有经营节奏";
}

function buildOverviewText(profile, overallScore, dimensions) {
  const current = overallScore === null ? "综合健康度暂无法计算" : `综合健康度${formatNumber(overallScore)}分`;
  const red = dimensions.filter((dimension) => dimension.status === "red").map((dimension) => dimension.name);
  const yellow = dimensions.filter((dimension) => dimension.status === "yellow").map((dimension) => dimension.name);
  const focus = red.length ? `当前重点问题集中在${red.join("、")}，应优先形成专项整改闭环` : yellow.length ? `当前需要持续改善的维度为${yellow.join("、")}，应纳入月度经营跟踪` : "各经营维度保持稳定";
  return `${profile.branch_name}${current}。${focus}。`;
}

function uniqueMeasureSummaries(dimensions, limit = 2) {
  const seen = new Set();
  const summaries = [];
  for (const dimension of dimensions) {
    for (const measure of dimension.measures ?? []) {
      const summary = text(measure?.summary ?? measure).replace(/[。；]+$/, "");
      if (summary && summary !== RULE_GAP && !seen.has(summary)) {
        seen.add(summary);
        summaries.push(summary);
      }
      if (summaries.length === limit) return summaries;
    }
  }
  return summaries;
}

function buildBranchConclusionParagraphs(profile, overallScore, dimensions) {
  const scoreText = overallScore === null ? "综合健康度暂无法计算" : `综合健康度${formatNumber(overallScore)}分`;
  const healthText = overallScore === null ? "-" : overallScore >= 80 ? "健康（绿灯）" : overallScore >= 60 ? "关注（黄灯）" : "异常（红灯）";
  const abnormal = dimensions.filter((dimension) => ["red", "yellow"].includes(dimension.status));
  const strengths = dimensions.filter((dimension) => dimension.status === "green");
  const abnormalText = abnormal.length
    ? abnormal.map((dimension) => {
      const metrics = selectBranchEvidenceMetrics(dimension).map((metric) => metric.name);
      return `${dimension.name}为${dimension.statusLabel}${metrics.length ? `，关键影响指标为${metrics.join("、")}` : ""}`;
    }).join("；")
    : "当前未识别红灯或黄灯维度";
  const strengthText = strengths.length
    ? `${strengths.map((dimension) => dimension.name).join("、")}处于绿灯状态`
    : "当前未识别绿灯维度";
  const measures = uniqueMeasureSummaries(abnormal);
  const solutionText = !abnormal.length
    ? "建议后续按输入数据持续跟踪五维状态"
    : measures.length
      ? `建议${measures.join("；")}`
      : "当前未匹配到可执行的知识库措施，需补充对应规则后再形成整改安排";
  const abnormalClause = abnormal.length ? `当前需优先关注${abnormalText}` : abnormalText;
  return [
    `${profile.branch_name}${scoreText}，综合状态为${healthText}；${abnormalClause}。${strengthText}。${solutionText}。`,
  ];
}

function buildLeaderConclusionParagraphs(leader) {
  if (!leader) return ["综合情况：未提供负责人数据。", "可取之处：-。提升方案：-。"];
  const attention = leader.dimensions.filter((dimension) => ["待提升", "预警"].includes(dimension.status));
  const strengths = leader.dimensions.filter((dimension) => ["优秀", "良好", "达标"].includes(dimension.status));
  const attentionText = attention.length
    ? attention.map((dimension) => {
      const metrics = selectLeaderEvidenceMetrics(dimension).map((metric) => metric.name);
      return `${dimension.name}为${dimension.status}${metrics.length ? `，关键影响指标为${metrics.join("、")}` : ""}`;
    }).join("；")
    : "当前未识别待提升或预警能力";
  const strengthText = strengths.length
    ? `${strengths.map((dimension) => dimension.name).join("、")}达到达标及以上`
    : "当前未识别达标及以上能力";
  const measures = uniqueMeasureSummaries(attention);
  const solutionText = !attention.length
    ? "建议后续按输入数据持续跟踪五维能力"
    : measures.length
      ? `建议${measures.join("；")}`
      : "当前未匹配到可执行的知识库措施，需补充对应规则后再形成提升安排";
  const attentionClause = attention.length ? `当前需优先提升${attentionText}` : attentionText;
  return [
    `负责人综合得分${Number(leader.overall).toFixed(2)}分，综合能力等级为${leaderLevel(leader.overall)}；${attentionClause}。${strengthText}。${solutionText}。`,
  ];
}

function rowsFromOptionalSheet(workbook, name) {
  const values = getSheetValues(workbook, name);
  if (!values || values.length < 2) return null;
  const headers = values[0].map((value) => text(value));
  return nonEmptyRows(values.slice(1)).map((row) => Object.fromEntries(headers.map((header, index) => [header, text(row[index])] )));
}

function matchCauses(workbook, dimension) {
  const optional = rowsFromOptionalSheet(workbook, "原因库");
  if (!optional) return DEFAULT_CAUSES[`${dimension.id}:${dimension.status}`] ?? [RULE_GAP];
  const matched = optional.filter((row) => row["维度ID"] === dimension.id && row["状态"] === dimension.statusLabel && row["原因"]);
  return matched.length ? matched.map((row) => row["原因"]).slice(0, 4) : [RULE_GAP];
}

function matchMeasures(workbook, profile, dimension) {
  const optional = rowsFromOptionalSheet(workbook, "措施库");
  if (!optional) return DEFAULT_MEASURES[dimension.id] ?? [{ summary: RULE_GAP, owner: "", resource: "", priority: "" }];
  const candidates = optional
    .filter((row) => row["维度ID"] === dimension.id && row["状态"] === dimension.statusLabel)
    .map((row) => {
      const fields = ["营业部类别", "经营标准ID"];
      let score = 0;
      for (const field of fields) {
        if (row[field] && row[field] !== profile[field]) return null;
        if (row[field] && row[field] === profile[field]) score += 2;
      }
      const priorityScore = row["优先级"] === "高" ? 3 : row["优先级"] === "中" ? 2 : 1;
      return {
        score: score * 10 + priorityScore,
        summary: row["建议措施"],
        owner: row["责任部门"],
        resource: row["资源支持"],
        priority: row["优先级"] || "中",
      };
    })
    .filter(Boolean)
    .filter((row) => row.summary)
    .sort((a, b) => b.score - a.score);
  const unique = [];
  const seen = new Set();
  for (const row of candidates) {
    if (!seen.has(row.summary)) {
      seen.add(row.summary);
      unique.push(row);
    }
  }
  return unique.length ? unique.slice(0, 3) : [{ summary: RULE_GAP, owner: "", resource: "", priority: "" }];
}

function buildReport(workbook, profile, metrics, dimensions, ignoredMetrics = []) {
  const enriched = dimensions.map((dimension) => ({
    ...dimension,
    causes: dimension.status === "green" || dimension.status === "missing" ? [] : matchCauses(workbook, dimension),
    measures: dimension.status === "green" || dimension.status === "missing" ? [] : matchMeasures(workbook, profile, dimension),
  }));
  const abnormal = enriched.filter((dimension) => dimension.status !== "green");
  const core = enriched.filter((dimension) => dimension.status === "red");
  const attention = enriched.filter((dimension) => dimension.status === "yellow");
  const overallScore = aggregateOverall(enriched);
  return {
    branchName: profile.branch_name,
    period: profile.period,
    reportDate: formatReportDate(new Date()),
    managerName: profile.manager_name || "",
    branchClass: profile.branch_class || "",
    regionType: profile.region_type || "",
    developmentStage: profile.development_stage || "",
    operatingStandardId: profile.operating_standard_id || "",
    managerTenureStart: profile.manager_tenure_start || "",
    establishedAt: profile.established_at || "",
    staffCount: profile.staff_count || "",
    annualRevenue: profile.annual_revenue || "",
    annualProfit: profile.annual_profit || "",
    peerRank: profile.peer_rank || "",
    totalAssets: profile.total_assets || "",
    assetOver10kCount: profile.asset_over_10k_count || "",
    overallScore,
    focusText: buildFocusText(enriched),
    overviewText: buildOverviewText(profile, overallScore, enriched),
    conclusionParagraphs: buildBranchConclusionParagraphs(profile, overallScore, enriched),
    dataStatus: enriched.some((dimension) => dimension.status === "missing") ? "incomplete" : "complete",
    missingMetrics: metrics.filter((metric) => metric.status === "missing").map((metric) => ({ id: metric.id, name: metric.name, dimensionName: metric.dimensionName })),
    counts: {
      green: enriched.filter((dimension) => dimension.status === "green").length,
      yellow: attention.length,
      red: core.length,
      abnormal: abnormal.length,
    },
    dimensions: enriched,
    core,
    attention,
    metrics,
    ignoredMetrics,
    generatedBy: "branch-health-checkup",
  };
}

function formatReportDate(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function escHtml(value) { return String(value ?? "-").replace(/[&<>\"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#39;"}[c])); }
function statusTag(status, label, manager = false) { if (manager) { const text = ["green", "yellow"].includes(label) ? (label === "green" ? "达标" : "待提升") : (label || status); const cls = ["优秀", "良好", "达标"].includes(text) ? "status-green" : text === "预警" ? "status-red" : "status-yellow"; return `<span class="status-mini ${cls}">${escHtml(text)}</span>`; } return `<span class="status-mini status-${status}">${escHtml(label || status)}</span>`; }
function finalizeHtmlDocument(html) {
  // The report body has no outer wrapper; retain the footnote and remove the legacy extra closing div.
  const fixed = html.replace(/(<div class="footnote">[\s\S]*?<\/div>)<\/div>(<\/body>\s*<\/html>)$/, "$1$2");
  const openDivs = (fixed.match(/<div\b/gi) || []).length;
  const closeDivs = (fixed.match(/<\/div>/gi) || []).length;
  if (openDivs !== closeDivs) throw new Error(`生成报告HTML结构无效：div开始标签${openDivs}个，结束标签${closeDivs}个`);
  if (!fixed.startsWith("<!DOCTYPE html>") || !fixed.trimEnd().endsWith("</html>")) {
    throw new Error("生成报告HTML文档边界无效");
  }
  return fixed;
}

function selectBranchEvidenceMetrics(dimension) {
  return (dimension.metrics || []).filter(m => m.history?.length >= 2 || (m.current != null && m.prior != null))
    .sort((a,b) => ((100-(a.score??100))*a.weight) - ((100-(b.score??100))*b.weight)).reverse().slice(0, 2);
}

function trendText(dimension) {
  const rows = selectBranchEvidenceMetrics(dimension);
  if (dimension.status === "green") return "-";
  if (!rows.length) return "-";
  return rows.map(m => {
    const series = m.history?.length >= 2 ? m.history : (m.prior != null ? [{period:"上期",value:m.prior},{period:"本期",value:m.current}] : []);
    if (series.length < 2) return `${m.name}历史数据不足`;
    const first = series[0].value; const last = series[series.length-1].value; const delta = last - first; const improved = m.direction === "lower" ? delta < 0 : delta > 0;
    const pct = first === 0 ? null : Math.abs(delta / first * 100);
    if (series.some(p => String(p.period).includes('截至'))) return `${m.name}展示历年与本期变化，末年为截至7月值，累计项不与全年值直接判断增减`;
    return `${m.name}${improved ? "改善" : delta === 0 ? "持平" : "回落"}${pct == null ? "" : `${pct.toFixed(1)}%`}`;
  }).join("；");
}
function trendChart(dimension) {
  if (dimension.status === "green") return "";
  const rows = selectBranchEvidenceMetrics(dimension);
  return rows.map(m => {
    const series = m.history?.length >= 2
      ? m.history
      : (m.prior != null ? [{period:"上期",value:m.prior},{period:"本期",value:m.current}] : []);
    if (series.length < 2) return "";
    const peerSeries = series.filter((point) => point.peer != null);
    const allValues = [...series.map((point) => point.value), ...peerSeries.map((point) => point.peer)];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const span = max - min || 1;
    const x = (index) => (50 + index * 258 / (series.length - 1)).toFixed(1);
    const y = (value) => (132 - (value - min) / span * 100).toFixed(1);
    const points = series.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
    const peerPoints = peerSeries.length === series.length
      ? series.map((point, index) => `${x(index)},${y(point.peer)}`).join(" ")
      : "";
    const legend = peerPoints
      ? `<div class="trend-legend"><span><i class="branch-line"></i>本机构</span><span><i class="peer-line"></i>同类均值</span></div>`
      : "";
    return `<div class="trend-card"><div class="trend-card-title">${escHtml(m.name)}趋势</div><svg viewBox="0 0 330 180" role="img" aria-label="${escHtml(m.name)}历史趋势"><line class="trend-gridline" x1="40" y1="24" x2="318" y2="24"/><line class="trend-gridline" x1="40" y1="80" x2="318" y2="80"/><line class="trend-gridline" x1="40" y1="136" x2="318" y2="136"/><line class="trend-axis" x1="40" y1="24" x2="40" y2="136"/><line class="trend-axis" x1="40" y1="136" x2="318" y2="136"/><polyline class="trend-branch" points="${points}"/>${peerPoints ? `<polyline class="trend-peer" points="${peerPoints}"/>` : ""}${series.map((point,i)=>`<text class="trend-value" x="${x(i)}" y="${(124-(point.value-min)/span*100).toFixed(1)}" text-anchor="middle">${escHtml(formatMetricValue(point.value,m.unit))}</text><text class="trend-label" x="${x(i)}" y="153" text-anchor="${i === series.length - 1 ? "end" : i === 0 ? "start" : "middle"}">${escHtml(point.period.split("（")[0])}${point.period.includes("（") ? `<tspan x="${x(i)}" dy="12">${escHtml("（" + point.period.split("（").slice(1).join("（"))}</tspan>` : ""}</text>`).join("")}</svg>${legend}</div>`;
  }).join("");
}

function leaderMetricNumericValue(metric, value) {
  if (value === null || value === undefined || value === "") return null;
  return metric.direction === "rating" ? scoreLeaderMetric(metric, value) : Number(value);
}

function leaderMetricDisplay(metric, value) {
  return formatLeaderValue(value, metric.unit);
}

function leaderMetricImpact(metric) {
  return Number(metric.weight || 0) * Math.max(0, 100 - Number(metric.score || 0));
}

function selectLeaderEvidenceMetrics(dimension) {
  return (dimension.metrics || [])
    .map((metric, index) => ({ ...metric, evidenceImpact: leaderMetricImpact(metric), sourceOrder: index }))
    .filter((metric) => metric.evidenceImpact > 0)
    .sort((a, b) => b.evidenceImpact - a.evidenceImpact || a.sourceOrder - b.sourceOrder)
    .slice(0, 2);
}

function leaderMetricSeries(metric) {
  if (metric.history?.length >= 2) return metric.history;
  const prior = leaderMetricNumericValue(metric, metric.prior);
  const current = leaderMetricNumericValue(metric, metric.current);
  if (!Number.isFinite(prior) || !Number.isFinite(current)) return [];
  return [
    { period: "上期", value: prior, displayValue: leaderMetricDisplay(metric, metric.prior) },
    { period: "本期", value: current, displayValue: leaderMetricDisplay(metric, metric.current) },
  ];
}

function leaderMetricChangeText(metric) {
  if (metric.prior === null || metric.prior === undefined || metric.prior === "") return "未提供上期值";
  if (metric.direction === "rating") {
    const priorScore = leaderMetricNumericValue(metric, metric.prior);
    if (priorScore === metric.score) return `较上期${leaderMetricDisplay(metric, metric.prior)}档持平`;
    return `较上期由${leaderMetricDisplay(metric, metric.prior)}档变为${leaderMetricDisplay(metric, metric.current)}档`;
  }
  const current = leaderMetricNumericValue(metric, metric.current);
  const prior = leaderMetricNumericValue(metric, metric.prior);
  if (!Number.isFinite(current) || !Number.isFinite(prior)) return "未提供可比较的上期值";
  if (current === prior) return "较上期持平";
  const improved = metric.direction === "lower" ? current < prior : current > prior;
  const ratio = prior === 0 ? "" : `（${(Math.abs((current - prior) / prior) * 100).toFixed(1)}%）`;
  return `较上期${improved ? "改善" : "回落"}${ratio}`;
}

function leaderTrendText(metrics) {
  return metrics.map((metric) => {
    const cutoffNote = (metric.history || []).some((point) => String(point.period).includes("截至"))
      ? "；近五年记录含截至期，图表仅用于观察变化轨迹，不与历年全年值直接作增减判断"
      : "";
    const peerNote = metric.peerValueDisplay && metric.peerValueDisplay !== "-" ? `，同类均值${metric.peerValueDisplay}` : "";
    return `${metric.name}本期${metric.valueDisplay || leaderMetricDisplay(metric, metric.current)}${peerNote}，${leaderMetricChangeText(metric)}${cutoffNote}`;
  }).join("；");
}

function leaderTrendCharts(metrics) {
  return metrics.map((metric) => {
    const series = leaderMetricSeries(metric);
    if (series.length < 2) return "";
    const peerSeries = series.filter((point) => Number.isFinite(point.peer));
    const allValues = [...series.map((point) => point.value), ...peerSeries.map((point) => point.peer)];
    const min = Math.min(...allValues);
    const max = Math.max(...allValues);
    const span = max - min || 1;
    const x = (index) => (50 + index * 258 / (series.length - 1)).toFixed(1);
    const y = (value) => (132 - (value - min) / span * 100).toFixed(1);
    const points = series.map((point, index) => `${x(index)},${y(point.value)}`).join(" ");
    const peerPoints = peerSeries.length === series.length
      ? series.map((point, index) => `${x(index)},${y(point.peer)}`).join(" ")
      : "";
    const legend = peerPoints
      ? `<div class="trend-legend"><span><i class="branch-line"></i>本机构</span><span><i class="peer-line"></i>同类均值</span></div>`
      : "";
    const labels = series.map((point, index) => {
      const rawPeriod = String(point.period);
      const [period, ...suffix] = rawPeriod.split("（");
      const value = point.displayValue || (metric.direction === "rating" ? `${point.value}分` : formatMetricValue(point.value, metric.unit));
      return `<text class="trend-value" x="${x(index)}" y="${(124 - (point.value - min) / span * 100).toFixed(1)}" text-anchor="middle">${escHtml(value)}</text><text class="trend-label" x="${x(index)}" y="153" text-anchor="${index === series.length - 1 ? "end" : index === 0 ? "start" : "middle"}">${escHtml(period)}${suffix.length ? `<tspan x="${x(index)}" dy="12">${escHtml("（" + suffix.join("（"))}</tspan>` : ""}</text>`;
    }).join("");
    const title = series.length >= 4 ? `${metric.name}近五年趋势` : `${metric.name}本期较上期变化`;
    return `<div class="trend-card"><div class="trend-card-title">${escHtml(title)}</div><svg viewBox="0 0 330 180" role="img" aria-label="${escHtml(metric.name)}历史趋势"><line class="trend-gridline" x1="40" y1="24" x2="318" y2="24"/><line class="trend-gridline" x1="40" y1="80" x2="318" y2="80"/><line class="trend-gridline" x1="40" y1="136" x2="318" y2="136"/><line class="trend-axis" x1="40" y1="24" x2="40" y2="136"/><line class="trend-axis" x1="40" y1="136" x2="318" y2="136"/><polyline class="trend-branch" points="${points}"/>${peerPoints ? `<polyline class="trend-peer" points="${peerPoints}"/>` : ""}${labels}</svg>${legend}</div>`;
  }).join("");
}

function renderLeaderDigitalFlow(metrics) {
  const stages = [...metrics].sort((a, b) => a.id.localeCompare(b.id));
  const stageLabels = { L0402: "线索执行", L0403: "线索转化" };
  const track = stages.map((metric, index) => {
    const peer = metric.peerValueDisplay && metric.peerValueDisplay !== "-" ? `<span class="digital-stage-peer">同类 ${escHtml(metric.peerValueDisplay)}</span>` : "";
    const stage = `<div class="digital-stage"><div class="digital-stage-kicker">0${index + 1} · ${stageLabels[metric.id] || "关键环节"}</div><div class="digital-stage-name">${escHtml(metric.name)}</div><div class="digital-stage-values"><strong>${escHtml(metric.valueDisplay || leaderMetricDisplay(metric, metric.current))}</strong>${peer}</div></div>`;
    return index === stages.length - 1 ? stage : `${stage}<div class="digital-flow-arrow" aria-hidden="true"><span>→</span></div>`;
  }).join("");
  return `<div class="digital-flow" role="group" aria-label="数字化线索经营链路"><div class="digital-flow-title">数字化线索经营链路</div><div class="digital-flow-track leader-flow-two">${track}</div></div>`;
}

function renderLeaderEvidence(dimension) {
  const metrics = selectLeaderEvidenceMetrics(dimension);
  if (!metrics.length) return { narrative: "", visual: "" };
  const digitalChain = dimension.id === "L04" && metrics.length === 2 && metrics.every((metric) => ["L0402", "L0403"].includes(metric.id));
  const chartable = metrics.filter((metric) => leaderMetricSeries(metric).length >= 2);
  const metricNames = metrics.map((metric) => metric.name).join("、");
  const narrative = `${leaderTrendText(metrics)}；归因分析：按指标权重与当前表现识别，${metricNames}是${dimension.name}需要优先核验的关键影响指标`;
  if (digitalChain) {
    return { narrative, visual: renderLeaderDigitalFlow(metrics) };
  }
  const charts = chartable.length ? `<div class="trend-row">${leaderTrendCharts(chartable)}</div>` : "";
  return { narrative, visual: charts };
}

function templateRadarSvg(reference, values, labels, manager = false, comparison = null) {
  const shape = manager ? "manager-shape" : "branch";
  const labelClass = manager ? "manager-lbl" : "lbl";
  const peerShape = manager ? "manager-peer" : "peer";
  const topShape = manager ? "manager-top" : "top";
  // Keep the complete template SVG, including its defs/style and label anchors.
  let svg = [...reference.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)]
    .map(match => match[0]).find(fragment => fragment.includes(`class="${shape}"`));
  if (!svg) throw new Error(`Missing template radar: ${shape}`);
  const points = values.map((value, i) => {
    const angle = -Math.PI / 2 + i * 2 * Math.PI / values.length;
    const radius = 90 * Math.max(0, Math.min(100, Number(value) || 0)) / 100;
    return `${(radius * Math.cos(angle)).toFixed(1)},${(radius * Math.sin(angle)).toFixed(1)}`;
  }).join(" ");
  svg = svg.replace(new RegExp(`(<polygon class="${shape}" points=")[^"]*`), (_, prefix) => prefix + points);
  let labelIndex = 0;
  svg = svg.replace(new RegExp(`(<text class="${labelClass}"[^>]*>)[^<]*`, "g"),
    (_, prefix) => prefix + escHtml(labels[labelIndex++]));
  // Bind every comparison series or remove its example polygon and legend together.
  for (const [seriesShape, seriesValues, color, legend] of [
    [peerShape, comparison?.peerValues, "#999", "同类均值"],
    [topShape, comparison?.topValues, "#666", "同类第一名"],
  ]) {
    if (seriesValues?.length === values.length && seriesValues.every(Number.isFinite)) {
    const peerPoints = seriesValues.map((value, i) => {
      const angle = -Math.PI / 2 + i * 2 * Math.PI / seriesValues.length;
      const radius = 90 * Math.max(0, Math.min(100, Number(value) || 0)) / 100;
      return `${(radius * Math.cos(angle)).toFixed(1)},${(radius * Math.sin(angle)).toFixed(1)}`;
    }).join(" ");
    svg = svg.replace(new RegExp(`(<polygon class="${seriesShape}" points=")[^"]*`), (_, prefix) => prefix + peerPoints);
  } else {
    svg = svg.replace(new RegExp(`\\s*<polygon class="${seriesShape}"[^>]*\\/?>`, "g"), "")
      .replace(new RegExp(`\\s*<line\\b[^>]*y1="240"[^>]*stroke="${color}"[^>]*\\/>`, "g"), "")
      .replace(new RegExp(`\\s*<text\\b[^>]*>${legend}<\\/text>`, "g"), "");
  }
  }
  return svg.replace("<svg ", `<svg role="img" aria-label="${escHtml(labels.join("、"))}" `);
}
function renderDynamicHtmlBase(report, reference) {
  const css = reference.match(/<style>([\s\S]*?)<\/style>/i)?.[1] || "";
  const radarSvg = (values, labels, manager = false, comparison = null) => templateRadarSvg(reference, values, labels, manager, comparison);
  const dims = report.dimensions || []; const leader = report.leader; const managerDims = leader?.dimensions || [];
  const peerDims = report.peer?.dimensions || [];
  const peerManagerDims = report.peer?.leaderDimensions || [];
  const branchRadarComparison = peerDims.length ? { peerValues: peerDims.map((dimension) => dimension.score), topValues: report.peer.topDimensions.map((dimension) => dimension.score) } : null;
  const managerRadarComparison = peerManagerDims.length ? { peerValues: peerManagerDims.map((dimension) => dimension.score), topValues: report.peer.topLeaderDimensions.map((dimension) => dimension.score) } : null;
  const level = s => s === "green" ? "绿灯" : s === "yellow" ? "黄灯" : s === "red" ? "红灯" : "-";
  const managerLevel = s => s || "-";
  const basic = [["本年营业收入", report.annualRevenue], ["本年考核利润", report.annualProfit], ["考核同类排名", report.peerRank], ["总资产", report.totalAssets], ["资产过万户数", report.assetOver10kCount], ["负责人任职时间", report.managerTenureStart]];
  const metricCounts = Object.fromEntries(["green", "yellow", "red"].map(status =>
    [status, dims.reduce((sum, dimension) => sum + dimension[`${status}Count`], 0)]));
  const rows = d => d.map(x=>`<tr><td><strong>${escHtml(x.name)}</strong></td><td>${x.greenCount}</td><td>${x.yellowCount}</td><td>${x.redCount}</td><td>${compactNumber(x.weightedScore)} / ${compactNumber(x.maxScore)}</td></tr>`).join("")
    + `<tr class="summary-total"><td>合计</td><td>${metricCounts.green}</td><td>${metricCounts.yellow}</td><td>${metricCounts.red}</td><td>${compactNumber(report.overallScore)} / 100</td></tr>`;
  const managerRows = managerDims => managerDims.map(x=>`<tr><td><strong>${escHtml(x.name)}</strong></td><td class="manager-score">${compactNumber(x.score)}</td><td class="manager-status" data-ability-level="${escHtml(x.status)}">${escHtml(x.status)}</td></tr>`).join("")
    + `<tr class="summary-total"><td>综合得分</td><td class="manager-score">${compactNumber(leader.overall)} / 100</td><td data-ability-level="${leaderLevel(leader.overall)}">${leaderLevel(leader.overall)}</td></tr>`;
  const cards = list => list.map(d => {
    const isManager = Boolean(d.manager);
    const label = isManager ? d.status : level(d.status);
    const chart = isManager ? "" : trendChart(d);
    const evidence = isManager
      ? renderLeaderEvidence(d)
      : {
        narrative: trendText(d) === "-" ? "" : `${trendText(d)}；归因分析：按指标权重与当前表现识别，${selectBranchEvidenceMetrics(d).map((metric) => metric.name).join("、")}是${d.name}异常的主要影响指标，需优先核验其经营过程`,
        visual: chart ? `<div class="trend-row">${chart}</div>` : "",
      };
    const threshold = isManager
      ? "优秀≥90分；良好80-89.99分；达标70-79.99分；待提升60-69.99分；预警＜60分"
      : "红灯＜60分；黄灯60-79.99分；绿灯≥80分";
    const cardStatus = isManager && d.status === "预警" ? "red" : isManager ? "yellow" : d.status;
    const causes = [evidence.narrative, ...(d.causes || [])].filter(Boolean).map(escHtml).join("；") || "-";
    return `<div class="item item-${cardStatus}"><div class="ri-head">${escHtml(d.name)} ${statusTag(d.status,label,isManager)}</div><div class="ri-val">当前得分：${d.score==null?"-":Number(d.score).toFixed(2)} / 100　|　能力等级：${escHtml(label)}　|　阈值：${threshold}</div><div class="ri-cause trend-cause"><div class="cause-line"><strong>可能原因：</strong>${causes}</div>${evidence.visual}</div><div class="ri-action"><strong>建议措施：</strong>${(d.measures||[]).map(m=>escHtml(m.summary||m)).join("；")||"-"}</div></div>`;
  }).join("");
  const managerTableRows = leader ? managerRows(managerDims) : "<tr><td colspan=3>-</td></tr>";
  const abnormalThemes = [
    ["核心异常主题", "红灯", report.core],
    ["需关注主题", "黄灯", report.attention],
  ].filter(([, , items]) => items.length > 0)
    .map(([title, status, items]) => `<h2>${title}（${status} · 共${items.length}项）</h2>${cards(items)}`)
    .join("");
  const managerAttentionDimensions = managerDims.filter(d => ["待提升", "预警"].includes(d.status));
  const managerAttentionCards = leader ? cards(managerAttentionDimensions) : "";
  const appendix = dims.map(d=>`<div class="appendix-block"><div class="appendix-head"><span class="dim-name">${escHtml(d.name)}</span><span class="dim-score">${d.score==null?"-":Number(d.score).toFixed(2)} / 100</span><span class="light-count">绿灯 ${d.greenCount} | 黄灯 ${d.yellowCount} | 红灯 ${d.redCount}</span></div><table class="appendix-table"><thead><tr><th style="width:34%">指标名称</th><th style="width:16%">总值</th><th style="width:12%">线上值</th><th style="width:12%">线下值</th><th style="width:10%" class="score">得分</th><th style="width:16%">当前状态</th></tr></thead><tbody>${report.metrics.filter(m=>m.dimensionId===d.id).map(m=>`<tr><td>${escHtml(m.name)}</td><td>${escHtml(m.currentDisplay)}</td><td>${escHtml(m.onlineDisplay)}</td><td>${escHtml(m.offlineDisplay)}</td><td class="score">${m.score==null?"-":Number(m.score).toFixed(2)}</td><td>${statusTag(m.status,level(m.status))}</td></tr>`).join("")}</tbody></table></div>`).join("");
  const leaderPeerNote = report.peer ? `同类均值按${report.peer.leaderCount}家同类营业部的有效负责人数据计算，团队凝聚力按A/B/C/D等级折算分计算均值。` : "未提供同类负责人数据，同类均值以“-”表示。";
  const leaderAppendix = `<p class="manager-appendix-note">${leaderPeerNote}</p>` + managerDims.map(d=>`<div class="appendix-block"><div class="appendix-head"><span class="dim-name">${escHtml(d.name)}</span><span class="dim-score">${Number(d.score).toFixed(2)} / 100</span><span class="light-count" data-ability-level="${escHtml(d.status)}">能力等级：${escHtml(d.status)}</span></div><table class="appendix-table manager-appendix-table"><thead><tr><th>方案评价指标</th><th>本期表现</th><th>同类均值</th><th class="score">得分</th></tr></thead><tbody>${(d.metrics||[]).map(m=>`<tr><td>${escHtml(m.name)}</td><td>${escHtml(m.valueDisplay||m.currentDisplay||m.value)}</td><td>${escHtml(m.peerValueDisplay ?? "-")}</td><td class="score">${Number(m.score).toFixed(2)}</td></tr>`).join("")}</tbody></table></div>`).join("");
  const branchStatus = report.overallScore == null ? "missing" : report.overallScore >= 80 ? "green" : report.overallScore >= 60 ? "yellow" : "red";
  const overallStatus = report.overallScore == null ? "-" : report.overallScore>=80?"健康（绿灯）":report.overallScore>=60?"关注（黄灯）":"异常（红灯）";
  const abilityShortNames = { L01: "团队", L02: "经营", L03: "财富", L04: "数字", L05: "合规" };
  const abilitySummary = leader ? `<div class="ability-meta" aria-label="负责人五维得分">${managerDims.map(d => `<span title="${escHtml(d.name)}：${compactNumber(d.score)}分">${abilityShortNames[d.id]}${compactNumber(d.score)}</span>`).join('<span aria-hidden="true">|</span>')}</div>` : "";
  const managerOverall = leader ? `<div class="score-num" data-ability-level="${leaderLevel(leader.overall)}">${Number(leader.overall).toFixed(2)}</div><div class="score-info"><h2 data-ability-level="${leaderLevel(leader.overall)}">综合能力等级：${leaderLevel(leader.overall)}</h2><p>负责人五维能力综合得分</p><p class="focus">重点提升：${escHtml(managerAttentionDimensions.map(d=>d.name).join("、")||"-")}</p>${abilitySummary}</div>` : `<div class="score-num">-</div><div class="score-info"><h2>综合能力等级：-</h2><p>负责人数据未提供</p></div>`;
  const branchTableHead = "<tr><th>维度</th><th>绿</th><th>黄</th><th>红</th><th>得分</th></tr>";
  const managerTableHead = "<tr><th>能力维度</th><th>得分</th><th>状态</th></tr>";
  if (report.peer) report.overviewText += " 同类第一名为本机构及同类别、同期间输入中各维度的最高分，各维度可能来自不同机构。";
  return `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(report.branchName)}经营体检报告</title><style>${css}</style></head><body><div class="report-header"><h1>${escHtml(report.branchName)}经营体检报告</h1><div class="branch-info"><span>报告日期：${escHtml(report.reportDate)}</span><span>统计期间：${escHtml(report.period)}</span><span>负责人：${escHtml(report.managerName||"-")}</span><span>营业部类别：${escHtml(report.branchClass||"-")}</span></div></div><div class="basic-info-box"><div class="basic-info-title">基本信息</div><div class="basic-info-grid">${basic.map(([k,v])=>`<div class="basic-info-item"><span class="basic-info-label">${escHtml(k)}</span><span class="basic-info-value">${escHtml(v||"-")}</span></div>`).join("")}</div></div><div class="summary-heading-row"><div>营业部综合情况</div><div>负责人综合情况</div></div><div class="score-banner"><div class="summary-panel"><div class="summary-panel-body"><div class="score-num" data-branch-status="${branchStatus}">${report.overallScore==null?"-":Number(report.overallScore).toFixed(2)}</div><div class="score-info"><h2>综合健康度：${overallStatus}</h2><p>五大维度加权综合得分</p><p class="focus">本月重点关注：${escHtml(report.focusText)}</p><div class="light-summary"><span>绿灯 <span class="count">${report.counts.green}</span></span><span>黄灯 <span class="count">${report.counts.yellow}</span></span><span>红灯 <span class="count">${report.counts.red}</span></span></div></div></div></div><div class="summary-panel"><div class="summary-panel-body">${managerOverall}</div></div></div><section><div class="dual-summary-grid"><article class="summary-column"><div class="summary-grid"><div class="radar-box"><div class="chart-title">${report.peer ? "营业部五维对标" : "营业部五维得分"}</div>${radarSvg(dims.map(d=>d.score||0),dims.map(d=>d.name),false,branchRadarComparison)}</div><div class="summary-table-wrap"><div class="chart-title">五大核心维度</div><table class="summary-table"><thead>${branchTableHead}</thead><tbody>${rows(dims)}</tbody></table></div></div></article><article class="summary-column"><div class="summary-grid"><div class="radar-box"><div class="chart-title">${report.peer ? "负责人五维能力对标" : "负责人五维能力"}</div>${leader?radarSvg(managerDims.map(d=>d.score||0),managerDims.map(d=>d.name),true,managerRadarComparison):"-"}</div><div class="summary-table-wrap"><div class="chart-title">五维能力得分</div><table class="summary-table manager-summary-table"><thead>${managerTableHead}</thead><tbody>${leader?managerTableRows:"<tr><td colspan=3>-</td></tr>"}</tbody></table></div></div></article></div><div class="overall-box"><div class="ob-title">总体概述</div><div class="ob-text">${escHtml(report.overviewText)}${report.peer ? ` 同类参照为${report.peer.count}家${escHtml(report.branchClass || "")}类营业部均值。` : ""}</div></div></section><div class="chapter-heading">分支机构分析</div>${abnormalThemes ? `<section>${abnormalThemes}</section>` : ""}<section><h2>诊断结论</h2><div class="conclusion"><p>${escHtml(report.conclusionText)}</p></div></section><section class="manager-analysis-section"><div class="chapter-heading">负责人分析</div>${managerDims.some(d=>d.score<70) ? `<h2>需关注能力</h2>${managerAttentionCards}` : ""}<h2>负责人诊断结论</h2><div class="conclusion"><p>${leader?`负责人综合得分${Number(leader.overall).toFixed(2)}分。${managerDims.filter(d=>d.score<70).length?"应优先提升"+managerDims.filter(d=>d.score<70).map(d=>d.name).join("、")+"。":"五维能力均达到70分达标线。"}`:"-"}</p></div></section><section class="appendix-section"><h2>附录：所有指标详情</h2>${appendix}<div class="manager-appendix-start"><div class="appendix-subheading">负责人能力细项指标</div>${leader?leaderAppendix:"<p>-</p>"}</div></section><div class="footnote">本报告由本地输入数据动态生成</div></div></body></html>`;
}

function renderConclusionParagraphs(paragraphs) {
  return paragraphs.map((paragraph) => `<p>${escHtml(paragraph)}</p>`).join("");
}

function renderDynamicHtml(report, reference) {
  const html = renderDynamicHtmlBase(report, reference);
  const branchConclusion = `<section><h2>诊断结论</h2><div class="conclusion">${renderConclusionParagraphs(report.conclusionParagraphs ?? [])}</div></section>`;
  const leaderConclusion = `<h2>负责人诊断结论</h2><div class="conclusion">${renderConclusionParagraphs(buildLeaderConclusionParagraphs(report.leader))}</div>`;
  return html
    .replace(/<section><h2>诊断结论<\/h2><div class="conclusion"><p>[\s\S]*?<\/p><\/div><\/section>/, branchConclusion)
    .replace(/<h2>负责人诊断结论<\/h2><div class="conclusion"><p>[\s\S]*?<\/p><\/div>/, leaderConclusion);
}

async function main() {
  const { inputPath, outputDir, branchName, period, knowledgePath, peerInputPaths } = parseArgs(process.argv);
  validateMetricCatalog();
  console.error("正在读取营业部基础信息与41项指标...");
  await fs.access(inputPath);
  await fs.mkdir(outputDir, { recursive: true });
  const workbook = await loadInput(inputPath, { branchName, period });
  const adjacentKnowledge = path.resolve(path.dirname(inputPath), '..', 'knowledge', '原因措施知识库.xlsx');
  const chosenKnowledge = knowledgePath || (await fs.stat(adjacentKnowledge).catch(() => null) ? adjacentKnowledge : null);
  if (chosenKnowledge) {
    const knowledge = await loadInput(chosenKnowledge);
    for (const name of ['原因库', '措施库']) {
      const rows = knowledge.sheets.get(name);
      if (!rows || rows.length < 2) throw new Error(`独立知识库缺少有效${name}`);
      workbook.sheets.set(name, rows);
    }
  }
  const profile = readProfile(workbook);
  const { metrics, ignoredMetrics } = readMetrics(workbook);
  readTrendHistory(workbook, metrics);
  const missingMetrics = metrics.filter((metric) => metric.status === "missing");
  if (ignoredMetrics.length) {
    console.error(`IGNORED_METRICS=${JSON.stringify(ignoredMetrics)}`);
  }
  if (missingMetrics.length) {
    console.error(`MISSING_METRICS=${JSON.stringify(missingMetrics.map((metric) => ({ id: metric.id, name: metric.name, dimensionName: metric.dimensionName })))}`);
    throw new Error(`检索不到 ${missingMetrics.length} 项指标数据，请补全缺失指标后再继续分析`);
  }
  console.error("正在计算营业部五维得分...");
  const dimensions = aggregateDimensions(metrics);
  const report = buildReport(workbook, profile, metrics, dimensions, ignoredMetrics);
  console.error("正在分析负责人数据与能力得分...");
  report.leader = readLeaderWorkbook(workbook);
  if (report.leader) for (const d of report.leader.dimensions) {
    d.manager = true;
    d.statusLabel = d.status;
    d.causes = matchCauses(workbook, d);
    d.measures = matchMeasures(workbook, profile, d);
  }
  console.error("正在读取同类营业部数据，计算同类均值与各维度第一名...");
  const peerRecords = [];
  for (const peerInputPath of peerInputPaths) {
    await fs.access(peerInputPath);
    const peerWorkbook = await loadInput(peerInputPath);
    const peerProfile = readProfile(peerWorkbook);
    const { metrics: peerMetrics, ignoredMetrics: peerIgnoredMetrics } = readMetrics(peerWorkbook);
    const peerMissingMetrics = peerMetrics.filter((metric) => metric.status === "missing");
    if (peerIgnoredMetrics.length) console.error(`IGNORED_PEER_METRICS=${JSON.stringify({ file: peerInputPath, metrics: peerIgnoredMetrics })}`);
    if (peerMissingMetrics.length) {
      throw new Error(`同类参照文件 ${path.basename(peerInputPath)} 缺少 ${peerMissingMetrics.length} 项指标数据`);
    }
    readTrendHistory(peerWorkbook, peerMetrics);
    const peerDimensions = aggregateDimensions(peerMetrics);
    peerRecords.push({
      profile: peerProfile,
      metrics: peerMetrics,
      dimensions: peerDimensions,
      overall: aggregateOverall(peerDimensions),
      leader: readLeaderWorkbook(peerWorkbook),
      ignoredMetrics: peerIgnoredMetrics,
    });
  }
  report.peer = buildPeerComparisons(profile, metrics, report.dimensions, report.leader, peerRecords);
  console.error("正在校验输入数据质量与分析覆盖范围...");
  const subjectQuality = evaluateDataQuality(profile, metrics, report.leader, ignoredMetrics, report.overallScore);
  const peerQuality = peerRecords.map((record) => ({
    branchName: record.profile.branch_name,
    ...evaluateDataQuality(record.profile, record.metrics, record.leader, record.ignoredMetrics, record.overall),
  }));
  const inputQuality = {
    version: "2026-09-15",
    subject: subjectQuality,
    peers: {
      examinedCount: peerQuality.length,
      warningBranchCount: peerQuality.filter((quality) => quality.status === "warning").length,
      branches: peerQuality.filter((quality) => quality.status === "warning").map((quality) => ({
        branchName: quality.branchName,
        warningCount: quality.warningCount,
      })),
    },
  };
  console.error(`输入质量校验：${conciseQualitySummary(subjectQuality)}`);
  console.error(`INPUT_QUALITY=${JSON.stringify(inputQuality)}`);
  console.error(`同类参照：${report.peer?.count ?? 0}家营业部，${report.peer?.leaderCount ?? 0}份负责人数据。正在生成HTML报告...`);
  const templatePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "report-template-reference.html");
  const template = await fs.readFile(templatePath, "utf8");
  const html = finalizeHtmlDocument(renderDynamicHtml(report, template));
  const safeBranch = profile.branch_name.replace(/[\\/:*?"<>|]/g, "_");
  const safePeriod = profile.period.replace(/[\\/:*?"<>|]/g, "_");
  const outputPath = path.join(outputDir, `${safeBranch}-${safePeriod}-经营体检报告.html`);
  await fs.writeFile(outputPath, html, "utf8");
  console.log(`RUN_SUMMARY=${JSON.stringify(buildRunSummary(report, subjectQuality, outputPath))}`);
  console.log(`OUTPUT=${outputPath}`);
}

main().catch((error) => {
  console.error(`ERROR=${error.message}`);
  process.exitCode = 1;
});

