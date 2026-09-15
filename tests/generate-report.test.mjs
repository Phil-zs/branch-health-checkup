import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import METRIC_CATALOG from "../references/metric-catalog.json" with { type: "json" };

const execFile = promisify(execFileCallback);
const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generator = path.join(skillDir, "scripts", "generate_report.mjs");

function testValue(rule, status = "green") {
  if (status === "green") return rule.greenThreshold;
  const step = /率|占比|比例|%/.test(rule.unit) ? 0.01 : 1;
  return rule.direction === "higher" ? rule.redThreshold - step : rule.redThreshold + step;
}

function buildInput(branchName, status = "green") {
  const metrics = METRIC_CATALOG.map((rule) => {
    const current = testValue(rule, status);
    const online = current * 0.6;
    const offline = current - online;
    return {
      "指标名称": rule.name,
      "本期总值": current,
      "本期线上值": online,
      "本期线下值": offline,
      "上期总值": current,
      "上期线上值": online,
      "上期线下值": offline,
    };
  });
  return {
    profile: {
      branch_name: branchName,
      period: "2026年7月",
      branch_class: "D",
      region_type: "城区",
      development_stage: "成熟期",
      operating_standard_id: "D-01",
      manager_name: "测试负责人",
      manager_tenure_start: "2023-01",
      channel_value_basis: "sum",
    },
    metrics,
    history: metrics.flatMap((metric) => ["2022年", "2023年", "2024年", "2025年", "2026年（截至7月）"].map((period) => ({
      "指标名称": metric["指标名称"],
      "期间": period,
      "本营业部值": metric["本期总值"],
    }))),
  };
}

async function writeInput(directory, filename, data) {
  const filePath = path.join(directory, filename);
  await writeFile(filePath, JSON.stringify(data), "utf8");
  return filePath;
}

async function runGenerator(args) {
  try {
    const result = await execFile(process.execPath, [generator, ...args], { cwd: skillDir, encoding: "utf8" });
    return { code: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { code: Number(error.code ?? 1), stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function jsonLine(output, prefix) {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  assert.ok(line, `Expected ${prefix} in command output.`);
  return JSON.parse(line.slice(prefix.length));
}

async function withTempDirectory(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), "branch-health-checkup-"));
  try {
    await callback(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("generates a self-contained report and run summary with eligible peers", async () => {
  await withTempDirectory(async (directory) => {
    const subject = await writeInput(directory, "主体.json", buildInput("测试营业部"));
    const peer = await writeInput(directory, "同类.json", buildInput("同类营业部"));
    const outputDir = path.join(directory, "output");
    const result = await runGenerator(["--input", subject, "--peer-inputs", peer, "--output-dir", outputDir]);
    assert.equal(result.code, 0, result.stderr);
    const quality = jsonLine(result.stderr, "INPUT_QUALITY=");
    const summary = jsonLine(result.stdout, "RUN_SUMMARY=");
    assert.equal(quality.subject.status, "passed");
    assert.equal(summary.comparison.branchCount, 1);
    assert.equal(summary.branch.dimensions.length, 5);
    const outputPath = path.join(outputDir, summary.report.outputFile);
    const html = await readFile(outputPath, "utf8");
    assert.ok(html.startsWith("<!DOCTYPE html>"));
    assert.ok(html.trimEnd().endsWith("</html>"));
    assert.equal((html.match(/<div\b/gi) ?? []).length, (html.match(/<\/div>/gi) ?? []).length);
    assert.equal((html.match(/class="appendix-block"/g) ?? []).length, 5);
    assert.equal(/<script\b/i.test(html), false);
    assert.equal(/https?:\/\//i.test(html), false);
  });
});

test("stops before report output when one required branch metric is absent", async () => {
  await withTempDirectory(async (directory) => {
    const input = buildInput("缺项测试营业部");
    input.metrics.pop();
    const subject = await writeInput(directory, "缺项.json", input);
    const outputDir = path.join(directory, "output");
    const result = await runGenerator(["--input", subject, "--output-dir", outputDir]);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /MISSING_METRICS=/);
    const contents = await readdir(outputDir);
    assert.equal(contents.some((name) => name.endsWith(".html")), false);
  });
});

test("continues with a reviewable quality warning and keeps abnormal cards free of calculation details", async () => {
  await withTempDirectory(async (directory) => {
    const input = buildInput("质量提示营业部", "red");
    input.metrics[0]["本期线上值"] = 0;
    input.metrics[0]["本期线下值"] = 0;
    const subject = await writeInput(directory, "质量提示.json", input);
    const outputDir = path.join(directory, "output");
    const result = await runGenerator(["--input", subject, "--output-dir", outputDir]);
    assert.equal(result.code, 0, result.stderr);
    const quality = jsonLine(result.stderr, "INPUT_QUALITY=");
    assert.ok(quality.subject.issues.some((issue) => issue.code === "channel_total_mismatch"));
    const summary = jsonLine(result.stdout, "RUN_SUMMARY=");
    const html = await readFile(path.join(outputDir, summary.report.outputFile), "utf8");
    assert.match(html, /可能原因：/);
    assert.match(html, /综合状态为/);
    assert.match(html, /当前需优先关注/);
    assert.match(html, /建议/);
    const conclusion = html.match(/<section><h2>诊断结论<\/h2><div class="conclusion">([\s\S]*?)<\/div><\/section>/)?.[1] ?? "";
    assert.equal((conclusion.match(/<p>/g) ?? []).length, 1);
    assert.equal(conclusion.includes("综合情况："), false);
    assert.equal(conclusion.includes("经营异常："), false);
    assert.equal(conclusion.includes("可取之处："), false);
    assert.equal(conclusion.includes("解决方案："), false);
    assert.equal(html.includes("趋势解读："), false);
    assert.equal(html.includes("加权拖累"), false);
    assert.equal(html.includes("本项得分"), false);
    assert.equal(html.includes("评分规则"), false);
  });
});
