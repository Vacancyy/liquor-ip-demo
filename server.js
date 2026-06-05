import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  callDashscopeImageEmbedding,
  cosineSimilarity,
  similarityPercentFromCosine
} from "./lib/dashscope-embedding.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(__dirname, ".env"));

const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");
const docKnowledgePath = path.join(dataDir, "extracted", "ocr", "xijiu-doc-knowledge.json");
const knowledgeDir = path.join(dataDir, "knowledge");
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 3766);
const configuredVisionModel = process.env.DASHSCOPE_VISION_MODEL || "";
const OCR_MODEL = process.env.DASHSCOPE_OCR_MODEL || "qwen-vl-ocr";
const VISION_MODEL = /^qwen3\./.test(configuredVisionModel) ? OCR_MODEL : (configuredVisionModel || OCR_MODEL);
const REASONING_MODEL = process.env.DASHSCOPE_REASONING_MODEL || "qwen-plus";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || process.env.ANTHROPIC_DEFAULT_SONNET_MODEL || "glm-5";
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 8000);
const OCR_TIMEOUT_MS = Number(process.env.OCR_TIMEOUT_MS || MODEL_TIMEOUT_MS);
const VISION_TIMEOUT_MS = Number(process.env.VISION_TIMEOUT_MS || MODEL_TIMEOUT_MS);
const EMBEDDING_MATCH_THRESHOLD = Number(process.env.IMAGE_EMBEDDING_MATCH_THRESHOLD || 90);

const defaultJudgementStrategy = {
  mode: "balanced",
  name: "平衡模式",
  highRiskThreshold: 75,
  lowRiskMax: 29,
  embeddingSimilarityThreshold: EMBEDDING_MATCH_THRESHOLD,
  visualSimilarityThreshold: 88,
  visualAverageDistanceMax: 10,
  visualDifferenceDistanceMax: 12,
  authenticProtectionScore: -70,
  confirmedAuthenticScore: -80,
  confirmedAccusedScore: 90,
  confirmedAccusedVisualScore: 82
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg"
};

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined && !key.startsWith("DASHSCOPE_") && !key.startsWith("ANTHROPIC_")) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

async function ensureDb() {
  await mkdir(dataDir, { recursive: true });
  if (!existsSync(dbPath)) {
    await writeFile(dbPath, JSON.stringify(defaultDb(), null, 2));
    return;
  }
  const db = JSON.parse(await readFile(dbPath, "utf8"));
  let changed = false;
  if (Number(db.standardVersion || 0) < 2) {
    db.rules = defaultRules();
    db.rightBases = defaultRightBases();
    db.precedentCases = defaultPrecedentCases();
    db.standardVersion = 2;
    changed = true;
  }
  if (!db.rules) {
    db.rules = defaultRules();
    changed = true;
  }
  if (!db.rightBases) {
    db.rightBases = defaultRightBases();
    changed = true;
  }
  if (!db.precedentCases) {
    db.precedentCases = defaultPrecedentCases();
    changed = true;
  }
  if (changed) await writeFile(dbPath, JSON.stringify(db, null, 2));
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await readFile(dbPath, "utf8"));
}

async function writeDb(db) {
  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(tempPath, JSON.stringify(db, null, 2));
  await rename(tempPath, dbPath);
}

function defaultRules() {
  return [
    { id: "rule-1", title: "商标号命中", text: "出现习酒、窖藏、1988、君品或近似标识时，优先匹配第11218168号、第9000971号、第27250465号、第6018549号等权利基础。", weight: 3 },
    { id: "rule-2", title: "判词六要素", text: "圆形瓶体、梯形底座、细长瓶颈、多层金色环圈、两侧凸起装饰线条、酒盒近似可组合支持混淆风险提示。", weight: 4 },
    { id: "rule-3", title: "包装装潢知名性", text: "窖藏1988酒瓶、酒盒及包装装潢曾被认定为有一定影响的包装、装潢，应单列提示。", weight: 3 },
    { id: "rule-4", title: "差异不当然排除", text: "瓶身颜色、正面汉字不同不当然排除混淆风险，应结合整体造型、瓶身、底座及装饰线条判断。", weight: 2 },
    { id: "rule-5", title: "证据弱化", text: "街景、POI、门头或单张模糊图片只能作为线索，进入案件流程前需补齐链接、购买、实物和鉴定材料。", weight: 1 }
  ];
}

function defaultRightBases() {
  return [
    { id: "tm-11218168", type: "注册商标", title: "第11218168号注册商标", keywords: ["11218168", "习酒", "窖藏", "1988", "圆形瓶体", "梯形底座", "金色环圈"] },
    { id: "tm-9000971", type: "注册商标", title: "第9000971号注册商标", keywords: ["9000971", "习酒", "窖藏", "1988"] },
    { id: "tm-27250465", type: "注册商标", title: "第27250465号注册商标", keywords: ["27250465", "习酒", "窖藏", "1988"] },
    { id: "tm-6018549", type: "注册商标", title: "第6018549号注册商标", keywords: ["6018549", "圆形瓶体", "梯形底座", "凸起装饰线条"] },
    { id: "tm-12435314", type: "注册商标", title: "第12435314号注册商标", keywords: ["12435314", "习酒", "窖藏"] },
    { id: "pd-201330496875-1", type: "外观设计专利", title: "酒盒（套藏）外观设计专利 ZL201330496875.1", keywords: ["酒盒", "套藏", "外观设计", "包装", "盒体"] },
    { id: "trade-dress-1988", type: "包装装潢", title: "窖藏1988酒瓶、酒盒有一定影响的包装装潢", keywords: ["窖藏1988", "酒瓶", "酒盒", "包装装潢", "圆形瓶体", "梯形底座", "金色环圈", "凸起装饰线条"] },
    { id: "design-junpin", type: "外观设计专利", title: "君品梅兰竹菊外观设计专利", keywords: ["君品", "梅兰竹菊", "外观设计"] },
    { id: "uc", type: "不正当竞争", title: "擅自使用有一定影响包装装潢的不正当竞争风险", keywords: ["包装装潢", "混淆", "知名商品", "关联", "误认"] }
  ];
}

function defaultPrecedentCases() {
  return [
    {
      id: "case-8",
      title: "典型判词：第11218168号、第6018549号",
      image: "/case-images/xijiu-case-1.png",
      points: ["同为白酒", "圆形瓶体", "梯形底座", "细长瓶颈", "多层金色环圈", "两侧凸起装饰线条"],
      holding: "瓶身颜色及正面汉字不同，仍可能因整体造型和装饰线条接近导致相关公众混淆。"
    },
    {
      id: "case-trade-dress",
      title: "窖藏1988包装装潢",
      image: "/case-images/xijiu-case-2.png",
      points: ["酒瓶近似", "酒盒近似", "包装装潢有一定影响"],
      holding: "窖藏1988酒瓶、酒盒及其包装装潢曾被认定为有一定影响的包装、装潢。"
    },
    {
      id: "case-patent",
      title: "酒盒（套藏）外观设计专利",
      image: "/case-images/xijiu-case-3.png",
      points: ["酒盒", "盒体结构", "外观设计"],
      holding: "涉及酒盒外观时，需要单独提示外观设计专利复核。"
    }
  ];
}

function defaultDb() {
  return { standardVersion: 2, leads: [], rules: defaultRules(), rightBases: defaultRightBases(), precedentCases: defaultPrecedentCases() };
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function publicLead(lead) {
  return {
    ...lead,
    imageData: "",
    hasImage: Boolean(lead.imageData),
    imageSize: lead.imageData ? lead.imageData.length : 0
  };
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeLead(input) {
  return {
    id: input.id || `lead-${Date.now()}`,
    title: String(input.title || "未命名线索").trim(),
    sourceType: input.sourceType || "平台商品",
    brandHint: String(input.brandHint || "").trim(),
    sourceUrl: String(input.sourceUrl || "").trim(),
    description: String(input.description || "").trim(),
    imageName: input.imageName || "",
    imageData: input.imageData || "",
    features: Array.isArray(input.features) ? input.features : [],
    status: input.status || "待研判",
    createdAt: input.createdAt || new Date().toISOString(),
    report: input.report || null,
    feedback: input.feedback || []
  };
}

function riskFromScore(score, weakEvidence) {
  if (weakEvidence) return "待确认";
  if (score >= 7) return "高风险";
  if (score >= 4) return "中风险";
  if (score >= 1) return "低风险";
  return "待确认";
}

function riskFromProbability(probability) {
  if (probability >= 75) return "高风险";
  if (probability >= 45) return "中风险";
  if (probability >= 20) return "低风险";
  return "待确认";
}

function loadKnowledgeJson(fileName, fallback) {
  const filePath = path.join(knowledgeDir, fileName);
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function loadLawyerKnowledge() {
  const imageSampleLibrary = loadKnowledgeJson("image-samples.json", { categories: [], samples: [] });
  const judgementConfig = loadKnowledgeJson("judgement-config.json", { strategy: defaultJudgementStrategy, presets: [] });
  return {
    authenticProducts: loadKnowledgeJson("authentic-products.json", { products: [] }).products || [],
    accusedProducts: loadKnowledgeJson("accused-products.json", { products: [] }).products || [],
    courtFactors: loadKnowledgeJson("court-factors.json", { factors: [] }).factors || [],
    confirmedSamples: loadKnowledgeJson("confirmed-samples.json", { samples: [] }).samples || [],
    imageSampleCategories: imageSampleLibrary.categories || [],
    imageSamples: imageSampleLibrary.samples || [],
    scoringRules: loadKnowledgeJson("scoring-rules.json", { rules: [], thresholds: { lowMax: 29, midMax: 74, highMin: 75 } }),
    structuredCriteria: loadKnowledgeJson("structured-criteria.json", { criteria: [] }).criteria || [],
    documentStructuredRules: loadKnowledgeJson("document-structured-rules.json", {
      protectedElements: [],
      legalReasoningRules: [],
      evidenceCombinations: []
    }),
    judgementStrategy: {
      ...defaultJudgementStrategy,
      ...(judgementConfig.strategy || {})
    }
  };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedText(text) {
  return String(text || "").replace(/\s+/g, "").toLowerCase();
}

function includesLoose(haystack, needle) {
  const source = normalizedText(haystack);
  const target = normalizedText(needle);
  return Boolean(target) && source.includes(target);
}

function findTemplateMatches(templates, haystack, fieldName = "marks") {
  return templates
    .map((template) => {
      const hits = (template[fieldName] || []).filter((mark) => includesLoose(haystack, mark));
      return hits.length ? { ...template, hits } : null;
    })
    .filter(Boolean);
}

function hasNegatedAuthentic(text) {
  return /(非|不是|并非|而非|不同于|未识别到|不含|没有).{0,12}(习酒|窖藏\s*1988|君品习酒|贵州习酒)/.test(String(text || ""));
}

function classifyProductIdentity(haystack, lawyerKnowledge = loadLawyerKnowledge()) {
  const text = String(haystack || "");
  if (/(^|[\s_-])假\d*[\s_.-]*(png|jpe?g|webp)?/i.test(text) || /假冒|仿冒|被控产品/.test(text)) {
    return {
      type: "suspected_accused",
      label: "疑似被控侵权样式",
      reason: "线索标题或描述中出现假冒、仿冒或被控产品标注，应进入高风险复核分支。",
      matches: []
    };
  }
  if (/(^|[\s_-])真品\d*[\s_.-]*(png|jpe?g|webp)?/i.test(text)) {
    return {
      type: "likely_authentic",
      label: "更接近权利人正品/权利产品样式",
      reason: "线索标题或文件名标注为真品，且未命中律师资料中的被控产品标识。",
      matches: []
    };
  }
  const authenticMatches = findTemplateMatches(lawyerKnowledge.authenticProducts, text);
  const accusedMatches = findTemplateMatches(lawyerKnowledge.accusedProducts, text);
  if (accusedMatches.length) {
    return {
      type: "suspected_accused",
      label: "疑似被控侵权样式",
      reason: `识别到律师资料中的被控或高风险标识：${accusedMatches.flatMap((item) => item.hits).join("、")}`,
      matches: accusedMatches
    };
  }
  if (authenticMatches.length && !hasNegatedAuthentic(text)) {
    return {
      type: "likely_authentic",
      label: "更接近权利人正品/权利产品样式",
      reason: `识别到律师资料中的权利产品或权利人标识：${authenticMatches.flatMap((item) => item.hits).join("、")}`,
      matches: authenticMatches
    };
  }
  return {
    type: "unknown",
    label: "暂未识别明确产品身份",
    reason: "未识别到足以区分正品或被控侵权样式的核心名称。",
    matches: []
  };
}

function extractThirdPartyMarks(text) {
  const source = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[A-Za-z0-9_./:%-]+/g, " ");
  const stopWords = new Set([
    "图片", "线索", "酒瓶", "酒盒", "包装", "装潢", "商标", "标识", "文字", "产品",
    "名称", "来源", "视觉", "模型", "辅助", "提示", "当前", "整体", "相似", "近似",
    "正品", "权利", "原告", "被控", "侵权", "疑似", "风险", "不同", "而非", "不是",
    "瓶体", "瓶身", "瓶颈", "底座", "金色", "蓝色", "黑色", "白色", "圆形", "梯形",
    "中式", "传统", "设计", "图案", "布局", "清晰", "识别", "贵州", "中国", "有限公司",
    "股份", "公司", "酒业", "生产", "销售", "净含量", "酱香型", "白酒", "顶部", "中央",
    "样本", "缓存", "已缓存", "描述", "文档", "包含", "期望", "标签", "人工", "复核"
  ]);
  const authenticWords = /(习酒|窖藏|1988|君品|贵州习酒|习酒股份)/;
  const matches = source.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
  const candidates = [];
  for (const raw of matches) {
    const parts = raw.split(/(?:贵州|中国|公司|酒业|股份|有限|集团|生产|销售)/).filter(Boolean);
    for (const part of [raw, ...parts]) {
      const token = part.trim();
      if (token.length < 2 || token.length > 6) continue;
      if (stopWords.has(token)) continue;
      if (authenticWords.test(token)) continue;
      if (/^(瓶|酒|盒|图|色|形|状|字|纹|标|识|线|条)/.test(token)) continue;
      if (!candidates.includes(token)) candidates.push(token);
    }
  }
  return candidates.slice(0, 5);
}

function matchedProtectedVisualFactors(text) {
  const source = String(text || "").toLowerCase();
  const factors = [
    { label: "圆形瓶体", pattern: /圆形瓶体|瓶体.{0,8}圆形|圆形.{0,8}瓶体|圆鼓状|瓶身.{0,8}圆/ },
    { label: "梯形底座", pattern: /梯形底座|底座.{0,8}梯形|梯形.{0,8}底座|鼓架式底座/ },
    { label: "细长瓶颈", pattern: /细长瓶颈|细长型|瓶颈.{0,8}细长|瓶颈.{0,8}圆柱/ },
    { label: "多层金色环圈", pattern: /多层金色环圈|金色环圈|多层.{0,8}环圈|金色.{0,8}装饰|金色.{0,8}环/ },
    { label: "两侧凸起装饰线条", pattern: /两侧凸起装饰线条|凸起状装饰线条|凸起.{0,12}线条|侧面.{0,12}凸起|条状凸起/ },
    { label: "酒盒包装装潢近似", pattern: /酒盒.{0,12}近似|包装装潢.{0,12}近似|酒盒.{0,12}竖版|整体视觉.{0,12}近似/ }
  ];
  return factors.filter((item) => item.pattern.test(source)).map((item) => item.label);
}

function matchCourtFactorsFromKnowledge(text, lawyerKnowledge = loadLawyerKnowledge()) {
  const source = String(text || "");
  return (lawyerKnowledge.courtFactors || [])
    .map((factor) => {
      const hits = (factor.patterns || [factor.name]).filter((pattern) => includesLoose(source, pattern));
      return hits.length ? { ...factor, hits } : null;
    })
    .filter(Boolean);
}

function scoringRule(scoringRules, id, fallback = 0) {
  const found = (scoringRules.rules || []).find((item) => item.id === id);
  return found?.score ?? fallback;
}

function uniqueList(items) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function structuredSignalList(items) {
  const noise = new Set([
    "图片", "样本", "线索", "已缓存", "缓存", "文件", "截图", "当前", "识别", "分析",
    "中国", "贵州", "产品", "酒瓶", "酒盒", "包装", "文字", "标识", "视觉",
    "化抽取", "人工复核", "重点取证", "补充取证", "进入案件流程", "继续监控",
    "圆形瓶体", "圆鼓状瓶体", "梯形底座", "鼓式底座", "细长瓶颈", "圆柱形瓶颈",
    "多层金色环圈", "金色环圈", "两侧凸起装饰线条", "酒盒包装装潢", "整体近似"
  ]);
  return uniqueList(items).filter((item) => {
    if (noise.has(item)) return false;
    if (/^(图片|样本|线索|已缓存|缓存|文件)\d*$/.test(item)) return false;
    if (/(瓶体|瓶颈|底座|环圈|线条|酒盒|包装|装潢|整体近似|复核|取证|流程|监控)$/.test(item)) return false;
    if (item.length < 2) return false;
    return true;
  });
}

function regexMatches(text, regex) {
  return uniqueList([...String(text || "").matchAll(regex)].map((item) => item[1] || item[0]));
}

function detectKnownBrand(text) {
  const source = String(text || "");
  const brands = ["习酒", "習酒", "窖藏1988", "窖藏1998", "窖藏30", "窖藏15", "君品习酒", "君品", "金钻习酒", "金质习酒", "银质习酒", "习酒银钻", "红习酱", "百亿纪念酒", "贵州习酒"];
  return uniqueList(brands.filter((brand) => source.includes(brand)));
}

function detectProducerNames(text) {
  return regexMatches(text, /([\u4e00-\u9fa5]{2,24}(?:股份有限公司|有限责任公司|有限公司|酒业集团|酒业有限公司|酒厂|集团))/g).slice(0, 6);
}

function detectProductNames(text) {
  const source = String(text || "");
  return uniqueList([
    ...regexMatches(source, /(窖藏\s*1988|窖藏\s*1998|窖藏\s*30|窖藏\s*15|境遇东方|境像东方|创立\s*70\s*年纪念酒|百亿纪念酒|崇礼|传统文化巡游纪念酒|君品习酒|君品|金质习酒|银质习酒|金钻习酒|习酒金钻|习酒银钻|红习酱|习酒窖藏|习酒|習酒|国色天香|国韵|祥康酒|习水窖藏|清香型白酒|酱香型白酒)/g),
    ...regexMatches(source, /(?:产品名|商品名称|品名)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9·\-]{2,18})/g)
  ]).slice(0, 8);
}

function buildStructuredEvidence({
  lead,
  ocrText,
  modelResult,
  combinedHaystack,
  productIdentity,
  confirmedSample,
  protectedVisualFactorMatch,
  thirdPartyMarks,
  effectiveAccusedMatches,
  combinedAuthenticMatches
}) {
  const modelText = modelEvidenceText(modelResult);
  const text = `${lead.title} ${lead.brandHint} ${lead.description} ${ocrText} ${modelText}`;
  const producerNames = detectProducerNames(text);
  const officialSignals = structuredSignalList([
    ...(modelResult?.officialSignals || []),
    ...(modelResult?.structuredVisualAssessment?.officialSignals || []),
    ...producerNames.filter((name) => /贵州习酒|习酒股份|习酒投资控股|贵州茅台酒厂.*习酒/.test(name)),
    ...(confirmedSample?.category === "authentic_product_confirmed" ? [confirmedSample.title] : []),
    ...regexMatches(text, /(官方旗舰店|官方商城|授权店|贵州习酒官网|权利人正品|正品)/g)
  ]);
  const thirdPartySignals = structuredSignalList([
    ...(modelResult?.thirdPartySignals || []),
    ...(modelResult?.structuredVisualAssessment?.thirdPartySignals || []),
    ...thirdPartyMarks,
    ...producerNames.filter((name) => !/贵州习酒|习酒股份|习酒投资控股|贵州茅台酒厂.*习酒/.test(name)),
    ...effectiveAccusedMatches.flatMap((item) => item.hits || [])
  ]);
  const vectorMatchType = confirmedSample?.matchType || "";
  const vectorMatchSide = confirmedSample?.expectedIdentity === "likely_authentic"
    ? "authentic"
    : confirmedSample?.expectedIdentity === "suspected_accused"
    ? "accused"
    : "";
  const protectedElements = uniqueList([
    ...protectedVisualFactorMatch,
    ...(modelResult?.protectedElementsMatched || []),
    ...(modelResult?.structuredVisualAssessment?.protectedElementsMatched || []),
    ...(modelResult?.matchedCourtFactors || []),
    ...matchedProtectedVisualFactors(combinedHaystack)
  ]);

  return {
    detectedBrand: uniqueList([...detectKnownBrand(text), modelResult?.detectedBrand]),
    detectedProductName: uniqueList([...detectProductNames(text), modelResult?.detectedProductName]),
    producerName: producerNames,
    visibleMarks: uniqueList([
      ...detectKnownBrand(text),
      ...(modelResult?.visibleMarks || []),
      ...regexMatches(text, /(11218168|9000971|27250465|6018549|12435314|窖藏\s*1988|君品|习酒|習酒)/g)
    ]),
    bottleShape: uniqueList([
      ...(modelResult?.bottleShape || []),
      ...matchedProtectedVisualFactors(text).filter((item) => /瓶|底座|瓶颈|环圈|线条/.test(item))
    ]),
    boxLayout: uniqueList([
      ...(modelResult?.boxLayout || []),
      ...matchedProtectedVisualFactors(text).filter((item) => /酒盒|包装|装潢/.test(item))
    ]),
    officialSignals,
    thirdPartySignals,
    protectedElementsMatched: protectedElements,
    imageVectorMatch: confirmedSample ? {
      side: vectorMatchSide,
      sampleId: confirmedSample.id,
      sampleTitle: confirmedSample.title,
      matchType: vectorMatchType,
      similarity: confirmedSample.similarity || null,
      category: confirmedSample.category || ""
    } : null,
    identityHint: productIdentity.type,
    evidenceStrength: confirmedSample
      ? "strong_sample_match"
      : protectedElements.length >= 3 && thirdPartySignals.length
      ? "structured_risk_match"
      : officialSignals.length && !thirdPartySignals.length
      ? "structured_authentic_match"
      : "insufficient_or_mixed",
    decisionHints: uniqueList([
      officialSignals.length && !thirdPartySignals.length ? "存在官方/正品信号且未见第三方主体，应优先正品保护" : "",
      thirdPartySignals.length && protectedElements.length >= 2 ? "存在第三方信号并命中受保护包装要素，应提高风险" : "",
      confirmedSample?.expectedRiskLevel === "高风险" ? "命中律师确认侵权图片样本" : "",
      confirmedSample?.expectedRiskLevel === "低风险" ? "命中正品图片样本" : ""
    ])
  };
}

function evaluateStructuredCriteria({
  structuredEvidence,
  combinedHaystack,
  sourceIsLawyerAccusedCase,
  lawyerKnowledge
}) {
  const criteria = lawyerKnowledge.structuredCriteria || [];
  const text = String(combinedHaystack || "");
  const protectedElements = structuredEvidence?.protectedElementsMatched || [];
  const thirdPartySignals = structuredEvidence?.thirdPartySignals || [];
  const officialSignals = structuredEvidence?.officialSignals || [];
  const imageVectorMatch = structuredEvidence?.imageVectorMatch;
  const matches = [];
  const add = (condition, evidence = []) => {
    const item = criteria.find((criterion) => criterion.condition === condition);
    if (!item) return;
    matches.push({
      id: item.id,
      type: item.type,
      label: item.label,
      score: Number(item.score || 0),
      legalMeaning: item.legalMeaning,
      evidence: uniqueList(evidence)
    });
  };

  if (officialSignals.length && !thirdPartySignals.length) {
    add("official_signals_without_third_party", officialSignals);
  }
  if (thirdPartySignals.length) {
    add("third_party_signals_present", thirdPartySignals);
  }
  if (protectedElements.length >= 4) {
    add("protected_elements_at_least_4", protectedElements);
  } else if (protectedElements.length >= 2) {
    add("protected_elements_at_least_2", protectedElements);
  }
  if (thirdPartySignals.length && protectedElements.length >= 2) {
    add("third_party_and_protected_elements", [...thirdPartySignals, ...protectedElements]);
  }
  for (const item of criteria.filter((criterion) => criterion.condition === "confusion_reasoning_terms")) {
    const hits = (item.patterns || []).filter((pattern) => includesLoose(text, pattern));
    if (hits.length) {
      matches.push({
        id: item.id,
        type: item.type,
        label: item.label,
        score: Number(item.score || 0),
        legalMeaning: item.legalMeaning,
        evidence: hits
      });
    }
  }
  if (sourceIsLawyerAccusedCase || imageVectorMatch?.side === "accused") {
    add("image_vector_accused_match", [
      imageVectorMatch?.sampleTitle,
      imageVectorMatch?.similarity ? `相似度 ${imageVectorMatch.similarity}%` : ""
    ]);
  }
  if (imageVectorMatch?.side === "authentic") {
    add("image_vector_authentic_match", [
      imageVectorMatch.sampleTitle,
      imageVectorMatch.similarity ? `相似度 ${imageVectorMatch.similarity}%` : ""
    ]);
  }

  const seen = new Set();
  return matches.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function evaluateDocumentStructuredRules({
  structuredEvidence,
  combinedHaystack,
  productIdentity,
  sourceIsLawyerAccusedCase,
  lawyerKnowledge
}) {
  const rules = lawyerKnowledge.documentStructuredRules || {};
  const text = String(combinedHaystack || "");
  const protectedElements = structuredEvidence?.protectedElementsMatched || [];
  const thirdPartySignals = structuredEvidence?.thirdPartySignals || [];
  const officialSignals = structuredEvidence?.officialSignals || [];
  const imageVectorMatch = structuredEvidence?.imageVectorMatch;
  const matches = [];

  const add = (item, evidence = [], extra = {}) => {
    if (!item) return;
    matches.push({
      id: item.id,
      type: item.type || item.category || "document_rule",
      label: item.label || item.name,
      score: Number(item.score || 0),
      legalMeaning: item.legalMeaning || item.legalRole || "",
      evidence: uniqueList(evidence),
      ...extra
    });
  };

  const elementMatches = (rules.protectedElements || [])
    .map((element) => {
      const aliasHits = (element.aliases || []).filter((alias) => includesLoose(text, alias));
      const structuredHits = protectedElements.filter((name) => {
        const source = normalizedText(name);
        return source.includes(normalizedText(element.name)) || (element.aliases || []).some((alias) => source.includes(normalizedText(alias)) || normalizedText(alias).includes(source));
      });
      const evidence = uniqueList([...aliasHits, ...structuredHits]);
      return evidence.length ? { ...element, evidence } : null;
    })
    .filter(Boolean);

  elementMatches.forEach((element) => {
    matches.push({
      id: element.id,
      type: element.category,
      label: element.name,
      score: element.strength === "core" ? 4 : 2,
      legalMeaning: element.legalRole,
      evidence: element.evidence,
      strength: element.strength,
      docFrequency: element.docFrequency
    });
  });

  for (const rule of rules.legalReasoningRules || []) {
    const hits = (rule.patterns || []).filter((pattern) => includesLoose(text, pattern));
    if (hits.length) add(rule, hits);
  }

  const coreElementMatches = elementMatches.filter((element) => element.strength === "core");
  const hasThirdParty = Boolean(thirdPartySignals.length || sourceIsLawyerAccusedCase || productIdentity.type === "suspected_accused");
  const hasOfficialOnly = officialSignals.length && !thirdPartySignals.length && productIdentity.type === "likely_authentic";
  const hasDifferenceTerms = ["颜色不同", "汉字不同", "色差", "略有不同", "细微差异", "不当然排除"].some((term) => includesLoose(text, term));

  if (sourceIsLawyerAccusedCase || imageVectorMatch?.side === "accused") {
    matches.push({
      id: "doc-sample-confirmed-accused",
      type: "document_sample",
      label: "律师文档确认侵权样本",
      score: 0,
      legalMeaning: "该图片来自律师 Word 中确认的侵权图片，或向量命中该文档中的确认侵权图片库。",
      evidence: uniqueList([
        imageVectorMatch?.sampleTitle,
        imageVectorMatch?.similarity ? `相似度 ${imageVectorMatch.similarity}%` : "",
        sourceIsLawyerAccusedCase ? "律师典型侵权产品图片及判决" : ""
      ])
    });
  }

  for (const combo of rules.evidenceCombinations || []) {
    if (combo.condition === "third_party_and_two_core_elements" && hasThirdParty && coreElementMatches.length >= 2) {
      add(combo, [...thirdPartySignals, ...coreElementMatches.map((item) => item.name)]);
    }
    if (combo.condition === "four_core_elements" && coreElementMatches.length >= 4) {
      add(combo, coreElementMatches.map((item) => item.name));
    }
    if (combo.condition === "differences_with_core_elements" && hasDifferenceTerms && coreElementMatches.length >= 2) {
      add(combo, coreElementMatches.map((item) => item.name));
    }
    if (combo.condition === "official_without_third_party" && hasOfficialOnly) {
      add(combo, officialSignals);
    }
  }

  const seen = new Set();
  return matches.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function calculateLawyerRiskScore({
  imageProvided,
  hasLink,
  hasDoor,
  hasUserContext,
  productIdentity,
  authenticMatches,
  accusedMatches,
  courtFactorMatches,
  protectedVisualFactorMatch,
  thirdPartyMarks,
  genericThirdPartyVisualRisk,
  modelOnlySuspiciousVisual,
  sourceIsLawyerAccusedCase,
  confirmedSample,
  structuredEvidence,
  structuredCriteriaMatches,
  documentRuleMatches,
  lawyerKnowledge
}) {
  const scoringRules = lawyerKnowledge.scoringRules || { rules: [], thresholds: { lowMax: 29, midMax: 74, highMin: 75 } };
  const strategy = judgementStrategy(lawyerKnowledge);
  const scoreItems = [];
  const add = (id, label, score, evidence = []) => {
    if (!score) return;
    scoreItems.push({ id, label, score, evidence: evidence.filter(Boolean) });
  };

  const courtFactorNames = [...new Set([
    ...courtFactorMatches.map((item) => item.name),
    ...protectedVisualFactorMatch
  ])];
  const hasRiskContext = hasUserContext || hasDoor || hasLink;
  const accusedEvidence = accusedMatches.flatMap((item) => item.hits || []);
  const authenticEvidence = authenticMatches.flatMap((item) => item.hits || []);
  const hasStructuredThirdParty = Boolean(structuredEvidence?.thirdPartySignals?.length);
  const authenticProtected = productIdentity.type === "likely_authentic"
    && !accusedMatches.length
    && !thirdPartyMarks.length
    && !genericThirdPartyVisualRisk
    && !hasStructuredThirdParty
    && !sourceIsLawyerAccusedCase;

  if (accusedMatches.length && !authenticProtected) {
    const strongest = Math.max(...accusedMatches.map((item) => Number(item.riskWeight || 0)), scoringRule(scoringRules, "score-accused-product", 50));
    add("score-accused-product", "命中律师资料被控产品名称", strongest, accusedEvidence);
  }

  if (productIdentity.type === "suspected_accused" && !accusedMatches.length && !sourceIsLawyerAccusedCase) {
    add("score-suspected-identity", "线索身份已进入疑似被控分支", 85, [productIdentity.reason]);
  }

  if (sourceIsLawyerAccusedCase) {
    add("score-lawyer-case-source", "样本来自律师资料中的被控产品案例", 75, ["律师资料：习酒典型侵权产品图片及判决"]);
  }

  if (confirmedSample?.expectedRiskLevel === "高风险") {
    const matchLabel = confirmedSample.matchType === "visual_similarity" ? "视觉相似命中律师确认高风险样本" : "命中确认的高风险样本";
    const matchScore = confirmedSample.matchType === "visual_similarity" ? strategy.confirmedAccusedVisualScore : strategy.confirmedAccusedScore;
    add("score-confirmed-sample", matchLabel, matchScore, [
      confirmedSample.title,
      confirmedSample.reason,
      confirmedSample.similarity ? `相似度 ${confirmedSample.similarity}%` : ""
    ]);
  }

  if (confirmedSample?.expectedRiskLevel === "低风险") {
    add("score-confirmed-authentic", "命中确认的低风险/正品样本", strategy.confirmedAuthenticScore, [
      confirmedSample.title,
      confirmedSample.reason,
      confirmedSample.similarity ? `相似度 ${confirmedSample.similarity}%` : ""
    ]);
  }

  if ((thirdPartyMarks.length || genericThirdPartyVisualRisk) && !authenticProtected) {
    add("score-third-party-mark", "命中第三方疑似侵权标识", scoringRule(scoringRules, "score-third-party-mark", 35), thirdPartyMarks);
  }

  if (structuredEvidence?.thirdPartySignals?.length && structuredEvidence?.protectedElementsMatched?.length >= 2 && !authenticProtected) {
    add("score-structured-third-party-protected", "结构化识别显示第三方主体/标识叠加受保护包装要素", 30, [
      ...structuredEvidence.thirdPartySignals,
      ...structuredEvidence.protectedElementsMatched
    ]);
  }

  if (courtFactorNames.length >= 4 && !authenticProtected) {
    add("score-court-factors-strong", "命中 4 个以上法院裁判外观要素", scoringRule(scoringRules, "score-court-factors-strong", 25), courtFactorNames);
  } else if (courtFactorNames.length >= 2 && !authenticProtected) {
    add("score-court-factors-mid", "命中 2-3 个法院裁判外观要素", scoringRule(scoringRules, "score-court-factors-mid", 15), courtFactorNames);
  }

  if (modelOnlySuspiciousVisual && productIdentity.type !== "likely_authentic" && !authenticProtected) {
    add("score-model-visual", "视觉模型提示高度近似律师裁判要素", 15, courtFactorNames);
  }

  if (hasRiskContext) {
    add("score-source-context", "存在销售链接、店铺、价格或线索说明", scoringRule(scoringRules, "score-source-context", 10), [
      hasLink ? "来源链接" : "",
      hasDoor ? "店铺/门头场景" : "",
      hasUserContext ? "线索说明" : ""
    ]);
  }

  const hasAccusedOrThirdParty = accusedMatches.length || thirdPartyMarks.length || genericThirdPartyVisualRisk || hasStructuredThirdParty;
  if (productIdentity.type === "likely_authentic" && !hasAccusedOrThirdParty) {
    add("score-authentic-protection", "明确识别为权利人正品，且未命中第三方被控标识", strategy.authenticProtectionScore, authenticEvidence);
  }

  if (structuredEvidence?.officialSignals?.length && !structuredEvidence?.thirdPartySignals?.length) {
    add("score-structured-authentic-signals", "结构化识别显示官方/正品信号，且未见第三方主体或被控标识", -35, structuredEvidence.officialSignals);
  }

  for (const criterion of structuredCriteriaMatches || []) {
    if (!criterion.score) continue;
    if (criterion.score > 0 && authenticProtected) continue;
    if (criterion.id === "criterion-third-party-protected-combo") continue;
    if (criterion.id === "criterion-official-authentic-exclusion") continue;
    add(`score-${criterion.id}`, `结构化标准：${criterion.label}`, criterion.score, criterion.evidence);
  }

  for (const docRule of documentRuleMatches || []) {
    if (!docRule.score) continue;
    if (docRule.score > 0 && authenticProtected) continue;
    if (/^doc-element-/.test(docRule.id)) continue;
    if (docRule.id === "doc-combo-third-party-core-elements" && structuredEvidence?.thirdPartySignals?.length && structuredEvidence?.protectedElementsMatched?.length >= 2) continue;
    if (docRule.id === "doc-combo-official-no-third-party") continue;
    add(`score-${docRule.id}`, `律师文档结构化规则：${docRule.label}`, docRule.score, docRule.evidence);
  }

  if (imageProvided && !hasRiskContext && !hasAccusedOrThirdParty) {
    add("score-image-only", "只有图片、缺少销售场景", scoringRule(scoringRules, "score-image-only", -10), ["未提供来源链接或可疑销售场景"]);
  }

  const rawScore = scoreItems.reduce((sum, item) => sum + item.score, 0);
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const thresholds = {
    ...(scoringRules.thresholds || { lowMax: 29, midMax: 74, highMin: 75 }),
    lowMax: strategy.lowRiskMax,
    highMin: strategy.highRiskThreshold
  };
  const riskLevel = score >= thresholds.highMin ? "高风险" : score > thresholds.lowMax ? "中风险" : "低风险";
  return {
    score,
    rawScore,
    riskLevel,
    scoreItems,
    courtFactorNames,
    hasAccusedOrThirdParty
  };
}

function buildEvidenceDecision({
  productIdentity,
  confirmedSample,
  structuredEvidence,
  structuredCriteriaMatches,
  documentRuleMatches,
  scoring,
  hasLink,
  hasDoor,
  hasUserContext,
  sourceIsLawyerAccusedCase,
  risk
}) {
  const highRiskEvidence = [];
  const lowRiskEvidence = [];
  const conflictPoints = [];
  const reviewFocus = [];
  const addHigh = (label, evidence = []) => highRiskEvidence.push({ label, evidence: uniqueList(evidence) });
  const addLow = (label, evidence = []) => lowRiskEvidence.push({ label, evidence: uniqueList(evidence) });
  const vector = structuredEvidence?.imageVectorMatch;
  const thirdParty = structuredEvidence?.thirdPartySignals || [];
  const official = structuredEvidence?.officialSignals || [];
  const protectedElements = structuredEvidence?.protectedElementsMatched || [];
  const positiveScoreItems = (scoring.scoreItems || []).filter((item) => item.score > 0);
  const negativeScoreItems = (scoring.scoreItems || []).filter((item) => item.score < 0);

  if (vector?.side === "accused") addHigh("命中律师确认侵权图库", [vector.sampleTitle, vector.similarity ? `相似度 ${vector.similarity}%` : ""]);
  if (vector?.side === "authentic") addLow("命中正品图库", [vector.sampleTitle, vector.similarity ? `相似度 ${vector.similarity}%` : ""]);
  if (confirmedSample?.expectedRiskLevel === "高风险") addHigh("确认样本标注为高风险", [confirmedSample.title, confirmedSample.reason]);
  if (confirmedSample?.expectedRiskLevel === "低风险") addLow("确认样本标注为低风险/正品", [confirmedSample.title, confirmedSample.reason]);
  if (sourceIsLawyerAccusedCase) addHigh("来源为律师典型侵权资料", ["律师 Word 典型侵权产品图片及判决"]);
  if (thirdParty.length) addHigh("识别到第三方主体或异常标识", thirdParty);
  if (official.length) addLow("识别到官方/正品/授权信号", official);
  if (protectedElements.length >= 2) addHigh("命中多个受保护包装要素", protectedElements);
  if (productIdentity.type === "likely_authentic") addLow("产品身份更接近权利人正品", [productIdentity.reason]);
  if (productIdentity.type === "suspected_accused") addHigh("产品身份进入疑似被控分支", [productIdentity.reason]);

  for (const item of [...structuredCriteriaMatches, ...documentRuleMatches]) {
    if (item.score > 0) addHigh(item.label, item.evidence);
    if (item.score < 0) addLow(item.label, item.evidence);
  }
  positiveScoreItems
    .filter((item) => item.id !== "score-source-context")
    .forEach((item) => addHigh(item.label, item.evidence));
  negativeScoreItems.forEach((item) => addLow(item.label, item.evidence));

  const hasStrongHigh = highRiskEvidence.some((item) => /侵权图库|确认样本|律师典型侵权|第三方主体|被控|受保护包装|第三方主体叠加/.test(item.label));
  const hasStrongLow = lowRiskEvidence.some((item) => /正品图库|低风险|官方|正品|授权|权利人正品/.test(item.label));
  if (hasStrongHigh && hasStrongLow) {
    conflictPoints.push("同时存在高风险证据和正品/排除证据，需要律师优先复核证据来源。");
  }
  if (vector?.side === "authentic" && thirdParty.length) {
    conflictPoints.push("图片命中正品图库，但同时识别到第三方主体或异常标识。");
  }
  if (vector?.side === "accused" && official.length) {
    conflictPoints.push("图片命中侵权图库，但同时出现官方/正品/授权信号。");
  }
  if (protectedElements.length >= 2 && !thirdParty.length && !sourceIsLawyerAccusedCase && productIdentity.type !== "suspected_accused") {
    conflictPoints.push("命中包装要素但缺少第三方主体，不能仅凭权利产品特征推定侵权。");
  }
  if (thirdParty.length && protectedElements.length < 2) {
    conflictPoints.push("存在第三方主体，但受保护包装要素不足，需要补充瓶身/酒盒清晰图。");
  }

  let decisionType = "needs_review";
  let decisionLabel = "人工复核";
  if (conflictPoints.length) {
    decisionType = "conflict_review";
    decisionLabel = "证据冲突待复核";
  } else if (hasStrongLow && !hasStrongHigh) {
    decisionType = "authentic_protected";
    decisionLabel = "正品保护/低风险";
  } else if (risk === "高风险" && hasStrongHigh) {
    decisionType = "high_risk";
    decisionLabel = "高风险取证";
  } else if (!hasLink && !hasDoor && !hasUserContext) {
    decisionType = "insufficient_context";
    decisionLabel = "材料不足待补证";
  } else if (risk === "中风险") {
    decisionType = "mid_risk_review";
    decisionLabel = "中风险复核";
  }

  if (!hasLink) reviewFocus.push("补充商品页、店铺页、POI 或来源链接。");
  if (thirdParty.length) reviewFocus.push("核对第三方主体、生产方、运营方、联合出品方及授权链条。");
  if (protectedElements.length) reviewFocus.push("复核受保护包装要素是否为同角度、同部位、整体近似。");
  if (official.length) reviewFocus.push("核对官方/正品/授权信号是否真实有效。");
  if (!protectedElements.length && !vector) reviewFocus.push("补充正面、背标、瓶盖、酒盒等清晰图片。");

  return {
    decisionType,
    decisionLabel,
    highRiskEvidence,
    lowRiskEvidence,
    conflictPoints,
    reviewFocus: uniqueList(reviewFocus),
    layers: [
      { name: "样本比对", result: vector ? `找到相似${vector.side === "authentic" ? "正品" : "高风险"}样本 ${vector.similarity || ""}%`.trim() : "未找到相似样本" },
      { name: "第三方主体", result: thirdParty.length ? thirdParty.join("、") : "未识别" },
      { name: "核心包装要素", result: protectedElements.length ? protectedElements.join("、") : "未识别" },
      { name: "正品排除信号", result: official.length ? official.join("、") : "未识别" },
      { name: "来源/销售证据", result: hasLink || hasDoor || hasUserContext ? "已提供部分来源或说明" : "缺少" }
    ]
  };
}

function modelEvidenceText(modelResult) {
  if (!modelResult) return "";
  const structured = modelResult.structuredVisualAssessment || {};
  const documentElements = structured.documentElements || {};
  return [
    modelResult.conclusion,
    modelResult.recommendedAction,
    modelResult.detectedBrand,
    modelResult.detectedProductName,
    modelResult.producerName,
    ...(modelResult.visibleMarks || []),
    ...(modelResult.officialSignals || []),
    ...(modelResult.thirdPartySignals || []),
    ...(modelResult.bottleShape || []),
    ...(modelResult.boxLayout || []),
    ...(modelResult.protectedElementsMatched || []),
    ...(modelResult.differencesFromAuthentic || []),
    ...(modelResult.differencesFromAccused || []),
    ...(structured.officialSignals || []),
    ...(structured.thirdPartySignals || []),
    ...(structured.differenceSignals || []),
    ...(structured.protectedElementsMatched || []),
    ...Object.entries(documentElements)
      .filter(([, value]) => value === true || value === "true")
      .map(([key]) => key),
    ...(modelResult.matchedRights || []),
    ...(modelResult.matchedCourtFactors || []),
    ...(modelResult.similarities || []),
    ...(modelResult.differences || []),
    ...(modelResult.evidenceGaps || []),
    ...(modelResult.caseBasis || []),
    ...(modelResult.reviewQuestions || [])
  ].filter(Boolean).join(" ");
}

function arrayValue(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (value === undefined || value === null || value === "") return [];
  return [String(value).trim()].filter(Boolean);
}

function stringValue(value) {
  if (Array.isArray(value)) return value.filter(Boolean).join("、");
  return String(value || "").trim();
}

function boolValue(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") return value > 0;
  const text = String(value || "").trim().toLowerCase();
  if (["true", "yes", "有", "是", "命中", "存在", "1"].includes(text)) return true;
  if (["false", "no", "无", "否", "未命中", "不存在", "0"].includes(text)) return false;
  return false;
}

function normalizeVisionResult(result) {
  if (!result) return null;
  const structured = result.structuredVisualAssessment || {};
  const documentElements = structured.documentElements || {};
  const normalizedDocumentElements = {
    roundBottleBody: boolValue(documentElements.roundBottleBody),
    trapezoidOrDrumBase: boolValue(documentElements.trapezoidOrDrumBase),
    longOrCylinderNeck: boolValue(documentElements.longOrCylinderNeck),
    multipleGoldRings: boolValue(documentElements.multipleGoldRings),
    raisedSideLines: boolValue(documentElements.raisedSideLines),
    boxTradeDressSimilarity: boolValue(documentElements.boxTradeDressSimilarity),
    frontMainLabelOrVerticalName: boolValue(documentElements.frontMainLabelOrVerticalName),
    colorCombinationSimilarity: boolValue(documentElements.colorCombinationSimilarity)
  };
  const elementLabels = [
    normalizedDocumentElements.roundBottleBody ? "圆形/圆鼓状瓶体" : "",
    normalizedDocumentElements.trapezoidOrDrumBase ? "梯形/鼓式底座" : "",
    normalizedDocumentElements.longOrCylinderNeck ? "细长瓶颈/圆柱形瓶颈" : "",
    normalizedDocumentElements.multipleGoldRings ? "多层金色环圈" : "",
    normalizedDocumentElements.raisedSideLines ? "两侧凸起装饰线条" : "",
    normalizedDocumentElements.boxTradeDressSimilarity ? "酒盒/包装装潢整体近似" : "",
    normalizedDocumentElements.frontMainLabelOrVerticalName ? "正面主标/竖向品名/圆形图案" : "",
    normalizedDocumentElements.colorCombinationSimilarity ? "颜色组合/色系近似" : ""
  ].filter(Boolean);
  const protectedElements = uniqueList([
    ...arrayValue(result.protectedElementsMatched),
    ...arrayValue(structured.protectedElementsMatched),
    ...elementLabels
  ]);
  const officialSignals = uniqueList([
    ...arrayValue(result.officialSignals),
    ...arrayValue(structured.officialSignals)
  ]);
  const thirdPartySignals = uniqueList([
    ...arrayValue(result.thirdPartySignals),
    ...arrayValue(structured.thirdPartySignals)
  ]);
  return {
    ...result,
    detectedBrand: stringValue(result.detectedBrand),
    detectedProductName: stringValue(result.detectedProductName),
    producerName: stringValue(result.producerName),
    visibleMarks: arrayValue(result.visibleMarks),
    officialSignals,
    thirdPartySignals,
    bottleShape: arrayValue(result.bottleShape),
    boxLayout: arrayValue(result.boxLayout),
    protectedElementsMatched: protectedElements,
    differencesFromAuthentic: arrayValue(result.differencesFromAuthentic),
    differencesFromAccused: arrayValue(result.differencesFromAccused),
    matchedRights: arrayValue(result.matchedRights),
    matchedCourtFactors: uniqueList([...arrayValue(result.matchedCourtFactors), ...protectedElements]),
    similarities: arrayValue(result.similarities),
    differences: arrayValue(result.differences),
    evidenceGaps: arrayValue(result.evidenceGaps),
    caseBasis: arrayValue(result.caseBasis),
    reviewQuestions: arrayValue(result.reviewQuestions),
    infringementProbability: clampPercent(result.infringementProbability, 0),
    visualSimilarity: clampPercent(result.visualSimilarity, 0),
    confidence: clampPercent(result.confidence, 0),
    structuredVisualAssessment: {
      documentElements: normalizedDocumentElements,
      officialSignals,
      thirdPartySignals,
      protectedElementsMatched: protectedElements,
      differenceSignals: arrayValue(structured.differenceSignals),
      extractionUncertainty: arrayValue(structured.extractionUncertainty)
    }
  };
}

function clampPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("model_json_missing");
    return JSON.parse(match[0]);
  }
}

function readableModelError(message) {
  const text = String(message || "");
  if (text.includes("AbortError") || text.includes("model_timeout")) return "模型响应超时，已用知识库规则兜底";
  if (text.includes("Arrearage")) return "视觉大模型不可用：模型账户欠费，已用知识库规则兜底";
  if (text.includes("DASHSCOPE_API_KEY")) return "视觉大模型未配置，已用知识库规则兜底";
  if (text.includes("ANTHROPIC_AUTH_TOKEN")) return "阿里云模型未配置，已用知识库规则兜底";
  if (text.includes("anthropic_model_failed")) return "阿里云模型调用失败，已用知识库规则兜底";
  if (text.includes("vision_model_failed")) return "视觉大模型调用失败，已用知识库规则兜底";
  if (text.includes("reasoning_model_failed")) return "推理模型调用失败，已用视觉模型和知识库结果";
  return "本地知识库规则兜底";
}

async function fetchWithTimeout(url, options = {}, timeoutMs = MODEL_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("model_timeout")), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function knowledgeForPrompt(db) {
  const rights = (db.rightBases || defaultRightBases())
    .map((item) => `- ${item.type}：${item.title}；关键词：${item.keywords.join("、")}`)
    .join("\n");
  const rules = (db.rules || defaultRules())
    .map((item) => `- ${item.title}：${item.text}`)
    .join("\n");
  const cases = (db.precedentCases || defaultPrecedentCases())
    .map((item) => `- ${item.title}：${item.points.join("、")}；判词要点：${item.holding}`)
    .join("\n");
  const docKnowledge = loadDocKnowledge();
  const docSection = docKnowledge ? formatDocKnowledge(docKnowledge) : "未生成。可运行 npm run ingest:docx 从律所 Word 资料抽取。";
  return `【权利基础库】\n${rights}\n\n【判词规则库】\n${rules}\n\n【典型案例库】\n${cases}\n\n【律所 Word 资料抽取知识库】\n${docSection}`;
}

function compactVisionKnowledge() {
  const lawyerKnowledge = loadLawyerKnowledge();
  const documentRules = lawyerKnowledge.documentStructuredRules || {};
  const elements = (documentRules.protectedElements || [])
    .map((item) => `- ${item.name}：${(item.aliases || []).slice(0, 4).join("、")}`)
    .join("\n");
  const reasoning = (documentRules.legalReasoningRules || [])
    .map((item) => `- ${item.label}：${(item.patterns || []).join("、")}`)
    .join("\n");
  return [
    "【律师文档结构化要素】",
    elements || "- 圆形瓶体、梯形底座、细长瓶颈、多层金色环圈、两侧凸起装饰线条、酒盒包装装潢",
    "【判词关注理由】",
    reasoning || "- 混淆、误认、特定联系、整体近似、颜色/文字差异不当然排除",
    "【抽取边界】",
    "- 只抽取图片中能看见或高度可见的事实字段。",
    "- 不能确认的字段填 false 或写入 extractionUncertainty。",
    "- 不要直接认定真假酒或构成侵权。"
  ].join("\n");
}

function loadDocKnowledge() {
  if (!existsSync(docKnowledgePath)) return null;
  try {
    return JSON.parse(readFileSync(docKnowledgePath, "utf8"));
  } catch {
    return null;
  }
}

function formatDocKnowledge(knowledge) {
  const rightBases = (knowledge.rightBases || []).slice(0, 20).join("、") || "未抽取";
  const visualFactors = (knowledge.visualFactors || []).slice(0, 20).join("、") || "未抽取";
  const rules = (knowledge.reusableRules || []).map((item) => `- ${item}`).join("\n") || "- 暂无";
  const reasons = (knowledge.courtReasons || []).slice(0, 12).map((item) => `- ${item}`).join("\n") || "- 暂无";
  return [
    `来源：${knowledge.source || "律所 Word 资料"}`,
    `资料规模：${knowledge.summary?.caseRowCount || 0} 条案例行，${knowledge.summary?.embeddedImageCount || 0} 张内嵌图片，${knowledge.summary?.ocrImageCount || 0} 张已 OCR。`,
    `抽取权利基础：${rightBases}`,
    `抽取视觉要素：${visualFactors}`,
    `可复用规则：\n${rules}`,
    `判词理由摘录：\n${reasons}`
  ].join("\n");
}

function docKnowledgeMatches(lead, knowledge) {
  if (!knowledge) return { rightBases: [], visualFactors: [], courtReasons: [] };
  const haystack = `${lead.title} ${lead.brandHint} ${lead.description} ${(lead.features || []).join(" ")}`.toLowerCase();
  const includesNeedle = (needle) => {
    const normalized = String(needle || "").toLowerCase();
    return normalized && (haystack.includes(normalized) || (normalized.includes("窖藏1988") && haystack.includes("1988")));
  };
  return {
    rightBases: (knowledge.rightBases || []).filter(includesNeedle).slice(0, 8),
    visualFactors: (knowledge.visualFactors || []).filter(includesNeedle).slice(0, 8),
    courtReasons: (knowledge.courtReasons || []).filter((item) => {
      const lower = item.toLowerCase();
      return ["混淆", "近似", "包装", "装潢", "瓶", "酒盒", "商标"].some((keyword) => haystack.includes(keyword) && lower.includes(keyword));
    }).slice(0, 6)
  };
}

function activeModelName() {
  if (process.env.USE_ANTHROPIC_VISION === "1" && process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    return `阿里云模型：${ANTHROPIC_MODEL}`;
  }
  return `视觉大模型：${VISION_MODEL}`;
}

function imageSourceFromDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mediaType: match[1], data: match[2] };
}

function imageBufferFromDataUrl(dataUrl) {
  const image = imageSourceFromDataUrl(dataUrl);
  if (!image) return null;
  return Buffer.from(image.data, "base64");
}

function imageHashFromDataUrl(dataUrl) {
  const imageBuffer = imageBufferFromDataUrl(dataUrl);
  if (!imageBuffer) return "";
  return createHash("sha256").update(imageBuffer).digest("hex");
}

function hammingDistance(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) distance += 1;
  }
  return distance;
}

async function imageVisualFingerprintFromBuffer(imageBuffer) {
  if (!imageBuffer) return null;
  try {
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
    return { averageHash, differenceHash };
  } catch {
    return null;
  }
}

function rankVisualSampleMatches(fingerprint, samples) {
  if (!fingerprint) return [];
  return (samples || [])
    .map((sample) => {
      const averageDistance = hammingDistance(fingerprint.averageHash, sample.visualFingerprint?.averageHash);
      const differenceDistance = hammingDistance(fingerprint.differenceHash, sample.visualFingerprint?.differenceHash);
      if (!Number.isFinite(averageDistance) || !Number.isFinite(differenceDistance)) return null;
      const combinedDistance = averageDistance * 0.45 + differenceDistance * 0.55;
      const similarity = Math.max(0, Math.round(100 - (combinedDistance / 64) * 100));
      return { ...sample, averageDistance, differenceDistance, similarity };
    })
    .filter(Boolean)
    .sort((left, right) => right.similarity - left.similarity);
}

function rankEmbeddingSampleMatches(embedding, samples) {
  if (!Array.isArray(embedding) || !embedding.length) return [];
  return (samples || [])
    .map((sample) => {
      const sampleEmbedding = sample.embedding?.vector;
      if (!Array.isArray(sampleEmbedding) || sampleEmbedding.length !== embedding.length) return null;
      const cosine = cosineSimilarity(embedding, sampleEmbedding);
      const similarity = similarityPercentFromCosine(cosine);
      return { ...sample, embeddingCosine: Number(cosine.toFixed(6)), similarity };
    })
    .filter(Boolean)
    .sort((left, right) => right.similarity - left.similarity);
}

function judgementStrategy(lawyerKnowledge = loadLawyerKnowledge()) {
  return {
    ...defaultJudgementStrategy,
    ...(lawyerKnowledge.judgementStrategy || {})
  };
}

async function matchConfirmedSample(lead, lawyerKnowledge = loadLawyerKnowledge()) {
  const strategy = judgementStrategy(lawyerKnowledge);
  const imageHash = imageHashFromDataUrl(lead.imageData);
  if (!imageHash) return null;

  const confirmedExact = (lawyerKnowledge.confirmedSamples || []).find((sample) => sample.imageSha256 === imageHash);
  if (confirmedExact) {
    return {
      ...confirmedExact,
      matchType: "exact_hash",
      similarity: 100,
      category: confirmedExact.expectedRiskLevel === "低风险" ? "authentic_confirmed" : "accused_confirmed"
    };
  }

  const imageSampleExact = (lawyerKnowledge.imageSamples || []).find((sample) => sample.imageSha256 === imageHash);
  if (imageSampleExact) {
    return {
      ...imageSampleExact,
      matchType: "exact_hash",
      similarity: 100
    };
  }

  if (process.env.USE_REMOTE_EMBEDDING !== "0") {
    try {
      const embeddingResult = await callDashscopeImageEmbedding(lead.imageData);
      const bestEmbeddingMatch = rankEmbeddingSampleMatches(embeddingResult?.embedding, lawyerKnowledge.imageSamples)[0];
      if (bestEmbeddingMatch?.similarity >= strategy.embeddingSimilarityThreshold) {
        return {
          ...bestEmbeddingMatch,
          matchType: "embedding_similarity",
          embeddingModel: embeddingResult.model,
          embeddingDimension: embeddingResult.dimension
        };
      }
    } catch (error) {
      lead.embeddingError = error.message || String(error);
    }
  }

  const fingerprint = await imageVisualFingerprintFromBuffer(imageBufferFromDataUrl(lead.imageData));
  const bestVisualMatch = rankVisualSampleMatches(fingerprint, lawyerKnowledge.imageSamples)[0];
  if (!bestVisualMatch) return null;

  const isStrongMatch = bestVisualMatch.similarity >= strategy.visualSimilarityThreshold
    && bestVisualMatch.averageDistance <= strategy.visualAverageDistanceMax
    && bestVisualMatch.differenceDistance <= strategy.visualDifferenceDistanceMax;
  if (!isStrongMatch) return null;
  return {
    ...bestVisualMatch,
    matchType: "visual_similarity"
  };
}

function anthropicMessagesUrl(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (!clean) return "";
  return clean.endsWith("/v1/messages") ? clean : `${clean}/v1/messages`;
}

async function callAnthropicModel(lead, db, prompt) {
  const apiKey = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  const image = imageSourceFromDataUrl(lead.imageData);
  if (!apiKey || !baseUrl || !image) return null;

  const response = await fetchWithTimeout(anthropicMessagesUrl(baseUrl), {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "authorization": `Bearer ${apiKey}`,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1600,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.data
              }
            }
          ]
        }
      ]
    })
  }, VISION_TIMEOUT_MS);
  if (!response.ok) throw new Error(`anthropic_model_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  const content = Array.isArray(data.content)
    ? data.content.map((item) => item.text || "").join("\n")
    : data.choices?.[0]?.message?.content;
  return normalizeVisionResult(extractJson(content));
}

async function callDashscopeVisionModel(lead, prompt) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !lead.imageData) return null;

  const response = await fetchWithTimeout("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: VISION_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: lead.imageData } }
          ]
        }
      ]
    })
  }, VISION_TIMEOUT_MS);
  if (!response.ok) throw new Error(`vision_model_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  return normalizeVisionResult(extractJson(data.choices?.[0]?.message?.content));
}

async function callDashscopeOcrModel(lead) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !lead.imageData) return "";

  const response = await fetchWithTimeout("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: OCR_MODEL,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请对图片做 OCR。若图片中包含酒瓶、酒盒、商标或门头，请同时列出可见文字、品牌词、产品名和可见包装视觉要素。只输出简洁中文。"
            },
            { type: "image_url", image_url: { url: lead.imageData } }
          ]
        }
      ]
    })
  }, OCR_TIMEOUT_MS);
  if (!response.ok) throw new Error(`ocr_model_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

async function callDashscopeReasoningModel(lead, db, draftSections) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || process.env.USE_REASONING_MODEL === "0") return null;

  const prompt = `
你是酒类知识产权线索复核助手。请基于“视觉/OCR 初筛草稿”和“律所知识库”做二次研判。

要求：
1. 只输出可展示给律师的结论和理由，不输出思考过程。
2. 不得断言已经构成侵权，只能使用“疑似、可能、建议复核”。
3. 必须同时考虑相似点、差异点、证据缺口，不能只放大相似点。
4. 优先引用律所资料中的判词视觉要素、权利基础和可复用规则。

线索：
- 标题：${lead.title}
- 疑似对象：${lead.brandHint || "未填写"}
- 来源：${lead.sourceType}
- 链接：${lead.sourceUrl || "未提供"}
- 备注：${lead.description || "无"}

视觉/OCR 初筛草稿：
${JSON.stringify(draftSections, null, 2)}

${compactVisionKnowledge()}

必须返回严格 JSON，不要 Markdown，不要解释，字段如下：
{
  "infringementProbability": 0-100,
  "visualSimilarity": 0-100,
  "confidence": 0-100,
  "riskLevel": "高风险|中风险|低风险|待确认",
  "conclusion": "一句话结论",
  "recommendedAction": "忽略|继续监控|人工复核|补充取证|重点取证|进入案件流程",
  "rightsBasis": ["权利基础"],
  "courtFactors": ["命中的判词视觉要素"],
  "similarities": ["具体相似点"],
  "differences": ["具体差异点或不确定点"],
  "evidenceGaps": ["证据缺口"],
  "suggestions": ["下一步建议"],
  "lawyerReviewQuestions": ["律师复核问题"]
}
`.trim();

  const response = await fetchWithTimeout("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: REASONING_MODEL,
      temperature: 0.1,
      enable_thinking: true,
      messages: [{ role: "user", content: prompt }]
    })
  }, Number(process.env.REASONING_TIMEOUT_MS || 30000));
  if (!response.ok) throw new Error(`reasoning_model_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  return extractJson(data.choices?.[0]?.message?.content);
}

async function callVisionModel(lead, db) {
  if (process.env.USE_REMOTE_MODEL === "0") return null;
  if (!lead.imageData) return null;

  const prompt = `
你是酒类知识产权线索初筛助手。请只基于上传图片、线索文字和知识库做“疑似风险研判”，不得输出已构成侵权或真假酒结论。

线索信息：
- 标题：${lead.title}
- 疑似对象：${lead.brandHint || "未填写"}
- 来源：${lead.sourceType}
- 链接：${lead.sourceUrl || "未提供"}
- 备注：${lead.description || "无"}

${knowledgeForPrompt(db)}

请对上传图片进行视觉识别，但不要直接替律师作最终裁判。你的任务是“结构化抽取”，本地律师规则会负责最终评分。

必须逐项检查律师 Word 文档中的 8 类要素：
1. 圆形/圆鼓状瓶体
2. 梯形/鼓式底座
3. 细长瓶颈/圆柱形瓶颈
4. 多层金色环圈
5. 两侧凸起装饰线条
6. 酒盒/包装装潢整体近似
7. 正面主标/竖向品名/圆形图案
8. 颜色组合/色系近似

同时必须抽取：
- 是否出现官方、正品、授权、官网、防伪等正品信号
- 是否出现第三方生产方、运营方、联合出品方、非权利人品牌、异常搭便车标识
- 是否存在颜色不同、文字不同、局部差异、拍摄模糊、遮挡等不确定点

必须返回严格 JSON，不要 Markdown，不要解释，字段如下：
{
  "detectedBrand": "识别到的品牌或空字符串",
  "detectedProductName": "识别到的产品名或空字符串",
  "producerName": "识别到的生产企业或空字符串",
  "visibleMarks": ["可见商标、标识、品牌词"],
  "officialSignals": ["官方主体、授权、正品、防伪等信号"],
  "thirdPartySignals": ["第三方主体、非权利人品牌、异常搭便车标识"],
  "bottleShape": ["瓶身、瓶颈、底座等形状要素"],
  "boxLayout": ["酒盒版式、颜色、图案、布局"],
  "protectedElementsMatched": ["可能命中的律师文档保护要素"],
  "differencesFromAuthentic": ["与正品/权利产品样式的差异"],
  "differencesFromAccused": ["与律师确认侵权样本的差异"],
  "structuredVisualAssessment": {
    "documentElements": {
      "roundBottleBody": true/false,
      "trapezoidOrDrumBase": true/false,
      "longOrCylinderNeck": true/false,
      "multipleGoldRings": true/false,
      "raisedSideLines": true/false,
      "boxTradeDressSimilarity": true/false,
      "frontMainLabelOrVerticalName": true/false,
      "colorCombinationSimilarity": true/false
    },
    "officialSignals": ["只填写图片中能支持正品/官方/授权的具体可见信号"],
    "thirdPartySignals": ["只填写图片中能支持第三方主体或异常标识的具体可见信号"],
    "protectedElementsMatched": ["从上述 8 类要素中命中的中文名称"],
    "differenceSignals": ["颜色不同、文字不同、包装版本差异、拍摄角度等差异或不确定点"],
    "extractionUncertainty": ["模糊、遮挡、角度、低清晰度等导致不能确认的字段"]
  },
  "infringementProbability": 0-100,
  "visualSimilarity": 0-100,
  "confidence": 0-100,
  "conclusion": "一句话结论，使用疑似/可能/建议复核，不得使用构成侵权",
  "recommendedAction": "忽略|继续监控|人工复核|补充取证|重点取证|进入案件流程",
  "matchedRights": ["匹配到的权利基础或商标号"],
  "matchedCourtFactors": ["命中的判词视觉要素"],
  "similarities": ["具体相似点"],
  "differences": ["具体差异点或不确定点"],
  "evidenceGaps": ["证据缺口"],
  "caseBasis": ["对应典型案例或判词依据"],
  "reviewQuestions": ["律师复核问题"]
}
`.trim();

  if (process.env.USE_ANTHROPIC_VISION === "1" && process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    return callAnthropicModel(lead, db, prompt);
  }
  return callDashscopeVisionModel(lead, prompt);
}

async function makeReport(lead, db) {
  const rules = db.rules || defaultRules();
  const rightBases = db.rightBases || defaultRightBases();
  const precedentCases = db.precedentCases || defaultPrecedentCases();
  const docKnowledge = loadDocKnowledge();
  const lawyerKnowledge = loadLawyerKnowledge();
  const confirmedSample = await matchConfirmedSample(lead, lawyerKnowledge);
  const strongSampleMatch = confirmedSample && ["exact_hash", "embedding_similarity", "visual_similarity"].includes(confirmedSample.matchType);
  const shouldUseRemoteModel = process.env.USE_REMOTE_MODEL !== "0"
    && (!strongSampleMatch || process.env.USE_REMOTE_MODEL_FOR_MATCHED_SAMPLES === "1");
  const ocrPromise = shouldUseRemoteModel ? callDashscopeOcrModel(lead).catch((error) => ({ error })) : Promise.resolve("");
  const modelPromise = shouldUseRemoteModel ? callVisionModel(lead, db).catch((error) => ({ error })) : Promise.resolve(null);
  const ocrValue = await ocrPromise;
  const ocrText = typeof ocrValue === "string" ? ocrValue : "";
  const ocrError = ocrValue?.error?.message || "";
  const userHaystack = `${lead.title} ${lead.brandHint} ${lead.description} ${(lead.features || []).join(" ")}`.toLowerCase();
  const haystack = `${userHaystack} ${ocrText}`.toLowerCase();
  const docMatches = docKnowledgeMatches({ ...lead, description: `${lead.description}\n${ocrText}` }, docKnowledge);
  const imageProvided = Boolean(lead.imageData);
  const hasUserContext = Boolean(lead.brandHint || lead.sourceUrl || lead.description);
  const hasTrademark = /商标|logo|标识|习酒|窖藏|1988|君品|11218168|9000971|27250465|6018549|12435314/.test(haystack);
  const hasPackage = /瓶|瓶型|瓶盖|酒盒|包装|装潢|标签|红色|金色|盒体|圆形|梯形|瓶颈|环圈|凸起|线条/.test(haystack);
  const hasDoor = /门头|招牌|店铺|门店/.test(haystack);
  const hasLink = Boolean(lead.sourceUrl);
  const sourceIsLawyerAccusedCase = /律师资料|典型侵权产品图片及判决|被控产品/.test(`${lead.title} ${lead.sourceUrl} ${lead.description}`);
  const initialProductIdentity = classifyProductIdentity(haystack, lawyerKnowledge);
  const suspiciousContext = hasUserContext || hasDoor || lead.sourceType === "街景/门头/POI";
  const weakEvidence = !imageProvided || lead.sourceType === "街景/门头/POI" || !suspiciousContext;
  const courtFactorCatalog = ["圆形瓶体", "梯形底座", "细长瓶颈", "多层金色环圈", "两侧凸起装饰线条", "酒盒包装装潢近似"];
  const knowledgeCourtFactorMatches = matchCourtFactorsFromKnowledge(haystack, lawyerKnowledge);
  const matchedCourtFactors = [
    ...courtFactorCatalog.filter((factor) => haystack.includes(factor.toLowerCase()) || (lead.features || []).includes(factor)),
    ...docMatches.visualFactors,
    ...knowledgeCourtFactorMatches.map((item) => item.name)
  ].filter((item, index, array) => array.indexOf(item) === index);
  const matchedRights = rightBases.filter((right) => right.keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))).slice(0, 6);
  const matchedCases = precedentCases.filter((item) => item.points.some((point) => haystack.includes(point.toLowerCase()) || matchedCourtFactors.includes(point))).slice(0, 3);

  const modelValue = await modelPromise;
  const modelResult = modelValue && !modelValue.error ? modelValue : null;
  const modelError = modelValue?.error?.message || ocrError || "";

  const modelText = modelEvidenceText(modelResult).toLowerCase();
  const combinedHaystack = `${haystack} ${modelText}`;
  const combinedAuthenticMatches = findTemplateMatches(lawyerKnowledge.authenticProducts, combinedHaystack);
  const directAccusedMatches = findTemplateMatches(lawyerKnowledge.accusedProducts, userHaystack);
  const rawCombinedAccusedMatches = findTemplateMatches(lawyerKnowledge.accusedProducts, combinedHaystack);
  let productIdentity = initialProductIdentity.type === "unknown" ? classifyProductIdentity(combinedHaystack, lawyerKnowledge) : initialProductIdentity;
  if (confirmedSample) {
    const matchedBy = confirmedSample.matchType === "embedding_similarity"
      ? `百炼向量相似命中律师样本（相似度 ${confirmedSample.similarity}%）`
      : confirmedSample.matchType === "visual_similarity"
      ? `视觉相似命中律师样本（相似度 ${confirmedSample.similarity}%）`
      : "精确命中确认样本";
    productIdentity = {
      type: confirmedSample.expectedIdentity,
      label: confirmedSample.expectedIdentity === "suspected_accused" ? "疑似被控侵权样式" : "更接近权利人正品/权利产品样式",
      reason: `${matchedBy}：${confirmedSample.reason}`,
      matches: [confirmedSample]
    };
  }
  if (sourceIsLawyerAccusedCase) {
    productIdentity = {
      type: "suspected_accused",
      label: "疑似被控侵权样式",
      reason: "样本来源于律师资料中的典型被控产品图片及判决，应按律师资料被控案例优先复核。",
      matches: []
    };
  }
  const modelVisualSimilarity = modelResult ? clampPercent(modelResult.visualSimilarity, 0) : 0;
  const modelCourtFactors = (modelResult?.matchedCourtFactors || []).filter(Boolean);
  const strongVisualCourtMatch = modelVisualSimilarity >= 70 || modelCourtFactors.length >= 3;
  const combinedCourtFactorMatches = [
    ...knowledgeCourtFactorMatches,
    ...matchCourtFactorsFromKnowledge(combinedHaystack, lawyerKnowledge)
  ].filter((item, index, array) => array.findIndex((other) => other.id === item.id) === index);
  const protectedVisualFactorMatch = [
    ...new Set([
      ...matchedProtectedVisualFactors(combinedHaystack),
      ...combinedCourtFactorMatches.map((item) => item.name),
      ...modelCourtFactors.filter((factor) => matchedProtectedVisualFactors(factor).length)
    ])
  ];
  const thirdPartyMarks = extractThirdPartyMarks(`${ocrText}\n${modelText}\n${lead.description || ""}`);
  const authenticNoDirectAccused = productIdentity.type === "likely_authentic" && !directAccusedMatches.length;
  const effectiveAccusedMatches = authenticNoDirectAccused ? [] : rawCombinedAccusedMatches;
  const effectiveThirdPartyMarks = authenticNoDirectAccused ? [] : thirdPartyMarks;
  const effectiveCourtFactorMatches = authenticNoDirectAccused ? [] : combinedCourtFactorMatches;
  const effectiveProtectedVisualFactorMatch = authenticNoDirectAccused ? [] : protectedVisualFactorMatch;
  const genericThirdPartyVisualRisk = productIdentity.type !== "likely_authentic"
    && effectiveThirdPartyMarks.length > 0
    && protectedVisualFactorMatch.length >= 3;
  const modelOnlySuspiciousVisual = imageProvided
    && productIdentity.type !== "likely_authentic"
    && (strongVisualCourtMatch || protectedVisualFactorMatch.length >= 3 || genericThirdPartyVisualRisk);
  const structuredEvidence = buildStructuredEvidence({
    lead,
    ocrText,
    modelResult,
    combinedHaystack,
    productIdentity,
    confirmedSample,
    protectedVisualFactorMatch: effectiveProtectedVisualFactorMatch,
    thirdPartyMarks: effectiveThirdPartyMarks,
    effectiveAccusedMatches,
    combinedAuthenticMatches
  });
  const structuredCriteriaMatches = evaluateStructuredCriteria({
    structuredEvidence,
    combinedHaystack,
    sourceIsLawyerAccusedCase,
    lawyerKnowledge
  });
  const documentRuleMatches = evaluateDocumentStructuredRules({
    structuredEvidence,
    combinedHaystack,
    productIdentity,
    sourceIsLawyerAccusedCase,
    lawyerKnowledge
  });

  const scoring = calculateLawyerRiskScore({
    imageProvided,
    hasLink,
    hasDoor,
    hasUserContext,
    productIdentity,
    authenticMatches: combinedAuthenticMatches,
    accusedMatches: effectiveAccusedMatches,
    courtFactorMatches: effectiveCourtFactorMatches,
    protectedVisualFactorMatch: effectiveProtectedVisualFactorMatch,
    thirdPartyMarks: effectiveThirdPartyMarks,
    genericThirdPartyVisualRisk,
    modelOnlySuspiciousVisual,
    sourceIsLawyerAccusedCase,
    confirmedSample,
    structuredEvidence,
    structuredCriteriaMatches,
    documentRuleMatches,
    lawyerKnowledge
  });

  const localProbability = clampPercent(scoring.score);
  const modelProbability = modelResult ? clampPercent(modelResult.infringementProbability, localProbability) : null;
  const infringementProbability = localProbability;
  const visualSimilarity = modelResult
    ? modelVisualSimilarity
    : clampPercent(Math.min(100, protectedVisualFactorMatch.length * 12));
  const confidence = lead.imageData ? 52 : 28;
  const risk = scoring.riskLevel;
  const matchedRules = rules.filter((rule) => {
    if (rule.id === "rule-1") return hasTrademark || matchedRights.some((right) => right.type === "注册商标");
    if (rule.id === "rule-2") return matchedCourtFactors.length >= 2;
    if (rule.id === "rule-3") return hasPackage || matchedRights.some((right) => right.type === "包装装潢");
    if (rule.id === "rule-4") return hasPackage && matchedCourtFactors.length >= 2;
    if (rule.id === "rule-5") return weakEvidence || hasDoor;
    return false;
  });

  const similar = [];
  if (ocrText) similar.push(`OCR 识别补充：${ocrText.slice(0, 140)}。`);
  similar.push(`产品身份判断：${productIdentity.label}。${productIdentity.reason}`);
  if (modelOnlySuspiciousVisual) {
    similar.push(`图片视觉要素高度命中律师文档中的被控产品判断标准：${protectedVisualFactorMatch.join("、") || "视觉相似度高"}。`);
  }
  if (genericThirdPartyVisualRisk) {
    similar.push(`识别到第三方标识（${effectiveThirdPartyMarks.join("、")}）同时命中多个受保护视觉要素，应按疑似被控样式优先复核。`);
  }
  scoring.scoreItems.forEach((item) => {
    if (item.score > 0) similar.push(`律师规则加分：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
  });
  if (!suspiciousContext && productIdentity.type !== "suspected_accused") similar.push("当前仅识别到图片内容，缺少销售链接、疑似对象、来源场景或人工描述，不能仅凭单张图片推定侵权或假冒。");
  if (hasTrademark) similar.push("线索描述或 OCR 结果中出现疑似品牌、商标、Logo 或近似标识，需要与权利商标进一步比对。");
  if (hasPackage) similar.push("线索涉及瓶型、酒盒、标签、色彩或包装装潢等元素，可能存在组合相似点。");
  matchedCourtFactors.forEach((factor) => similar.push(`命中法院判词相似要素：${factor}。`));
  docMatches.courtReasons.forEach((reason) => similar.push(`律所资料判词理由：${reason}。`));
  if (hasDoor) similar.push("门头或店铺文字可能与酒类品牌经营标识形成关联，需要核对实际经营主体和授权情况。");
  if (modelResult?.similarities?.length) modelResult.similarities.forEach((item) => similar.push(`视觉模型辅助提示：${item}`));
  if (!similar.length) similar.push("当前材料未呈现清晰的核心商标或包装装潢相似点。");

  const differences = [];
  differences.push("当前已接入正品样本和高风险样本；未找到相似样本或证据冲突时，仍需要补充正面、背标、酒盒和来源场景做人工复核。");
  if (productIdentity.type === "likely_authentic") differences.push("图片识别结果更接近权利产品自身，当前未发现第三方被控名称或搭便车标识。");
  if (structuredEvidence.officialSignals.length && !structuredEvidence.thirdPartySignals.length) differences.push(`结构化正品信号：${structuredEvidence.officialSignals.join("、")}。`);
  if (structuredEvidence.thirdPartySignals.length) differences.push(`结构化第三方/异常信号：${structuredEvidence.thirdPartySignals.join("、")}。`);
  structuredCriteriaMatches.forEach((item) => {
    if (item.score > 0) similar.push(`结构化标准命中：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
    if (item.score < 0) differences.push(`结构化标准排除：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
  });
  documentRuleMatches.forEach((item) => {
    if (item.score > 0) similar.push(`律师文档结构化命中：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
    if (item.score < 0) differences.push(`律师文档结构化排除：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
  });
  scoring.scoreItems.forEach((item) => {
    if (item.score < 0) differences.push(`律师规则扣分：${item.label}${item.evidence.length ? `（${item.evidence.join("、")}）` : ""}。`);
  });
  if (!suspiciousContext) differences.push("单张图片若为权利人正品图，命中权利对象特征本身不是侵权风险，应重点查是否存在第三方来源或仿冒标识。");
  if (!imageProvided) differences.push("未上传图片，无法比对瓶身、酒盒、标签和门头视觉细节。");
  if (!lead.brandHint) differences.push("未填写疑似关联品牌，权利基础匹配不充分。");
  if (modelResult?.differences?.length) modelResult.differences.forEach((item) => differences.push(`视觉模型辅助提示：${item}`));

  const evidenceGaps = [];
  if (!imageProvided) evidenceGaps.push("缺少清晰图片，建议补充正面、侧面、瓶盖、酒盒和门头照片。");
  if (!suspiciousContext && productIdentity.type !== "suspected_accused") evidenceGaps.push("缺少可疑销售场景、被控对象说明、来源链接或与正品不同之处。");
  if (!hasLink) evidenceGaps.push("缺少商品页、店铺页、POI 或来源链接。");
  if (!structuredEvidence.imageVectorMatch) evidenceGaps.push("暂未找到相似的正品或高风险样本，需要补充更多样本或人工复核。");
  evidenceGaps.push("缺少对应商标注册信息、包装装潢知名度材料或历史案例引用。");
  if (modelResult?.evidenceGaps?.length) modelResult.evidenceGaps.forEach((item) => evidenceGaps.push(`视觉模型辅助提示：${item}`));

  const localRightsBasis = matchedRights.length || docMatches.rightBases.length || effectiveAccusedMatches.length ? [
    ...matchedRights.map((right) => `${right.type}：${right.title}`),
    ...docMatches.rightBases.map((right) => `律所资料：${right}`),
    ...effectiveAccusedMatches.flatMap((item) => item.rightBases || []).map((right) => `被控模板关联权利基础：${right}`)
  ] : [
    hasTrademark ? "可能涉及注册商标专用权或商标近似使用风险。" : "暂未发现明确商标权利基础线索。",
    hasPackage ? "可能涉及有一定影响的商品包装装潢或反不正当竞争法相关权益。" : "包装装潢权利基础尚不明确。"
  ];
  const rightsBasis = [
    ...localRightsBasis,
    ...(modelResult?.matchedRights || []).map((item) => `图片识别提示，需复核：${item}`)
  ];
  const courtFactors = [
    ...((matchedCourtFactors.length || scoring.courtFactorNames.length) ? [...new Set([...matchedCourtFactors, ...scoring.courtFactorNames])] : ["暂未发现明确律师关注要素"]),
    ...(modelResult?.matchedCourtFactors || []).map((item) => `图片识别提示，需复核：${item}`)
  ];
  const evidenceDecision = buildEvidenceDecision({
    productIdentity,
    confirmedSample,
    structuredEvidence,
    structuredCriteriaMatches,
    documentRuleMatches,
    scoring,
    hasLink,
    hasDoor,
    hasUserContext,
    sourceIsLawyerAccusedCase,
    risk
  });
  const actionByDecision = {
    conflict_review: "人工复核",
    authentic_protected: "继续监控",
    high_risk: "重点取证",
    insufficient_context: "补充取证",
    mid_risk_review: "补充取证",
    needs_review: "人工复核"
  };
  const conclusionByDecision = {
    conflict_review: `当前证据存在冲突：${evidenceDecision.conflictPoints.join("；")} 线索风险评分 ${infringementProbability}%，建议先由律师复核冲突证据。`,
    authentic_protected: `图片内容更接近权利人正品/权利产品样式，且未见有效第三方被控证据，暂按低风险或正品保护处理；线索风险评分 ${infringementProbability}%。`,
    high_risk: `高风险证据较集中，已命中律师结构化规则或确认样本，线索风险评分 ${infringementProbability}%，建议重点取证。`,
    insufficient_context: `当前材料不足，缺少来源、销售场景或关键主体信息；线索风险评分 ${infringementProbability}%，建议先补证再判断。`,
    mid_risk_review: `当前存在部分风险要素，但证据链尚不完整；线索风险评分 ${infringementProbability}%，建议补充取证并人工复核。`,
    needs_review: `基于律师知识库规则和已命中要素，线索风险评分 ${infringementProbability}%，建议人工复核。`
  };

  const sections = {
    basicInfo: {
      title: lead.title,
      sourceType: lead.sourceType,
      sourceUrl: lead.sourceUrl || "未提供",
      aiBoundary: "本报告仅作疑似线索初筛，不构成侵权认定或真假酒判断。"
    },
    relatedObject: lead.brandHint ? `疑似关联对象：${lead.brandHint}，建议律师核对权利主体和授权链条。` : "信息不足，暂无法明确疑似关联对象。",
    productIdentity,
    modelUsed: modelResult ? `律师知识库规则优先 + ${activeModelName()}辅助识别` : (modelError ? readableModelError(modelError) : "律师知识库规则优先"),
    modelError,
    modelProbability,
    modelStructuredVisualAssessment: modelResult?.structuredVisualAssessment || null,
    structuredEvidence,
    structuredCriteriaMatches,
    documentRuleMatches,
    evidenceDecision,
    imageSampleMatch: confirmedSample ? {
      id: confirmedSample.id,
      title: confirmedSample.title,
      category: confirmedSample.category || "",
      matchType: confirmedSample.matchType,
      similarity: confirmedSample.similarity,
      embeddingCosine: confirmedSample.embeddingCosine,
      embeddingModel: confirmedSample.embeddingModel,
      embeddingDimension: confirmedSample.embeddingDimension,
      labelSource: confirmedSample.labelSource || "",
      expectedRiskLevel: confirmedSample.expectedRiskLevel,
      expectedIdentity: confirmedSample.expectedIdentity
    } : null,
    infringementProbability,
    riskScoring: {
      method: "律师文件结构化规则评分",
      score: infringementProbability,
      rawScore: scoring.rawScore,
      items: scoring.scoreItems,
      thresholds: lawyerKnowledge.scoringRules?.thresholds || { lowMax: 29, midMax: 74, highMin: 75 }
    },
    visualSimilarity,
    confidence,
    conclusion: conclusionByDecision[evidenceDecision.decisionType] || (productIdentity.type === "likely_authentic"
      ? `图片内容更接近权利人正品/权利产品样式，当前未识别到第三方被控标识或可疑销售场景，暂不作为高风险线索处理；线索风险评分 ${infringementProbability}%。`
      : modelOnlySuspiciousVisual
      ? `图片视觉要素高度符合律师文档中的高风险判断标准，线索风险评分 ${infringementProbability}%，建议按${risk}线索处理。`
      : productIdentity.type === "suspected_accused"
      ? `识别到文档中出现过的被控或高风险标识，并结合包装/商标要素判断，线索风险评分 ${infringementProbability}%，建议按${risk}线索处理。`
      : !suspiciousContext
      ? `当前仅为单张图片内容识别，尚未识别明确正品或高风险样式；线索风险评分 ${infringementProbability}%，建议先补充材料。`
      : `基于律师知识库规则和已识别要素，线索风险评分 ${infringementProbability}%，建议按${risk}线索处理。`),
    recommendedAction: actionByDecision[evidenceDecision.decisionType] || (productIdentity.type === "likely_authentic" ? "继续监控" : risk === "高风险" ? "重点取证" : risk === "中风险" ? "补充取证" : "人工复核"),
    rightsBasis,
    courtFactors,
    caseBasis: matchedCases.length
      ? matchedCases
      : modelResult?.caseBasis?.length
      ? modelResult.caseBasis.map((title, index) => ({ id: `model-case-${index}`, title, image: matchedCases[index]?.image || "/case-images/xijiu-case-1.png", holding: title }))
      : [],
    similarities: similar,
    differences,
    riskLevel: risk,
    evidenceGaps,
    suggestions: [
      ...evidenceDecision.reviewFocus,
      "建议律师人工复核线索来源、图片清晰度和疑似关联品牌。",
      "建议补充正品图、权利证书、授权链条和历史处理记录。",
      risk === "高风险" ? "建议重点复核并评估是否安排线下取证。" : "建议先补充材料后再判断是否进入案件流程。",
      "不得基于本报告自动发函或自动提交平台投诉。"
    ],
    lawyerReviewQuestions: [
      "疑似标识是否落入有效商标权利范围？",
      "相似包装装潢是否具备可保护的识别性和影响力？",
      ...evidenceDecision.conflictPoints.map((item) => `冲突复核：${item}`),
      "现有图片是否足以支撑进一步取证或仅能作为线索？",
      "经营主体、销售链接和商品来源是否可被固定？",
      ...(modelResult?.reviewQuestions || []).map((item) => `视觉模型建议复核：${item}`)
    ],
    matchedRules
  };

  try {
    const shouldRunReasoning = Boolean(modelResult) && process.env.USE_REASONING_MODEL === "1";
    const reasoningResult = shouldRunReasoning ? await callDashscopeReasoningModel(lead, db, sections) : null;
    if (reasoningResult) {
      if (reasoningResult.visualSimilarity !== undefined) {
        sections.visualSimilarity = clampPercent(reasoningResult.visualSimilarity, sections.visualSimilarity);
      }
      if (reasoningResult.confidence !== undefined) {
        sections.confidence = clampPercent(reasoningResult.confidence, sections.confidence);
      }
      for (const key of ["rightsBasis", "courtFactors", "similarities", "differences", "evidenceGaps", "suggestions", "lawyerReviewQuestions"]) {
        if (Array.isArray(reasoningResult[key]) && reasoningResult[key].length) {
          sections[key] = [
            ...sections[key],
            ...reasoningResult[key].map((item) => `推理模型辅助整理：${item}`)
          ];
        }
      }
      sections.modelUsed = `${sections.modelUsed} + 推理模型：${REASONING_MODEL}`;
    }
  } catch (error) {
    sections.reasoningError = error.message || "reasoning_model_failed";
  }

  return {
    generatedAt: new Date().toISOString(),
    sections
  };
}

async function routeApi(req, res, pathname) {
  const db = await readDb();
  if (req.method === "GET" && pathname === "/api/leads") {
    json(res, 200, db.leads.map(publicLead));
    return;
  }
  if (req.method === "GET" && pathname === "/api/rules") {
    json(res, 200, db.rules);
    return;
  }
  if (req.method === "GET" && pathname === "/api/standards") {
    json(res, 200, { rules: db.rules, rightBases: db.rightBases, precedentCases: db.precedentCases });
    return;
  }
  if (req.method === "POST" && pathname === "/api/leads") {
    const lead = normalizeLead(await parseBody(req));
    db.leads.unshift(lead);
    await writeDb(db);
    json(res, 201, lead);
    return;
  }
  const analyzeMatch = pathname.match(/^\/api\/leads\/([^/]+)\/analyze$/);
  if (req.method === "POST" && analyzeMatch) {
    const lead = db.leads.find((item) => item.id === analyzeMatch[1]);
    if (!lead) return json(res, 404, { error: "lead_not_found" });
    lead.report = await makeReport(lead, db);
    lead.status = "已生成初筛报告";
    await writeDb(db);
    json(res, 200, publicLead(lead));
    return;
  }
  const feedbackMatch = pathname.match(/^\/api\/leads\/([^/]+)\/feedback$/);
  if (req.method === "POST" && feedbackMatch) {
    const lead = db.leads.find((item) => item.id === feedbackMatch[1]);
    if (!lead) return json(res, 404, { error: "lead_not_found" });
    const body = await parseBody(req);
    lead.feedback.unshift({
      id: `feedback-${Date.now()}`,
      rating: body.rating || "需要补证",
      note: String(body.note || "").trim(),
      createdAt: new Date().toISOString()
    });
    await writeDb(db);
    json(res, 200, publicLead(lead));
    return;
  }
  json(res, 404, { error: "not_found" });
}

export async function listLeads() {
  const db = await readDb();
  return db.leads.map(publicLead);
}

export async function getLead(id) {
  const db = await readDb();
  return db.leads.find((item) => item.id === id) || null;
}

export async function listRules() {
  const db = await readDb();
  return db.rules;
}

export async function listStandards() {
  const db = await readDb();
  return { rules: db.rules, rightBases: db.rightBases, precedentCases: db.precedentCases };
}

export async function createLead(input) {
  const db = await readDb();
  const lead = normalizeLead(input);
  db.leads.unshift(lead);
  await writeDb(db);
  return lead;
}

export async function analyzeLead(id) {
  const db = await readDb();
  const lead = db.leads.find((item) => item.id === id);
  if (!lead) return null;
  lead.report = await makeReport(lead, db);
  lead.status = "已生成初筛报告";
  await writeDb(db);
  return publicLead(lead);
}

export async function addFeedback(id, input) {
  const db = await readDb();
  const lead = db.leads.find((item) => item.id === id);
  if (!lead) return null;
  lead.feedback.unshift({
    id: `feedback-${Date.now()}`,
    rating: input.rating || "需要补证",
    note: String(input.note || "").trim(),
    createdAt: new Date().toISOString()
  });
  await writeDb(db);
  return publicLead(lead);
}

async function serveStatic(res, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, cleanPath));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "forbidden" });
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "content-type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(content);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

await ensureDb();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await routeApi(req, res, url.pathname);
        return;
      }
      await serveStatic(res, url.pathname);
    } catch (error) {
      console.error(error);
      json(res, 500, { error: "internal_error" });
    }
  }).listen(PORT, HOST, () => {
    console.log(`Liquor IP demo running at http://${HOST}:${PORT}`);
  });
}
