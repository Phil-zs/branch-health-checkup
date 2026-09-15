import RULES from '../references/leader-rules.json' with { type: 'json' };

export const leaderLevel = score => score >= 90 ? '优秀' : score >= 80 ? '良好' : score >= 70 ? '达标' : score >= 60 ? '待提升' : '预警';

export function formatLeaderValue(value, unit = '') {
  if (value === null || value === undefined || value === '') return '-';
  if (unit === '等级') return String(value);
  if (unit === '率') return `${(Number(value) * 100).toFixed(2)}%`;
  return `${value}${unit ? ` ${unit}` : ''}`;
}

export function scoreLeaderMetric(rule, value) {
  if (rule.direction === 'rating') {
    if (!(value in rule.bands)) throw new Error(`${rule.name}必须是A/B/C/D等级`);
    return rule.bands[value];
  }
  if (value === '' || value == null || !Number.isFinite(Number(value))) throw new Error(`${rule.name}缺少有效数值`);
  const n = Number(value);
  if (rule.direction === 'special') {
    if (n < 0 || !Number.isInteger(n)) throw new Error(`${rule.name}必须是非负整数`);
    return n === 0 ? 100 : n === 1 ? 60 : 0;
  }
  return rule.bands.find(([threshold]) => rule.direction === 'lower' ? n <= threshold : n >= threshold)?.[1] ?? 0;
}

export function calculateLeader(observations) {
  const dimensions = RULES.dimensions.map(d => {
    const metrics = d.metrics.map(rule => {
      const observation = observations.get(rule.name);
      if (!observation) throw new Error(`负责人指标无数据：${rule.name}，请补充后再继续分析`);
      return { ...rule, ...observation, name: rule.name, score: scoreLeaderMetric(rule, observation.current) };
    });
    const weight = metrics.reduce((s, m) => s + m.weight, 0);
    const score = metrics.reduce((s, m) => s + m.score * m.weight, 0) / weight;
    return { ...d, metrics, score, status: leaderLevel(score) };
  });
  return { dimensions, overall: dimensions.reduce((s,d) => s + d.score * d.weight, 0) };
}

export function readLeaderWorkbook(workbook) {
  const data = workbook.sheets.get('负责人数据');
  if (!data?.length) return null;
  const headers = data[0];
  const ni = headers.indexOf('指标名称');
  const vi = headers.findIndex(h => ['当前值','本期值'].includes(h));
  const pi = headers.findIndex(h => ['上期值'].includes(h));
  const ui = headers.indexOf('单位');
  if (ni < 0 || vi < 0) throw new Error('负责人数据需要指标名称、本期值列');
  const observations = new Map();
  for (const row of data.slice(1)) {
    const name = String(row[ni] ?? '').trim();
    if (!name) continue;
    if (observations.has(name)) throw new Error(`负责人指标重复：${name}`);
    const unit = ui < 0 ? '' : String(row[ui]);
    const current = row[vi];
    const prior = pi < 0 ? null : row[pi];
    observations.set(name, {
      current,
      value: current,
      valueDisplay: formatLeaderValue(current, unit),
      unit,
      prior,
      priorDisplay: formatLeaderValue(prior, unit),
    });
  }
  const result = calculateLeader(observations);
  const history = workbook.sheets.get('负责人历史趋势');
  if (history?.length) {
    const [h, ...rows] = history;
    const n = h.indexOf('指标名称'), p = h.indexOf('期间'), v = h.findIndex(x => ['本期值','本年度值','值'].includes(x));
    if (n < 0 || p < 0 || v < 0) throw new Error('负责人历史趋势需要指标名称、期间、本年度值列');
    for (const d of result.dimensions) for (const m of d.metrics) {
      m.history = rows.filter(r => r[n] === m.name).map(r => {
        const rawValue = r[v];
        return {
          period: String(r[p]),
          value: m.direction === 'rating' ? scoreLeaderMetric(m, rawValue) : Number(rawValue),
          displayValue: formatLeaderValue(rawValue, m.unit),
        };
      });
    }
  }
  return result;
}
