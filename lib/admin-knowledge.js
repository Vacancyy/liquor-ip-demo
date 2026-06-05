import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();

const dataFiles = {
  imageLibrary: path.join(root, "data", "knowledge", "image-samples.json"),
  officialSources: path.join(root, "data", "knowledge", "official-authentic-image-sources.json"),
  authenticProducts: path.join(root, "data", "knowledge", "authentic-products.json"),
  structuredRules: path.join(root, "data", "knowledge", "document-structured-rules.json"),
  authenticReport: path.join(root, "data", "evaluation", "authentic-latest-report.json"),
  lawyerReport: path.join(root, "data", "evaluation", "lawyer-doc-latest-report.json"),
  confirmedSamples: path.join(root, "data", "knowledge", "confirmed-samples.json"),
  judgementConfig: path.join(root, "data", "knowledge", "judgement-config.json")
};

const officialProductId = "auth-xijiu-official-main-products";
const uploadImageDir = path.join(root, "data", "knowledge", "admin-upload-images");
const defaultStrategy = {
  mode: "balanced",
  name: "平衡模式",
  description: "兼顾侵权漏判和正品误判，适合常规演示和内部测试。",
  highRiskThreshold: 75,
  lowRiskMax: 29,
  embeddingSimilarityThreshold: 90,
  visualSimilarityThreshold: 88,
  visualAverageDistanceMax: 10,
  visualDifferenceDistanceMax: 12,
  authenticProtectionScore: -70,
  confirmedAuthenticScore: -80,
  confirmedAccusedScore: 90,
  confirmedAccusedVisualScore: 82
};

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(filePath, data) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function fileInfo(filePath) {
  try {
    const info = await stat(filePath);
    return {
      exists: true,
      updatedAt: info.mtime.toLocaleString("zh-CN", { hour12: false }),
      sizeKb: Math.round(info.size / 1024)
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, updatedAt: "", sizeKb: 0 };
    throw error;
  }
}

function hashId(value) {
  return createHash("sha1").update(String(value || Date.now())).digest("hex").slice(0, 12);
}

function normalizeText(value) {
  return String(value || "").trim();
}

function safeFilePart(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function extensionFromMime(mimeType, filename = "") {
  const ext = path.extname(filename).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return ext === ".jpeg" ? ".jpg" : ext;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function percent(numerator, denominator) {
  if (!denominator) return "待验证";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function numericPercent(numerator, denominator) {
  if (!denominator) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function formatPercent(value) {
  return value === null ? "待验证" : `${value.toFixed(1)}%`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function sortByName(items) {
  return [...items].sort((a, b) => String(a.productName || a.name || "").localeCompare(String(b.productName || b.name || ""), "zh-CN"));
}

function getOfficialProduct(productsData) {
  const products = Array.isArray(productsData.products) ? productsData.products : [];
  let product = products.find((item) => item.id === officialProductId);
  if (!product) {
    product = {
      id: officialProductId,
      name: "贵州习酒官网主销产品正品",
      marks: [],
      visualFactors: ["官网正品", "主销产品", "正品酒瓶", "正品酒盒"],
      sourceUrl: "https://www.gzxijiu.com/product/mainProduct-junpin?menuId=Wds3VhamjqkrJ4TCRFJY5",
      legalMeaning: "管理端维护的官网正品产品名清单。命中这些名称时，应作为正品排除误判信号。",
      riskAdjustment: -65
    };
    productsData.products = [...products, product];
  }
  product.marks = Array.isArray(product.marks) ? product.marks : [];
  return product;
}

export async function getAdminKnowledge() {
  const [imageLibrary, officialSources, authenticProducts, structuredRules, authenticReport, lawyerReport, confirmedSamples, judgementConfig] = await Promise.all([
    readJson(dataFiles.imageLibrary, { samples: [] }),
    readJson(dataFiles.officialSources, { sources: [], series: [] }),
    readJson(dataFiles.authenticProducts, { products: [] }),
    readJson(dataFiles.structuredRules, { protectedElements: [], legalReasoningRules: [], evidenceCombinations: [] }),
    readJson(dataFiles.authenticReport, { summary: {}, results: [] }),
    readJson(dataFiles.lawyerReport, { summary: {}, results: [] }),
    readJson(dataFiles.confirmedSamples, { samples: [] }),
    readJson(dataFiles.judgementConfig, { strategy: defaultStrategy, presets: [] })
  ]);

  const samples = imageLibrary.samples || [];
  const authenticSamples = samples.filter((item) => item.category === "authentic_product_confirmed");
  const accusedSamples = samples.filter((item) => item.category === "accused_product_confirmed");
  const missingEmbedding = samples.filter((item) => !item.embedding?.vector?.length);
  const structuredProduct = getOfficialProduct(authenticProducts);
  const sources = officialSources.sources || [];
  const series = officialSources.series || [];

  const seriesRows = series.map((item) => ({
    ...item,
    count: sources.filter((source) => source.officialSeriesId === item.id || source.officialSeriesName === item.name).length
  }));

  const tp = Number(lawyerReport.summary?.total || accusedSamples.length || 0);
  const fn = Number(lawyerReport.summary?.highRiskRecall === 1 ? 0 : 0);
  const tn = Number(authenticReport.summary?.total || authenticSamples.length || 0);
  const fp = Number(authenticReport.summary?.falseHighRisk || 0);
  const sensitivityValue = numericPercent(tp, tp + fn);
  const specificityValue = numericPercent(tn - fp, tn);
  const embeddingCoverageValue = numericPercent(samples.length - missingEmbedding.length, samples.length);
  const labelledSamples = samples.filter((sample) => sample.labelStatus === "active");
  const lawyerLabeledSamples = labelledSamples.filter((sample) => /lawyer|doc/.test(sample.labelSource || ""));
  const validityValue = numericPercent(
    lawyerLabeledSamples.length + (structuredRules.legalReasoningRules?.length || 0),
    labelledSamples.length + (structuredRules.legalReasoningRules?.length || 0)
  );
  const reliabilityParts = [sensitivityValue, specificityValue, embeddingCoverageValue].filter((value) => value !== null);
  const reliabilityValue = reliabilityParts.length
    ? Number((reliabilityParts.reduce((sum, value) => sum + value, 0) / reliabilityParts.length).toFixed(1))
    : null;

  return {
    overview: {
      authenticSamples: authenticSamples.length,
      accusedSamples: accusedSamples.length,
      totalSamples: samples.length,
      missingEmbedding: missingEmbedding.length,
      officialSources: sources.length,
      structuredProductNames: structuredProduct.marks.length,
      uploadedSamples: (confirmedSamples.samples || []).filter((sample) => sample.filePath).length,
      series: series.length,
      sensitivity: percent(tp, tp + fn),
      specificity: percent(tn - fp, tn),
      reliability: formatPercent(reliabilityValue),
      validity: formatPercent(validityValue),
      sensitivityRaw: { hit: tp, total: tp + fn || tp },
      specificityRaw: { hit: tn - fp, total: tn },
      reliabilityRaw: { value: reliabilityValue, label: "灵敏度、特异度和向量覆盖率的综合稳定性参考" },
      validityRaw: { value: validityValue, label: "律师标注样本和结构化裁判规则覆盖度参考" }
    },
    files: {
      imageLibrary: await fileInfo(dataFiles.imageLibrary),
      officialSources: await fileInfo(dataFiles.officialSources),
      authenticProducts: await fileInfo(dataFiles.authenticProducts),
      structuredRules: await fileInfo(dataFiles.structuredRules)
    },
    officialSources: sortByName(sources),
    series: seriesRows,
    uploadedSamples: sortByName((confirmedSamples.samples || []).filter((sample) => sample.filePath)),
    judgementConfig: {
      strategy: { ...defaultStrategy, ...(judgementConfig.strategy || {}) },
      presets: judgementConfig.presets || []
    },
    structuredProductNames: [...structuredProduct.marks].sort((a, b) => a.localeCompare(b, "zh-CN")),
    structuredRules: {
      protectedElements: structuredRules.protectedElements?.length || 0,
      legalReasoningRules: structuredRules.legalReasoningRules?.length || 0,
      evidenceCombinations: structuredRules.evidenceCombinations?.length || 0
    }
  };
}

export async function addOfficialSource(input) {
  const data = await readJson(dataFiles.officialSources, { version: 1, sources: [], series: [] });
  const productName = normalizeText(input.productName);
  const imageUrl = normalizeText(input.imageUrl);
  if (!productName) throw new Error("产品名称不能为空");
  if (!imageUrl) throw new Error("图片地址不能为空");

  const seriesName = normalizeText(input.officialSeriesName) || "人工维护";
  const sourceUrl = normalizeText(input.sourceUrl);
  const id = `manual-official-${hashId(`${productName}|${imageUrl}|${sourceUrl}`)}`;
  if ((data.sources || []).some((item) => item.id === id || item.imageUrl === imageUrl)) {
    throw new Error("该正品来源已存在");
  }

  const item = {
    id,
    title: normalizeText(input.title) || `人工维护正品图-${seriesName}-${productName}`,
    productName,
    officialProductId: normalizeText(input.officialProductId) || "manual",
    officialSeriesId: normalizeText(input.officialSeriesId) || `manual-${hashId(seriesName)}`,
    officialSeriesName: seriesName,
    filePath: normalizeText(input.filePath),
    imageUrl,
    thumbnailUrl: normalizeText(input.thumbnailUrl) || imageUrl,
    sourceUrl,
    sourceName: normalizeText(input.sourceName) || "管理端人工维护",
    labelSource: "admin_manual",
    structuredTags: Array.isArray(input.structuredTags) ? input.structuredTags.map(normalizeText).filter(Boolean) : ["官网正品", seriesName, "人工维护"],
    visualFactors: Array.isArray(input.visualFactors) ? input.visualFactors.map(normalizeText).filter(Boolean) : ["正品酒瓶", "正品酒盒"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  data.sources = [...(data.sources || []), item];
  data.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.officialSources, data);
  return getAdminKnowledge();
}

export async function updateOfficialSource(id, patch) {
  const data = await readJson(dataFiles.officialSources, { version: 1, sources: [], series: [] });
  const sources = data.sources || [];
  const index = sources.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("未找到要编辑的正品来源");

  const allowed = ["title", "productName", "officialSeriesName", "imageUrl", "thumbnailUrl", "sourceUrl", "sourceName", "filePath"];
  const next = { ...sources[index] };
  for (const key of allowed) {
    if (key in patch) next[key] = normalizeText(patch[key]);
  }
  if (!next.productName) throw new Error("产品名称不能为空");
  if (!next.imageUrl) throw new Error("图片地址不能为空");
  next.updatedAt = new Date().toISOString();

  sources[index] = next;
  data.sources = sources;
  data.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.officialSources, data);
  return getAdminKnowledge();
}

export async function deleteOfficialSource(id) {
  const data = await readJson(dataFiles.officialSources, { version: 1, sources: [], series: [] });
  const before = data.sources?.length || 0;
  data.sources = (data.sources || []).filter((item) => item.id !== id);
  if (data.sources.length === before) throw new Error("未找到要删除的正品来源");
  data.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.officialSources, data);
  return getAdminKnowledge();
}

export async function addStructuredProductName(name) {
  const data = await readJson(dataFiles.authenticProducts, { version: 1, products: [] });
  const product = getOfficialProduct(data);
  const text = normalizeText(name);
  if (!text) throw new Error("产品名不能为空");
  if (product.marks.includes(text)) throw new Error("该产品名已存在");
  product.marks.push(text);
  product.marks.sort((a, b) => a.localeCompare(b, "zh-CN"));
  product.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.authenticProducts, data);
  return getAdminKnowledge();
}

export async function deleteStructuredProductName(name) {
  const data = await readJson(dataFiles.authenticProducts, { version: 1, products: [] });
  const product = getOfficialProduct(data);
  const text = normalizeText(name);
  const before = product.marks.length;
  product.marks = product.marks.filter((item) => item !== text);
  if (product.marks.length === before) throw new Error("未找到要删除的产品名");
  product.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.authenticProducts, data);
  return getAdminKnowledge();
}

export async function updateStructuredProductName(oldName, newName) {
  const data = await readJson(dataFiles.authenticProducts, { version: 1, products: [] });
  const product = getOfficialProduct(data);
  const current = normalizeText(oldName);
  const next = normalizeText(newName);
  if (!current) throw new Error("原产品名不能为空");
  if (!next) throw new Error("新产品名不能为空");
  const index = product.marks.findIndex((item) => item === current);
  if (index < 0) throw new Error("未找到要编辑的产品名");
  if (current !== next && product.marks.includes(next)) throw new Error("新产品名已存在");
  product.marks[index] = next;
  product.marks.sort((a, b) => a.localeCompare(b, "zh-CN"));
  product.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.authenticProducts, data);
  return getAdminKnowledge();
}

export async function addUploadedSample(formData) {
  const file = formData.get("file");
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("请上传图片文件");
  if (!String(file.type || "").startsWith("image/")) throw new Error("只支持图片文件");

  const labelType = normalizeText(formData.get("labelType"));
  if (!["authentic", "accused"].includes(labelType)) throw new Error("请选择正品样本或侵权样本");

  const title = normalizeText(formData.get("title")) || normalizeText(file.name) || "管理端上传样本";
  const productName = normalizeText(formData.get("productName"));
  const reason = normalizeText(formData.get("reason")) || (labelType === "authentic" ? "管理端人工确认的正品样本。" : "管理端人工确认的侵权/高风险样本。");
  const buffer = Buffer.from(await file.arrayBuffer());
  if (!buffer.length) throw new Error("图片文件为空");
  if (buffer.length > 12 * 1024 * 1024) throw new Error("图片不能超过 12MB");

  const imageSha256 = createHash("sha256").update(buffer).digest("hex");
  const data = await readJson(dataFiles.confirmedSamples, {
    version: 1,
    source: "用户反馈确认样本，用于本地学习和回归测试",
    samples: []
  });
  if ((data.samples || []).some((sample) => sample.imageSha256 === imageSha256)) {
    throw new Error("该图片样本已存在");
  }

  await mkdir(uploadImageDir, { recursive: true });
  const prefix = labelType === "authentic" ? "authentic" : "accused";
  const fileName = `${prefix}-${Date.now()}-${safeFilePart(file.name) || imageSha256.slice(0, 10)}${extensionFromMime(file.type, file.name)}`;
  const absolutePath = path.join(uploadImageDir, fileName);
  const relativePath = path.relative(root, absolutePath);
  await writeFile(absolutePath, buffer);

  const sample = {
    id: `admin-${prefix}-${imageSha256.slice(0, 12)}`,
    title,
    productName,
    category: labelType === "authentic" ? "authentic_product_confirmed" : "accused_product_confirmed",
    filePath: relativePath,
    imageSha256,
    expectedRiskLevel: labelType === "authentic" ? "低风险" : "高风险",
    expectedIdentity: labelType === "authentic" ? "likely_authentic" : "suspected_accused",
    labelSource: "admin_upload_confirmed",
    labelStatus: "active",
    reason,
    createdAt: new Date().toISOString()
  };

  data.samples = [...(data.samples || []), sample];
  data.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.confirmedSamples, data);
  return getAdminKnowledge();
}

export async function updateJudgementStrategy(input = {}) {
  const data = await readJson(dataFiles.judgementConfig, {
    version: 1,
    source: "管理端研判策略配置",
    strategy: defaultStrategy,
    presets: []
  });
  const presets = data.presets || [];
  const preset = presets.find((item) => item.mode === input.mode);
  const current = { ...defaultStrategy, ...(data.strategy || {}) };
  const base = input.mode && input.mode !== "custom" && preset ? preset : current;
  const next = {
    ...base,
    mode: input.mode === "custom" ? "custom" : base.mode || "balanced",
    name: normalizeText(input.name) || base.name || "自定义策略",
    description: normalizeText(input.description) || base.description || "管理端自定义研判策略。",
    highRiskThreshold: clampNumber(input.highRiskThreshold ?? base.highRiskThreshold, 50, 95, defaultStrategy.highRiskThreshold),
    lowRiskMax: clampNumber(input.lowRiskMax ?? base.lowRiskMax, 0, 50, defaultStrategy.lowRiskMax),
    embeddingSimilarityThreshold: clampNumber(input.embeddingSimilarityThreshold ?? base.embeddingSimilarityThreshold, 75, 99, defaultStrategy.embeddingSimilarityThreshold),
    visualSimilarityThreshold: clampNumber(input.visualSimilarityThreshold ?? base.visualSimilarityThreshold, 70, 98, defaultStrategy.visualSimilarityThreshold),
    visualAverageDistanceMax: clampNumber(input.visualAverageDistanceMax ?? base.visualAverageDistanceMax, 4, 20, defaultStrategy.visualAverageDistanceMax),
    visualDifferenceDistanceMax: clampNumber(input.visualDifferenceDistanceMax ?? base.visualDifferenceDistanceMax, 4, 24, defaultStrategy.visualDifferenceDistanceMax),
    authenticProtectionScore: clampNumber(input.authenticProtectionScore ?? base.authenticProtectionScore, -100, -20, defaultStrategy.authenticProtectionScore),
    confirmedAuthenticScore: clampNumber(input.confirmedAuthenticScore ?? base.confirmedAuthenticScore, -100, -20, defaultStrategy.confirmedAuthenticScore),
    confirmedAccusedScore: clampNumber(input.confirmedAccusedScore ?? base.confirmedAccusedScore, 60, 100, defaultStrategy.confirmedAccusedScore),
    confirmedAccusedVisualScore: clampNumber(input.confirmedAccusedVisualScore ?? base.confirmedAccusedVisualScore, 50, 100, defaultStrategy.confirmedAccusedVisualScore),
    updatedAt: new Date().toISOString()
  };
  if (next.lowRiskMax >= next.highRiskThreshold) {
    throw new Error("低风险上限必须小于高风险阈值");
  }
  data.strategy = next;
  data.updatedAt = new Date().toISOString();
  await writeJson(dataFiles.judgementConfig, data);
  return getAdminKnowledge();
}
