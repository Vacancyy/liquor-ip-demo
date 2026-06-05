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

if (failed) process.exit(1);
