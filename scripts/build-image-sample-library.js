import { createHash } from "node:crypto";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { callDashscopeImageEmbedding, embeddingConfig, loadProjectEnv } from "../lib/dashscope-embedding.js";

const outputPath = "data/knowledge/image-samples.json";
const evaluationOutputPath = "data/evaluation/lawyer-doc-samples.json";
const authenticEvaluationOutputPath = "data/evaluation/authentic-image-samples.json";
const officialAuthenticImageSourcesPath = "data/knowledge/official-authentic-image-sources.json";
const confirmedSamplesPath = "data/knowledge/confirmed-samples.json";
const confirmedLawyerImageIds = new Set(Array.from({ length: 8 }, (_, index) => `lawyer-doc-ocr-image-${index + 1}`));
const shouldBuildEmbedding = process.argv.includes("--embedding");
loadProjectEnv();

const authenticImageSources = [
  {
    id: "authentic-xijiu-official-jiaocang-series",
    title: "习酒官网正品图-窖藏系列",
    filePath: "data/knowledge/authentic-images/xijiu-official-jiaocang-series.jpg",
    sourceUrl: "https://www.gzxijiu.com/",
    sourceName: "贵州习酒官网产品中心",
    labelSource: "official_website"
  },
  {
    id: "authentic-xijiu-official-junpin-series",
    title: "习酒官网正品图-君品系列",
    filePath: "data/knowledge/authentic-images/xijiu-official-junpin-series.jpg",
    sourceUrl: "https://www.gzxijiu.com/",
    sourceName: "贵州习酒官网产品中心",
    labelSource: "official_website"
  },
  {
    id: "authentic-xijiu-official-jinzuan-series",
    title: "习酒官网正品图-金钻系列",
    filePath: "data/knowledge/authentic-images/xijiu-official-jinzuan-series.jpg",
    sourceUrl: "https://www.gzxijiu.com/",
    sourceName: "贵州习酒官网产品中心",
    labelSource: "official_website"
  },
  {
    id: "authentic-xijiu-official-1988-banner",
    title: "习酒官网正品图-窖藏1988",
    filePath: "data/knowledge/authentic-images/xijiu-official-1988-banner.jpg",
    sourceUrl: "https://www.gzxijiu.com/",
    sourceName: "贵州习酒官网首页 Banner",
    labelSource: "official_website"
  },
  {
    id: "authentic-xijiu-authorized-wine88-1988-1l",
    title: "授权渠道正品图-习酒窖藏1988-1L",
    filePath: "data/knowledge/authentic-images/xijiu-authorized-wine88-1988-1l.jpg",
    sourceUrl: "https://wine88.com/en/xi-jiu/309-xi-jiu-jiao-cang-1988.html",
    sourceName: "Wine88 商品页",
    labelSource: "authorized_channel_seed"
  },
  {
    id: "authentic-xijiu-authorized-wine88-1988-375",
    title: "授权渠道正品图-习酒窖藏1988-375ml",
    filePath: "data/knowledge/authentic-images/xijiu-authorized-wine88-1988-375.jpg",
    sourceUrl: "https://wine88.com/en/xi-jiu/309-xi-jiu-jiao-cang-1988.html",
    sourceName: "Wine88 商品页",
    labelSource: "authorized_channel_seed"
  }
];

async function optionalJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

const officialAuthenticImageSources = await optionalJson(officialAuthenticImageSourcesPath, { sources: [] });
const confirmedSamplesKnowledge = await optionalJson(confirmedSamplesPath, { samples: [] });
const allAuthenticImageSources = [
  ...authenticImageSources,
  ...(officialAuthenticImageSources.sources || [])
];
const adminUploadedSamples = (confirmedSamplesKnowledge.samples || []).filter((sample) => {
  return sample.filePath && ["authentic_product_confirmed", "accused_product_confirmed"].includes(sample.category);
});
const existingLibrary = await optionalJson(outputPath, { samples: [] });
const existingSamplesById = new Map((existingLibrary.samples || []).map((sample) => [sample.id, sample]));
const existingSamplesByHash = new Map(
  (existingLibrary.samples || [])
    .filter((sample) => sample.imageSha256 && sample.embedding)
    .map((sample) => [sample.imageSha256, sample])
);

async function visualFingerprint(filePath) {
  const imageBuffer = await readFile(filePath);
  const averagePixels = await sharp(imageBuffer)
    .rotate()
    .resize(8, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  const average = averagePixels.reduce((sum, value) => sum + value, 0) / averagePixels.length;
  const averageHash = [...averagePixels].map((value) => (value >= average ? "1" : "0")).join("");

  const differencePixels = await sharp(imageBuffer)
    .rotate()
    .resize(9, 8, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer();
  let differenceHash = "";
  for (let row = 0; row < 8; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const offset = row * 9 + column;
      differenceHash += differencePixels[offset] > differencePixels[offset + 1] ? "1" : "0";
    }
  }

  return {
    imageSha256: createHash("sha256").update(imageBuffer).digest("hex"),
    visualFingerprint: {
      method: "average-hash-8x8 + difference-hash-9x8-grayscale",
      averageHash,
      differenceHash
    }
  };
}

function mimeFromPath(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

async function imageDataUrl(filePath) {
  const buffer = await readFile(filePath);
  if (buffer.length <= 9.5 * 1024 * 1024) {
    return `data:${mimeFromPath(filePath)};base64,${buffer.toString("base64")}`;
  }
  const compressed = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${compressed.toString("base64")}`;
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

function imageNumber(fileName) {
  return Number(String(fileName).match(/image(\d+)/)?.[1] || 0);
}

function sampleId(fileName) {
  return `lawyer-doc-ocr-image-${imageNumber(fileName)}`;
}

function isLegalOrEvidenceText(text) {
  return /法院|本院|判决|裁定|原告|被告|上诉|侵权责任|商标法|反不正当竞争|专利法|第\d+号|注册商标|公证书|证据|纳税|税率|有明显区别|容易导致混淆|保护范围|权利归属/.test(text);
}

function isProductOrPackageText(text) {
  return /酒|白酒|瓶|瓶身|瓶盖|酒盒|包装|装潢|净含量|vol|ml|mL|品牌|产品名|视觉要素|正面|侧面|背面|习酒|習酒|窖藏|1988|君品|习水|習水|祥康|洋河|汾酒|剑南春|茅台|古井|老白干|国酱|国韵|国色天香|清香|酱香/.test(text);
}

function classifyOcrImage(row) {
  const id = sampleId(row.image);
  const text = plainOcrText(row.text);
  if (confirmedLawyerImageIds.has(id)) {
    return {
      category: "accused_product_confirmed",
      expectedRiskLevel: "高风险",
      expectedIdentity: "suspected_accused",
      labelSource: "lawyer_doc_confirmed",
      labelStatus: "active",
      reason: "律师 Word 文档中表示侵权产品的确认样本，应作为高风险侵权样本处理。"
    };
  }
  if (isLegalOrEvidenceText(text)) {
    return {
      category: "court_text_or_evidence",
      expectedRiskLevel: "",
      expectedIdentity: "",
      labelSource: "ocr_rule_classified",
      labelStatus: "reference_only",
      reason: "OCR 显示为判词、商标、证据或法律论证材料，不直接作为单张产品侵权标签。"
    };
  }
  if (isProductOrPackageText(text)) {
    return {
      category: "accused_product_confirmed",
      expectedRiskLevel: "高风险",
      expectedIdentity: "suspected_accused",
      labelSource: "lawyer_doc_confirmed",
      labelStatus: "active",
      reason: "用户确认律师 Word 中已列出的侵权产品图片均可入库，应作为高风险侵权样本处理。"
    };
  }
  return {
    category: "other_reference_material",
    expectedRiskLevel: "",
    expectedIdentity: "",
    labelSource: "ocr_rule_classified",
    labelStatus: "reference_only",
    reason: "暂未识别为明确产品图，仅作为参考材料保留。"
  };
}

const samples = [];
const ocrKnowledge = JSON.parse(await readFile("data/extracted/ocr/xijiu-doc-knowledge.json", "utf8"));
const ocrRows = (ocrKnowledge.ocrResults || [])
  .filter((row) => row.image)
  .sort((left, right) => imageNumber(left.image) - imageNumber(right.image));

for (const row of ocrRows) {
  const classification = classifyOcrImage(row);
  if (classification.category !== "accused_product_confirmed" && classification.category !== "accused_product_candidate") continue;
  const filePath = path.join("data/extracted/docx-images", row.image);
  const fingerprint = await visualFingerprint(filePath);
  const cachedSample = existingSamplesById.get(sampleId(row.image));
  const cachedEmbeddingSample = cachedSample?.imageSha256 === fingerprint.imageSha256
    ? cachedSample
    : existingSamplesByHash.get(fingerprint.imageSha256);
  const embeddingResult = shouldBuildEmbedding && !cachedEmbeddingSample?.embedding
    ? await callDashscopeImageEmbedding(await imageDataUrl(filePath))
    : null;
  const embedding = embeddingResult
    ? {
        provider: "aliyun-bailian-dashscope",
        model: embeddingResult.model,
        dimension: embeddingResult.dimension,
        vector: embeddingResult.embedding
      }
    : cachedEmbeddingSample?.embedding;
  samples.push({
    id: sampleId(row.image),
    title: `律师Word图片样本-${imageNumber(row.image)}`,
    category: classification.category,
    sourceDocument: "习酒典型侵权产品图片及判决.docx",
    filePath,
    expectedRiskLevel: classification.expectedRiskLevel,
    expectedIdentity: classification.expectedIdentity,
    labelSource: classification.labelSource,
    labelStatus: classification.labelStatus,
    reason: classification.reason,
    ocrSummary: plainOcrText(row.text).slice(0, 180),
    embedding,
    ...fingerprint
  });
  console.log(`样本入库: ${row.image}${embeddingResult ? ` embedding ${embeddingResult.dimension}d` : cachedEmbeddingSample?.embedding ? " cached embedding" : ""}`);
}

for (const source of allAuthenticImageSources) {
  const fingerprint = await visualFingerprint(source.filePath);
  const cachedSample = existingSamplesById.get(source.id);
  const cachedEmbeddingSample = cachedSample?.imageSha256 === fingerprint.imageSha256
    ? cachedSample
    : existingSamplesByHash.get(fingerprint.imageSha256);
  const embeddingResult = shouldBuildEmbedding && !cachedEmbeddingSample?.embedding
    ? await callDashscopeImageEmbedding(await imageDataUrl(source.filePath))
    : null;
  const embedding = embeddingResult
    ? {
        provider: "aliyun-bailian-dashscope",
        model: embeddingResult.model,
        dimension: embeddingResult.dimension,
        vector: embeddingResult.embedding
      }
    : cachedEmbeddingSample?.embedding;
  samples.push({
    id: source.id,
    title: source.title,
    category: "authentic_product_confirmed",
    sourceDocument: source.sourceName,
    sourceUrl: source.sourceUrl,
    filePath: source.filePath,
    expectedRiskLevel: "低风险",
    expectedIdentity: "likely_authentic",
    labelSource: source.labelSource,
    labelStatus: "active",
    reason: "来自官方或授权渠道的权利人正品样本，用于降低正品误判为侵权的风险。",
    productName: source.productName || "",
    officialProductId: source.officialProductId || "",
    structuredTags: source.structuredTags || [],
    visualFactors: source.visualFactors || [],
    embedding,
    ...fingerprint
  });
  console.log(`正品样本入库: ${source.filePath}${embeddingResult ? ` embedding ${embeddingResult.dimension}d` : cachedEmbeddingSample?.embedding ? " cached embedding" : ""}`);
}

for (const source of adminUploadedSamples) {
  const fingerprint = await visualFingerprint(source.filePath);
  const cachedSample = existingSamplesById.get(source.id);
  const cachedEmbeddingSample = cachedSample?.imageSha256 === fingerprint.imageSha256
    ? cachedSample
    : existingSamplesByHash.get(fingerprint.imageSha256);
  const embeddingResult = shouldBuildEmbedding && !cachedEmbeddingSample?.embedding
    ? await callDashscopeImageEmbedding(await imageDataUrl(source.filePath))
    : null;
  const embedding = embeddingResult
    ? {
        provider: "aliyun-bailian-dashscope",
        model: embeddingResult.model,
        dimension: embeddingResult.dimension,
        vector: embeddingResult.embedding
      }
    : cachedEmbeddingSample?.embedding;
  samples.push({
    id: source.id,
    title: source.title,
    category: source.category,
    sourceDocument: "管理端人工上传确认样本",
    filePath: source.filePath,
    expectedRiskLevel: source.expectedRiskLevel,
    expectedIdentity: source.expectedIdentity,
    labelSource: source.labelSource || "admin_upload_confirmed",
    labelStatus: source.labelStatus || "active",
    reason: source.reason || "管理端人工确认样本。",
    productName: source.productName || "",
    embedding,
    ...fingerprint
  });
  console.log(`管理端上传样本入库: ${source.filePath}${embeddingResult ? ` embedding ${embeddingResult.dimension}d` : cachedEmbeddingSample?.embedding ? " cached embedding" : ""}`);
}

const library = {
  version: 1,
  source: "律师样本图片分层库，用于精确哈希、百炼图片向量和视觉相似度匹配",
  embedding: shouldBuildEmbedding ? {
    provider: "aliyun-bailian-dashscope",
    model: embeddingConfig().model,
    dimension: embeddingConfig().dimension,
    resLevel: embeddingConfig().resLevel
  } : null,
  categories: [
    {
      id: "accused_product_confirmed",
      title: "律师确认侵权产品图",
      riskPolicy: "命中后优先按高风险侵权样本处理"
    },
    {
      id: "accused_product_candidate",
      title: "律师 Word 侵权产品候选图",
      riskPolicy: "保留分类兼容旧评测；当前已由用户确认的产品图统一升级为律师确认侵权产品图"
    },
    {
      id: "authentic_product_confirmed",
      title: "律师确认权利人正品图",
      riskPolicy: "命中后优先按低风险/正品保护处理"
    },
    {
      id: "court_text_or_evidence",
      title: "裁判文书、商标证据或判词截图",
      riskPolicy: "仅作为规则依据，不直接作为产品风险标签"
    },
    {
      id: "comparison_material",
      title: "包装装潢对比材料",
      riskPolicy: "用于提取相似要素，不直接作为单图侵权标签"
    }
  ],
  samples
};

await writeFile(outputPath, `${JSON.stringify(library, null, 2)}\n`);

const evaluationManifest = {
  version: 2,
  description: "来自律师 Word 文档内嵌图片的产品图评测集。expectedRiskLevel 只用于评测脚本，不会传给研判接口。",
  sourceDocument: "data/source/习酒典型侵权产品图片及判决.docx",
  samples: samples
    .filter((sample) => sample.labelStatus === "active" && sample.category === "accused_product_confirmed")
    .map((sample) => ({
      id: sample.id,
      title: sample.title,
      filePath: sample.filePath,
      expectedRiskLevel: sample.expectedRiskLevel,
      expectedIdentity: sample.expectedIdentity,
      labelSource: sample.labelSource,
      labelStatus: sample.labelStatus,
      category: sample.category
    }))
};

await writeFile(evaluationOutputPath, `${JSON.stringify(evaluationManifest, null, 2)}\n`);

const authenticEvaluationManifest = {
  version: 1,
  description: "来自官网和授权渠道的正品图片评测集。用于验证正品保护和误判控制。",
  samples: samples
    .filter((sample) => sample.labelStatus === "active" && sample.category === "authentic_product_confirmed")
    .map((sample) => ({
      id: sample.id,
      title: sample.title,
      filePath: sample.filePath,
      sourceUrl: sample.sourceUrl || "",
      expectedRiskLevel: sample.expectedRiskLevel,
      expectedIdentity: sample.expectedIdentity,
      labelSource: sample.labelSource,
      labelStatus: sample.labelStatus,
      category: sample.category
    }))
};

await writeFile(authenticEvaluationOutputPath, `${JSON.stringify(authenticEvaluationManifest, null, 2)}\n`);
console.log(`已写入 ${outputPath}，样本数：${samples.length}`);
console.log(`已写入 ${evaluationOutputPath}，评测样本数：${evaluationManifest.samples.length}`);
console.log(`已写入 ${authenticEvaluationOutputPath}，正品评测样本数：${authenticEvaluationManifest.samples.length}`);
