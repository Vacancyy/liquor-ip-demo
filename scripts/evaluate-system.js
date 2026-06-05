import { readFile, writeFile } from "node:fs/promises";

const args = new Set(process.argv.slice(2));
const shouldReanalyze = args.has("--reanalyze");
const shouldWriteJson = args.has("--write-json");
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const maxArg = process.argv.find((arg) => arg.startsWith("--max="));
const onlyPattern = onlyArg ? onlyArg.replace("--only=", "") : "";
const maxSamples = maxArg ? Number(maxArg.replace("--max=", "")) : null;

function percent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

function isHighRisk(level) {
  return level === "高风险";
}

function normalizeIdentity(value) {
  return value || "unknown";
}

function latestByTitle(leads, title) {
  return leads.find((lead) => lead.title === title);
}

function getSections(lead) {
  return lead?.report?.sections || {};
}

function evaluateSample(sample, lead) {
  const sections = getSections(lead);
  const predictedRiskLevel = sections.riskLevel || "待确认";
  const predictedIdentity = normalizeIdentity(sections.productIdentity?.type);
  const expectedHigh = isHighRisk(sample.expectedRiskLevel);
  const predictedHigh = isHighRisk(predictedRiskLevel);
  const riskExactMatch = predictedRiskLevel === sample.expectedRiskLevel;
  const binaryRiskMatch = expectedHigh === predictedHigh;
  const identityMatch = sample.expectedIdentity ? predictedIdentity === sample.expectedIdentity : true;
  const modelError = sections.modelError || "";

  return {
    id: lead?.id || sample.id || "",
    title: sample.title,
    labelSource: sample.labelSource,
    expectedRiskLevel: sample.expectedRiskLevel,
    predictedRiskLevel,
    expectedIdentity: sample.expectedIdentity || "",
    predictedIdentity,
    infringementProbability: sections.infringementProbability ?? null,
    confidence: sections.confidence ?? null,
    modelError,
    riskExactMatch,
    binaryRiskMatch,
    identityMatch,
    missingReport: !lead?.report?.sections,
    missingLead: !lead,
    expectedHigh,
    predictedHigh
  };
}

function summarize(results) {
  const total = results.length;
  const exactRiskCorrect = results.filter((item) => item.riskExactMatch).length;
  const binaryRiskCorrect = results.filter((item) => item.binaryRiskMatch).length;
  const identityCorrect = results.filter((item) => item.identityMatch).length;
  const tp = results.filter((item) => item.expectedHigh && item.predictedHigh).length;
  const fp = results.filter((item) => !item.expectedHigh && item.predictedHigh).length;
  const tn = results.filter((item) => !item.expectedHigh && !item.predictedHigh).length;
  const fn = results.filter((item) => item.expectedHigh && !item.predictedHigh).length;
  const modelErrorCount = results.filter((item) => item.modelError).length;
  const missingReportCount = results.filter((item) => item.missingReport || item.missingLead).length;

  const confusion = {};
  for (const item of results) {
    const expected = item.expectedRiskLevel;
    const predicted = item.predictedRiskLevel;
    confusion[expected] ||= {};
    confusion[expected][predicted] = (confusion[expected][predicted] || 0) + 1;
  }

  return {
    total,
    exactRiskAccuracy: total ? exactRiskCorrect / total : 0,
    binaryRiskAccuracy: total ? binaryRiskCorrect / total : 0,
    identityAccuracy: total ? identityCorrect / total : 0,
    highRiskPrecision: tp + fp ? tp / (tp + fp) : 0,
    highRiskRecall: tp + fn ? tp / (tp + fn) : 0,
    authenticFalsePositiveRate: fp + tn ? fp / (fp + tn) : 0,
    modelErrorRate: total ? modelErrorCount / total : 0,
    missingReportCount,
    confusion,
    counts: { tp, fp, tn, fn }
  };
}

function printReport(results, summary) {
  console.log("系统评测报告");
  console.log("============");
  console.log(`样本数: ${summary.total}`);
  console.log(`风险等级准确率: ${percent(summary.exactRiskAccuracy)}`);
  console.log(`高/非高风险准确率: ${percent(summary.binaryRiskAccuracy)}`);
  console.log(`身份识别准确率: ${percent(summary.identityAccuracy)}`);
  console.log(`高风险精确率: ${percent(summary.highRiskPrecision)}`);
  console.log(`高风险召回率: ${percent(summary.highRiskRecall)}`);
  console.log(`真品误判为高风险比例: ${percent(summary.authenticFalsePositiveRate)}`);
  console.log(`模型错误/超时比例: ${percent(summary.modelErrorRate)}`);
  console.log(`缺失报告数: ${summary.missingReportCount}`);
  console.log(`混淆矩阵: ${JSON.stringify(summary.confusion)}`);
  console.log("");

  const failures = results.filter((item) => !item.riskExactMatch || !item.identityMatch || item.missingReport || item.modelError);
  if (!failures.length) {
    console.log("未发现失败样本。");
    return;
  }

  console.log("失败/需复核样本:");
  for (const item of failures) {
    const problems = [];
    if (!item.riskExactMatch) problems.push("风险等级不一致");
    if (!item.identityMatch) problems.push("身份识别不一致");
    if (item.modelError) problems.push("模型错误/超时");
    if (item.missingReport || item.missingLead) problems.push("报告缺失");
    console.log(
      `- ${item.title} (${item.labelSource}): 期望 ${item.expectedRiskLevel}/${item.expectedIdentity}, ` +
        `实际 ${item.predictedRiskLevel}/${item.predictedIdentity}, 分数 ${item.infringementProbability ?? "无"}%, ` +
        problems.join("、")
    );
  }
}

const db = JSON.parse(await readFile("data/db.json", "utf8"));
const evaluation = JSON.parse(await readFile("data/evaluation/samples.json", "utf8"));
let activeSamples = (evaluation.samples || []).filter((sample) => sample.labelStatus !== "disabled");
if (onlyPattern) {
  activeSamples = activeSamples.filter((sample) => sample.title.includes(onlyPattern) || sample.id === onlyPattern);
}
if (Number.isFinite(maxSamples) && maxSamples > 0) {
  activeSamples = activeSamples.slice(0, maxSamples);
}

if (shouldReanalyze) {
  const { analyzeLead } = await import("../server.js");
  for (const sample of activeSamples) {
    const lead = db.leads.find((item) => item.id === sample.id) || latestByTitle(db.leads, sample.title);
    if (lead) {
      const startedAt = Date.now();
      console.log(`分析: ${sample.title}`);
      await analyzeLead(lead.id);
      console.log(`完成: ${sample.title} (${Date.now() - startedAt}ms)`);
    }
  }
}

const freshDb = shouldReanalyze ? JSON.parse(await readFile("data/db.json", "utf8")) : db;
const results = activeSamples.map((sample) => {
  const lead = freshDb.leads.find((item) => item.id === sample.id) || latestByTitle(freshDb.leads, sample.title);
  return evaluateSample(sample, lead);
});
const summary = summarize(results);

printReport(results, summary);

if (shouldWriteJson) {
  const report = {
    generatedAt: new Date().toISOString(),
    mode: shouldReanalyze ? "reanalyze" : "existing_reports",
    summary,
    results
  };
  await writeFile("data/evaluation/latest-report.json", JSON.stringify(report, null, 2));
  console.log("");
  console.log("已写入 data/evaluation/latest-report.json");
}
