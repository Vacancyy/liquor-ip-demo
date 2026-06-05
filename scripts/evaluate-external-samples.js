import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeLead, createLead, getLead } from "../server.js";

const args = process.argv.slice(2);
const shouldAnalyze = !args.includes("--no-analyze");
const maxArg = args.find((arg) => arg.startsWith("--max="));
const maxSamples = maxArg ? Number(maxArg.replace("--max=", "")) : null;
const onlyArg = args.find((arg) => arg.startsWith("--only="));
const onlyPattern = onlyArg ? onlyArg.replace("--only=", "") : "";

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

function isHighRisk(level) {
  return level === "高风险";
}

function percent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

async function imageDataUrl(filePath) {
  const buffer = await readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

async function ensureLead(sample) {
  const existing = await getLead(sample.id);
  if (existing) return existing;
  return createLead({
    id: sample.id,
    title: sample.title,
    sourceType: "外部检索样本",
    sourceUrl: sample.sourceUrl,
    brandHint: "习酒",
    description: `评测样本来源：${sample.sourceName}；期望风险：${sample.expectedRiskLevel}`,
    imageName: path.basename(sample.filePath),
    imageData: await imageDataUrl(sample.filePath)
  });
}

function evaluate(sample, lead) {
  const sections = lead?.report?.sections || {};
  const predictedRiskLevel = sections.riskLevel || "待确认";
  const predictedIdentity = sections.productIdentity?.type || "unknown";
  return {
    id: sample.id,
    title: sample.title,
    sourceName: sample.sourceName,
    sourceUrl: sample.sourceUrl,
    labelSource: sample.labelSource,
    expectedRiskLevel: sample.expectedRiskLevel,
    predictedRiskLevel,
    expectedIdentity: sample.expectedIdentity,
    predictedIdentity,
    infringementProbability: sections.infringementProbability ?? null,
    modelUsed: sections.modelUsed || "",
    modelError: sections.modelError || "",
    riskExactMatch: predictedRiskLevel === sample.expectedRiskLevel,
    binaryRiskMatch: isHighRisk(predictedRiskLevel) === isHighRisk(sample.expectedRiskLevel),
    identityMatch: predictedIdentity === sample.expectedIdentity
  };
}

function summarize(results) {
  const total = results.length;
  const exactRiskCorrect = results.filter((item) => item.riskExactMatch).length;
  const binaryRiskCorrect = results.filter((item) => item.binaryRiskMatch).length;
  const identityCorrect = results.filter((item) => item.identityMatch).length;
  const tp = results.filter((item) => isHighRisk(item.expectedRiskLevel) && isHighRisk(item.predictedRiskLevel)).length;
  const fp = results.filter((item) => !isHighRisk(item.expectedRiskLevel) && isHighRisk(item.predictedRiskLevel)).length;
  const tn = results.filter((item) => !isHighRisk(item.expectedRiskLevel) && !isHighRisk(item.predictedRiskLevel)).length;
  const fn = results.filter((item) => isHighRisk(item.expectedRiskLevel) && !isHighRisk(item.predictedRiskLevel)).length;
  const modelErrorCount = results.filter((item) => item.modelError).length;
  return {
    total,
    exactRiskAccuracy: total ? exactRiskCorrect / total : 0,
    binaryRiskAccuracy: total ? binaryRiskCorrect / total : 0,
    identityAccuracy: total ? identityCorrect / total : 0,
    highRiskPrecision: tp + fp ? tp / (tp + fp) : 0,
    highRiskRecall: tp + fn ? tp / (tp + fn) : 0,
    authenticFalsePositiveRate: fp + tn ? fp / (fp + tn) : 0,
    modelErrorRate: total ? modelErrorCount / total : 0,
    counts: { tp, fp, tn, fn }
  };
}

function printReport(summary, results) {
  console.log("外部检索样本评测报告");
  console.log("====================");
  console.log(`样本数: ${summary.total}`);
  console.log(`风险等级准确率: ${percent(summary.exactRiskAccuracy)}`);
  console.log(`高/非高风险准确率: ${percent(summary.binaryRiskAccuracy)}`);
  console.log(`身份识别准确率: ${percent(summary.identityAccuracy)}`);
  console.log(`高风险精确率: ${percent(summary.highRiskPrecision)}`);
  console.log(`高风险召回率: ${percent(summary.highRiskRecall)}`);
  console.log(`真品误判为高风险比例: ${percent(summary.authenticFalsePositiveRate)}`);
  console.log(`模型错误/超时比例: ${percent(summary.modelErrorRate)}`);
  console.log("");
  for (const item of results) {
    const status = item.riskExactMatch && item.identityMatch && !item.modelError ? "PASS" : "CHECK";
    console.log(
      `${status} ${item.title}: 期望 ${item.expectedRiskLevel}/${item.expectedIdentity}, ` +
        `实际 ${item.predictedRiskLevel}/${item.predictedIdentity}, 分数 ${item.infringementProbability ?? "无"}%`
    );
    if (item.modelError) console.log(`  模型错误: ${item.modelError}`);
  }
}

const manifest = JSON.parse(await readFile("data/evaluation/external-samples.json", "utf8"));
let samples = manifest.samples.filter((sample) => sample.labelStatus !== "disabled");
if (onlyPattern) {
  samples = samples.filter((sample) => sample.title.includes(onlyPattern) || sample.id === onlyPattern);
}
if (Number.isFinite(maxSamples) && maxSamples > 0) samples = samples.slice(0, maxSamples);
const results = [];

for (const sample of samples) {
  console.log(`${shouldAnalyze ? "分析" : "汇总"}: ${sample.title}`);
  await ensureLead(sample);
  if (shouldAnalyze) await analyzeLead(sample.id);
  const analyzed = await getLead(sample.id);
  results.push(evaluate(sample, analyzed));
}

const summary = summarize(results);
const report = {
  generatedAt: new Date().toISOString(),
  mode: shouldAnalyze ? "reanalyze" : "current_reports",
  summary,
  results
};

printReport(summary, results);
await writeFile("data/evaluation/external-latest-report.json", JSON.stringify(report, null, 2));
console.log("");
console.log("已写入 data/evaluation/external-latest-report.json");
