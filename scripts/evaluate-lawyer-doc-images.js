import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeLead, createLead, getLead } from "../server.js";

const args = process.argv.slice(2);
const shouldAnalyze = !args.includes("--no-analyze");
const maxArg = args.find((arg) => arg.startsWith("--max="));
const onlyArg = args.find((arg) => arg.startsWith("--only="));
const maxSamples = maxArg ? Number(maxArg.replace("--max=", "")) : null;
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

function plainOcrText(raw) {
  const text = String(raw || "");
  const matches = [...text.matchAll(/"text"\s*:\s*"([^"]+)"/g)].map((item) => item[1]);
  if (matches.length) return matches.join(" ");
  return text
    .replace(/```(?:json|html)?/g, "")
    .replace(/```/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/[{}\[\]",:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function cachedOcrText(filePath) {
  const knowledge = JSON.parse(await readFile("data/extracted/ocr/xijiu-doc-knowledge.json", "utf8"));
  const fileName = path.basename(filePath);
  const row = (knowledge.ocrResults || []).find((item) => item.image === fileName);
  return plainOcrText(row?.text || "");
}

async function imageDataUrl(filePath) {
  const buffer = await readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

async function ensureLead(sample) {
  const existing = await getLead(sample.id);
  if (existing) return existing;
  const ocrText = await cachedOcrText(sample.filePath);
  return createLead({
    id: sample.id,
    title: sample.title,
    sourceType: "律师Word图片评测",
    sourceUrl: "",
    brandHint: "",
    description: `Word 文档内嵌图片评测样本。该描述不包含期望标签。${ocrText ? `\n已缓存OCR识别：${ocrText}` : ""}`,
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
    filePath: sample.filePath,
    labelSource: sample.labelSource,
    expectedRiskLevel: sample.expectedRiskLevel,
    predictedRiskLevel,
    expectedIdentity: sample.expectedIdentity,
    predictedIdentity,
    infringementProbability: sections.infringementProbability ?? null,
    modelUsed: sections.modelUsed || "",
    modelError: sections.modelError || "",
    riskScoring: sections.riskScoring || null,
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
    modelErrorRate: total ? modelErrorCount / total : 0,
    counts: { tp, fp, tn, fn }
  };
}

function printReport(summary, results) {
  console.log("律师 Word 图片评测报告");
  console.log("======================");
  console.log(`样本数: ${summary.total}`);
  console.log(`风险等级准确率: ${percent(summary.exactRiskAccuracy)}`);
  console.log(`高/非高风险准确率: ${percent(summary.binaryRiskAccuracy)}`);
  console.log(`身份识别准确率: ${percent(summary.identityAccuracy)}`);
  console.log(`高风险精确率: ${percent(summary.highRiskPrecision)}`);
  console.log(`高风险召回率: ${percent(summary.highRiskRecall)}`);
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

const manifest = JSON.parse(await readFile("data/evaluation/lawyer-doc-samples.json", "utf8"));
let samples = manifest.samples.filter((sample) => sample.labelStatus !== "disabled");
if (onlyPattern) samples = samples.filter((sample) => sample.title.includes(onlyPattern) || sample.id === onlyPattern);
if (Number.isFinite(maxSamples) && maxSamples > 0) samples = samples.slice(0, maxSamples);

const results = [];
for (const sample of samples) {
  console.log(`${shouldAnalyze ? "分析" : "汇总"}: ${sample.title}`);
  await ensureLead(sample);
  if (shouldAnalyze) {
    const startedAt = Date.now();
    await analyzeLead(sample.id);
    console.log(`完成: ${sample.title} (${Date.now() - startedAt}ms)`);
  }
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
await writeFile("data/evaluation/lawyer-doc-latest-report.json", JSON.stringify(report, null, 2));
console.log("");
console.log("已写入 data/evaluation/lawyer-doc-latest-report.json");
