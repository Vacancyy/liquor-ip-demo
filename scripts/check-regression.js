import { readFile } from "node:fs/promises";

const checks = [
  { id: "confirmed-picture1", title: "Picture1.png", riskLevel: "高风险", identity: "suspected_accused" },
  { id: "confirmed-picture3", title: "Picture3.png", riskLevel: "高风险", identity: "suspected_accused" },
  { id: "lawyer-doc-ocr-image-1", title: "律师Word图片样本-1", riskLevel: "高风险", identity: "suspected_accused" },
  { id: "lawyer-doc-ocr-image-8", title: "律师Word图片样本-8", riskLevel: "高风险", identity: "suspected_accused" }
];

let failed = false;
const confirmed = JSON.parse(await readFile("data/knowledge/confirmed-samples.json", "utf8"));
const confirmedSamples = confirmed.samples || [];
const db = JSON.parse(await readFile("data/db.json", "utf8"));
const leads = db.leads || [];

for (const check of checks) {
  const sample = confirmedSamples.find((item) => item.id === check.id);
  if (!sample) {
    console.error(`FAIL ${check.title}: confirmed sample missing`);
    failed = true;
    continue;
  }
  const ok = sample.expectedRiskLevel === check.riskLevel && sample.expectedIdentity === check.identity;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${check.title}: ${sample.expectedRiskLevel} ${sample.expectedIdentity}`);
  if (!ok) failed = true;
}

const authenticLeadChecks = [
  { id: "lead-1781089587912", title: "真品5.jpeg" },
  { id: "lead-1781089453757", title: "真品8.jpeg" }
];

for (const check of authenticLeadChecks) {
  const lead = leads.find((item) => item.id === check.id);
  const sections = lead?.report?.sections || {};
  const riskLevel = sections.riskLevel || "无报告";
  const probability = sections.infringementProbability ?? "无";
  const thirdPartySignals = sections.structuredEvidence?.thirdPartySignals || [];
  const ok = riskLevel !== "高风险" && !thirdPartySignals.length;
  const status = ok ? "PASS" : "FAIL";
  console.log(`${status} ${check.title}: ${riskLevel} ${probability}% thirdParty=${thirdPartySignals.length}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
