import fs from "node:fs/promises";
import path from "node:path";
import { inflateRawSync } from "node:zlib";

const PROFILE_FIELDS = [
  ["branch_name", ["branch_name", "branchName", "营业部名称", "营业部"]],
  ["period", ["period", "统计期间", "统计期", "期间", "月份"]],
  ["branch_class", ["branch_class", "branchClass", "营业部类别"]],
  ["region_type", ["region_type", "regionType", "区域类型"]],
  ["development_stage", ["development_stage", "developmentStage", "发展阶段"]],
  ["operating_standard_id", ["operating_standard_id", "operatingStandardId", "经营标准ID"]],
  ["manager_name", ["manager_name", "managerName", "负责人", "负责人姓名"]],
  ["manager_tenure_start", ["manager_tenure_start", "managerTenureStart", "负责人任职时间"]],
  ["established_at", ["established_at", "成立时间", "成立日期"]],
  ["staff_count", ["staff_count", "员工人数", "人员数量"]],
  ["annual_revenue", ["annual_revenue", "本年营业收入"]],
  ["annual_profit", ["annual_profit", "本年考核利润"]],
  ["peer_rank", ["peer_rank", "考核同类排名"]],
  ["total_assets", ["total_assets", "总资产"]],
  ["asset_over_10k_count", ["asset_over_10k_count", "资产过万户数"]],
  ["channel_value_basis", ["channel_value_basis", "渠道数值口径"]],
];

const METRIC_FIELDS = [
  ["指标名称", ["指标名称", "name", "metric_name", "metricName"]],
  ["当前值", ["本期总值", "当前值", "总值", "total", "current", "value"]],
  ["线上值", ["本期线上值", "线上值", "online", "online_value", "onlineValue"]],
  ["线下值", ["本期线下值", "线下值", "offline", "offline_value", "offlineValue"]],
  ["指标ID", ["指标ID", "id", "metric_id", "metricId"]],
  ["上期值", ["上期总值", "上期值", "prior", "previous", "previousValue"]],
  ["上期线上值", ["上期线上值", "prior_online"]],
  ["上期线下值", ["上期线下值", "prior_offline"]],
  ["取数来源", ["取数来源", "source", "data_source", "dataSource"]],
];

const OPTIONAL_SHEETS = {
  causes: { name: "原因库", headers: ["维度ID", "状态", "原因"] },
  measures: { name: "措施库", headers: ["维度ID", "状态", "营业部类别", "经营标准ID", "建议措施", "责任部门", "资源支持", "优先级"] },
  history: { name: "历史趋势", headers: ["指标名称", "期间", "本营业部值", "同类均值"] },
};

function decodeXmlEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(raw) {
  const result = {};
  const pattern = /([:\w-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  for (const match of raw.matchAll(pattern)) {
    result[match[1]] = decodeXmlEntities(match[2].slice(1, -1));
  }
  return result;
}

function xmlText(raw) {
  return [...String(raw).matchAll(/<(?:[\w-]+:)?t\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?t>/g)]
    .map((match) => decodeXmlEntities(match[1]))
    .join("");
}

function columnIndex(cellRef) {
  const letters = String(cellRef).match(/^[A-Za-z]+/)?.[0] ?? "A";
  let index = 0;
  for (const letter of letters.toUpperCase()) index = index * 26 + letter.charCodeAt(0) - 64;
  return index - 1;
}

class ZipArchive {
  constructor(buffer) {
    this.buffer = buffer;
    this.entries = new Map();
    this.readCentralDirectory();
  }

  readCentralDirectory() {
    const signature = 0x06054b50;
    let eocd = -1;
    for (let offset = this.buffer.length - 22; offset >= Math.max(0, this.buffer.length - 65557); offset -= 1) {
      if (this.buffer.readUInt32LE(offset) === signature) {
        eocd = offset;
        break;
      }
    }
    if (eocd < 0) throw new Error("输入文件不是有效的 XLSX/ZIP 文件");
    const entryCount = this.buffer.readUInt16LE(eocd + 10);
    const centralSize = this.buffer.readUInt32LE(eocd + 12);
    const centralOffset = this.buffer.readUInt32LE(eocd + 16);
    let offset = centralOffset;
    const end = centralOffset + centralSize;
    for (let i = 0; i < entryCount && offset < end; i += 1) {
      if (this.buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("XLSX 压缩包目录损坏");
      const compression = this.buffer.readUInt16LE(offset + 10);
      const compressedSize = this.buffer.readUInt32LE(offset + 20);
      const nameLength = this.buffer.readUInt16LE(offset + 28);
      const extraLength = this.buffer.readUInt16LE(offset + 30);
      const commentLength = this.buffer.readUInt16LE(offset + 32);
      const localOffset = this.buffer.readUInt32LE(offset + 42);
      const name = this.buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
      this.entries.set(name, { compression, compressedSize, localOffset });
      offset += 46 + nameLength + extraLength + commentLength;
    }
  }

  read(name) {
    const entry = this.entries.get(name);
    if (!entry) return null;
    const local = entry.localOffset;
    if (this.buffer.readUInt32LE(local) !== 0x04034b50) throw new Error(`XLSX 文件条目损坏: ${name}`);
    const nameLength = this.buffer.readUInt16LE(local + 26);
    const extraLength = this.buffer.readUInt16LE(local + 28);
    const start = local + 30 + nameLength + extraLength;
    const compressed = this.buffer.subarray(start, start + entry.compressedSize);
    if (entry.compression === 0) return compressed;
    if (entry.compression === 8) return inflateRawSync(compressed);
    throw new Error(`暂不支持 XLSX 压缩方式: ${entry.compression}`);
  }
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  return [...xml.matchAll(/<(?:[\w-]+:)?si\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?si>/g)].map((match) => xmlText(match[1]));
}

function parseWorksheet(xml, sharedStrings) {
  const rows = [];
  for (const rowMatch of String(xml).matchAll(/<(?:[\w-]+:)?row\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<(?:[\w-]+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w-]+:)?c>)/g)) {
      const attrs = parseXmlAttributes(cellMatch[1]);
      const body = cellMatch[2] ?? "";
      const index = columnIndex(attrs.r ?? `A${cells.length + 1}`);
      let value = "";
      if (attrs.t === "inlineStr") value = xmlText(body);
      else {
        const raw = body.match(/<(?:[\w-]+:)?v\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?v>/)?.[1] ?? "";
        if (attrs.t === "s") value = sharedStrings[Number.parseInt(raw, 10)] ?? "";
        else if (attrs.t === "b") value = raw === "1";
        else if (attrs.t === "str") value = decodeXmlEntities(raw);
        else {
          const decoded = decodeXmlEntities(raw);
          const numeric = Number(decoded);
          value = decoded !== "" && Number.isFinite(numeric) ? numeric : decoded;
        }
      }
      cells[index] = value;
    }
    rows.push(cells.map((value) => value ?? ""));
  }
  return rows;
}

async function readXlsx(inputPath) {
  const archive = new ZipArchive(await fs.readFile(inputPath));
  const workbookXml = archive.read("xl/workbook.xml")?.toString("utf8");
  if (!workbookXml) throw new Error("XLSX 缺少 xl/workbook.xml");
  const relsXml = archive.read("xl/_rels/workbook.xml.rels")?.toString("utf8") ?? "";
  const relationships = new Map();
  for (const match of relsXml.matchAll(/<Relationship\b([^>]*)\/?>(?:<\/Relationship>)?/g)) {
    const attrs = parseXmlAttributes(match[1]);
    if (attrs.Id && attrs.Target) relationships.set(attrs.Id, attrs.Target);
  }
  const sharedStrings = parseSharedStrings(archive.read("xl/sharedStrings.xml")?.toString("utf8"));
  const sheets = new Map();
  let sheetIndex = 0;
  for (const match of workbookXml.matchAll(/<(?:[\w-]+:)?sheet\b([^>]*)\/?>(?:<\/(?:[\w-]+:)?sheet>)?/g)) {
    const attrs = parseXmlAttributes(match[1]);
    const relationId = attrs["r:id"] ?? attrs.id;
    const target = relationships.get(relationId) ?? `worksheets/sheet${attrs.sheetId ?? sheetIndex + 1}.xml`;
    const normalizedTarget = target.replace(/^\//, "").replace(/^xl\//, "");
    const sheetPath = normalizedTarget.startsWith("worksheets/") ? `xl/${normalizedTarget}` : `xl/worksheets/${path.basename(normalizedTarget)}`;
    const xml = archive.read(sheetPath)?.toString("utf8");
    if (!xml) throw new Error(`XLSX 缺少工作表数据: ${attrs.name ?? sheetPath}`);
    sheets.set(attrs.name, parseWorksheet(xml, sharedStrings));
    sheetIndex += 1;
  }
  return { format: "xlsx", sheets };
}

function parseCsv(text) {
  const source = String(text).replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiters = [",", "\t", ";"];
  const delimiter = delimiters.sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"' && value === "") quoted = true;
    else if (char === delimiter) { row.push(value); value = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(value); value = "";
      if (row.some((cell) => String(cell).trim() !== "")) rows.push(row);
      row = [];
    } else value += char;
  }
  if (value !== "" || row.length) { row.push(value); if (row.some((cell) => String(cell).trim() !== "")) rows.push(row); }
  return rows;
}

function findHeader(headers, aliases) {
  const normalized = headers.map((header) => String(header ?? "").trim().toLowerCase());
  return aliases.map((alias) => normalized.indexOf(String(alias).toLowerCase())).find((index) => index >= 0);
}

function rowsToMetricSheet(headers, rows) {
  const indexes = new Map();
  for (const [target, aliases] of METRIC_FIELDS) {
    const index = findHeader(headers, aliases);
    if (index !== undefined) indexes.set(target, index);
  }
  if (!indexes.has("指标名称") || !indexes.has("当前值")) throw new Error("CSV 必须包含 指标名称 和 当前值 列");
  const outputHeaders = [...indexes.keys()];
  return [outputHeaders, ...rows.map((row) => outputHeaders.map((header) => row[indexes.get(header)] ?? ""))];
}

function profileFromTabular(headers, rows, options = {}) {
  const first = rows.find((row) => row.some((value) => String(value ?? "").trim() !== "")) ?? [];
  const profile = {};
  for (const [field, aliases] of PROFILE_FIELDS) {
    const index = findHeader(headers, aliases);
    profile[field] = index === undefined ? "" : String(first[index] ?? "").trim();
  }
  if (!profile.branch_name) profile.branch_name = options.branchName ?? "";
  if (!profile.period) profile.period = options.period ?? "";
  return profile;
}

function profileSheet(profile) {
  return [["字段", "值"], ...Object.entries(profile).filter(([, value]) => value !== "").map(([key, value]) => [key, value])];
}

function buildJsonSheetRows(rows, fields) {
  if (!Array.isArray(rows)) return null;
  const headers = fields.filter(([, aliases]) => rows.some((row) => row && typeof row === "object" && aliases.some((alias) => Object.prototype.hasOwnProperty.call(row, alias)))).map(([target]) => target);
  const effectiveHeaders = headers.length ? headers : fields.map(([target]) => target);
  return [effectiveHeaders, ...rows.map((row) => effectiveHeaders.map((header) => {
    const aliases = fields.find(([target]) => target === header)?.[1] ?? [header];
    const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(row ?? {}, alias));
    return key ? row[key] : "";
  }))];
}

async function readCsv(inputPath, options) {
  const rows = parseCsv(await fs.readFile(inputPath, "utf8"));
  if (rows.length < 2) throw new Error("CSV 至少需要表头和一行数据");
  const [headers, ...data] = rows;
  const profile = profileFromTabular(headers, data, options);
  return { format: "csv", sheets: new Map([["营业部信息", profileSheet(profile)], ["指标数据", rowsToMetricSheet(headers, data)]]) };
}

async function readJson(inputPath, options) {
  let data;
  try { data = JSON.parse(await fs.readFile(inputPath, "utf8")); }
  catch (error) { throw new Error(`JSON 解析失败: ${error.message}`); }
  if (Array.isArray(data)) data = { metrics: data };
  if (!data || typeof data !== "object" || !Array.isArray(data.metrics)) throw new Error("JSON 必须包含 metrics 数组");
  const profileInput = data.profile && typeof data.profile === "object" ? { ...data, ...data.profile } : data;
  const profile = {};
  for (const [field, aliases] of PROFILE_FIELDS) {
    const key = aliases.find((alias) => Object.prototype.hasOwnProperty.call(profileInput, alias));
    profile[field] = key ? String(profileInput[key] ?? "").trim() : "";
  }
  if (!profile.branch_name) profile.branch_name = options.branchName ?? "";
  if (!profile.period) profile.period = options.period ?? "";
  const sheets = new Map([["营业部信息", profileSheet(profile)], ["指标数据", buildJsonSheetRows(data.metrics, METRIC_FIELDS)]]);
  for (const [key, descriptor] of Object.entries(OPTIONAL_SHEETS)) {
    if (Array.isArray(data[key])) {
      const aliases = key === "history" ? [["指标名称", ["指标名称", "name", "metric_name"]], ["期间", ["期间", "period"]], ["本营业部值", ["本营业部值", "value", "current"]], ["同类均值", ["同类均值", "peer", "peer_mean"]]] : descriptor.headers.map(header => [header, [header]]);
      sheets.set(descriptor.name, buildJsonSheetRows(data[key], aliases));
    }
  }
  return { format: "json", sheets };
}

export async function loadInput(inputPath, options = {}) {
  const extension = path.extname(inputPath).toLowerCase();
  if (extension === ".xlsx") return readXlsx(inputPath);
  if (extension === ".csv") return readCsv(inputPath, options);
  if (extension === ".json") return readJson(inputPath, options);
  throw new Error("输入文件必须是 .xlsx、.csv 或 .json");
}
