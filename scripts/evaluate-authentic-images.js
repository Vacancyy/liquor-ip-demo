import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeLead, createLead, getLead } from "../server.js";

const args = process.argv.slice(2);
const shouldAnalyze = !args.includes("--no-analyze");

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function imageDataUrl(filePath) {
  const buffer = await readFile(filePath);
  return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
}

function isHighRisk(level) {
  return level === "高风险";
}

function percent(value) {
  if (!Number.isFinite(value)) return "0.0%";
  return `${(value * 100).toFixed(1)}%`;
}

async function ensureLead(sample) {
  const existing = await getLead(sample.id);
  if (existing) return existing;
  return createLead({
    id: sample.id,
    title: sample.title,
    sourceType: "正品图片评测",
    sourceUrl: sample.sourceUrl || "",
    brandHint: "习酒",
    description: "正品图片评测样本。该描述不包含期望标签。",
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
    expectedRiskLevel: sample.expectedRiskLevel,
    predictedRiskLevel,
    expectedIdentity: sample.expectedIdentity,
    predictedIdentity,
    infringementProbability: sections.infringementProbability ?? null,
    imageSampleMatch: sections.imageSampleMatch || null,
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
  const falseHighRisk = results.filter((item) => !isHighRisk(item.expectedRiskLevel) && isHighRisk(item.predictedRiskLevel)).length;
  return {
    total,
    exactRiskAccuracy: total ? exactRiskCorrect / total : 0,
    binaryRiskAccuracy: total ? binaryRiskCorrect / total : 0,
    identityAccuracy: total ? identityCorrect / total : 0,
    authenticFalseHighRiskRate: total ? falseHighRisk / total : 0
  };
}

function printReport(summary, results) {
  console.log("正品图片评测报告");
  console.log("================");
  console.log(`样本数: ${summary.total}`);
  console.log(`风险等级准确率: ${percent(summary.exactRiskAccuracy)}`);
  console.log(`高/非高风险准确率: ${percent(summary.binaryRiskAccuracy)}`);
  console.log(`身份识别准确率: ${percent(summary.identityAccuracy)}`);
  console.log(`正品误判高风险比例: ${percent(summary.authenticFalseHighRiskRate)}`);
  console.log("");
  for (const item of results) {
    const status = item.riskExactMatch && item.identityMatch ? "PASS" : "CHECK";
    console.log(
      `${status} ${item.title}: 期望 ${item.expectedRiskLevel}/${item.expectedIdentity}, ` +
        `实际 ${item.predictedRiskLevel}/${item.predictedIdentity}, 分数 ${item.infringementProbability ?? "无"}%`
    );
  }
}

const manifest = JSON.parse(await readFile("data/evaluation/authentic-image-samples.json", "utf8"));
const samples = manifest.samples.filter((sample) => sample.labelStatus !== "disabled");
const results = [];

for (const sample of samples) {
  console.log(`${shouldAnalyze ? "分析" : "汇总"}: ${sample.title}`);
  await ensureLead(sample);
  if (shouldAnalyze) await analyzeLead(sample.id);
  const lead = await getLead(sample.id);
  results.push(evaluate(sample, lead));
}

const summary = summarize(results);
const report = {
  generatedAt: new Date().toISOString(),
  mode: shouldAnalyze ? "reanalyze" : "current_reports",
  summary,
  results
};

printReport(summary, results);
await writeFile("data/evaluation/authentic-latest-report.json", JSON.stringify(report, null, 2));
console.log("");
console.log("已写入 data/evaluation/authentic-latest-report.json");
