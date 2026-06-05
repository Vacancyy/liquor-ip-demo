import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "data", "extracted", "ocr", "xijiu-doc-knowledge.json");
const outputPath = path.join(rootDir, "data", "knowledge", "document-structured-rules.json");

function uniqueList(items) {
  return [...new Set((items || []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function countHits(text, patterns) {
  return patterns.reduce((sum, pattern) => sum + ((text.match(pattern) || []).length), 0);
}

function sentenceMatches(text, patterns, limit = 8) {
  return uniqueList(
    String(text || "")
      .split(/[。；;\n]/)
      .map((item) => item.trim())
      .filter((item) => item.length >= 8 && patterns.some((pattern) => pattern.test(item)))
  ).slice(0, limit);
}

function buildElement({ id, name, category, aliases, legalRole, strength }, allText) {
  return {
    id,
    name,
    category,
    aliases,
    legalRole,
    strength,
    docFrequency: countHits(allText, aliases.map((item) => new RegExp(item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")))
  };
}

const knowledge = JSON.parse(await readFile(sourcePath, "utf8"));
const rows = [...(knowledge.caseRows || []), ...(knowledge.ocrRows || [])];
const allText = [
  ...(knowledge.courtReasons || []),
  ...(knowledge.reusableRules || []),
  ...rows.map((row) => row.rawText || "")
].join("\n");

const protectedElements = [
  buildElement({
    id: "doc-element-round-bottle",
    name: "圆形/圆鼓状瓶体",
    category: "bottle_shape",
    aliases: ["圆形瓶体", "圆鼓状", "圆形酒瓶", "瓶体圆形", "圆圈形瓶"],
    legalRole: "立体商标和包装装潢整体近似的核心识别要素。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-trapezoid-base",
    name: "梯形/鼓式底座",
    category: "bottle_shape",
    aliases: ["梯形底座", "底座形状", "鼓式底座", "鼓架式底座", "瓶底"],
    legalRole: "与瓶体、瓶颈共同构成立体形状近似。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-long-neck",
    name: "细长瓶颈/圆柱形瓶颈",
    category: "bottle_shape",
    aliases: ["细长瓶颈", "细长型", "圆柱形瓶颈", "瓶颈部分", "瓶颈"],
    legalRole: "用于判断整体瓶型结构是否接近。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-gold-rings",
    name: "多层金色环圈",
    category: "decoration",
    aliases: ["多层金色环圈", "金色环圈", "多层黄色细螺纹", "金黄色环绕", "金色装饰"],
    legalRole: "瓶颈/瓶身装饰细节，律师资料多次作为近似判断要素。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-raised-lines",
    name: "两侧凸起装饰线条",
    category: "decoration",
    aliases: ["凸起状装饰线条", "两侧凸起", "左右两侧", "凸起部分", "装饰线条"],
    legalRole: "判词中反复出现的装饰近似要素，颜色或文字不同也可能不排除。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-box-trade-dress",
    name: "酒盒/包装装潢整体近似",
    category: "box_layout",
    aliases: ["酒盒", "包装装潢", "商品包装", "整体结构", "整体布局", "图形构图", "视觉效果"],
    legalRole: "反不正当竞争法下有一定影响包装装潢的主要判断对象。",
    strength: "core"
  }, allText),
  buildElement({
    id: "doc-element-main-label",
    name: "正面主标/竖向品名/圆形图案",
    category: "label_layout",
    aliases: ["正面汉字", "竖向品名", "圆形图案", "瓶贴", "主要文字", "中部圆形装饰"],
    legalRole: "用于整体比对和主要部分比对，不能孤立替代整体结构判断。",
    strength: "supporting"
  }, allText),
  buildElement({
    id: "doc-element-color-combination",
    name: "颜色组合/色系近似",
    category: "color",
    aliases: ["颜色组合", "整体色系", "瓶身颜色", "色差", "颜色高度近似"],
    legalRole: "颜色差异或近似均需结合整体结构判断。",
    strength: "supporting"
  }, allText)
];

const legalReasoningRules = [
  {
    id: "doc-rule-confusion-source",
    label: "混淆、误认或特定联系",
    type: "confusion",
    patterns: ["混淆", "误认", "特定联系", "关联"],
    score: 12,
    legalMeaning: "判词反复以相关公众混淆、误认或认为与权利人存在特定联系作为近似判断结果。",
    examples: sentenceMatches(allText, [/混淆|误认|特定联系|关联/], 6)
  },
  {
    id: "doc-rule-overall-comparison",
    label: "整体比对 + 主要部分比对",
    type: "comparison_method",
    patterns: ["整体造型", "整体结构", "整体视觉效果", "主要部分", "隔离状态"],
    score: 10,
    legalMeaning: "不能只看单个文字或颜色，应结合整体结构、主要部分和一般消费者注意力判断。",
    examples: sentenceMatches(allText, [/整体造型|整体结构|整体视觉|主要部分|隔离/], 6)
  },
  {
    id: "doc-rule-differences-not-exclusion",
    label: "颜色/文字差异不当然排除",
    type: "difference_not_exclusion",
    patterns: ["颜色不同", "汉字不同", "色差", "略有不同", "细微差异", "不当然排除"],
    score: 10,
    legalMeaning: "瓶身颜色、正面汉字、局部文字不同，不当然排除整体近似或混淆风险。",
    examples: sentenceMatches(allText, [/颜色.*不同|汉字.*不同|色差|略有不同|细微差异/], 6)
  },
  {
    id: "doc-rule-famous-trade-dress",
    label: "有一定影响包装装潢/知名度",
    type: "trade_dress_fame",
    patterns: ["有一定影响", "知名", "长期使用", "广泛宣传", "显著性"],
    score: 10,
    legalMeaning: "律师资料强调窖藏1988等产品经长期使用宣传形成有一定影响的包装装潢和显著性。",
    examples: sentenceMatches(allText, [/有一定影响|知名|长期使用|广泛宣传|显著性/], 6)
  },
  {
    id: "doc-rule-third-party-producer",
    label: "第三方生产/销售主体",
    type: "source_subject",
    patterns: ["生产", "销售", "联合出品", "运营", "生产者", "销售者", "未经许可"],
    score: 12,
    legalMeaning: "出现第三方生产、销售、运营或未经许可使用时，才更接近侵权线索而非正品样式本身。",
    examples: sentenceMatches(allText, [/生产|销售|联合出品|运营|生产者|销售者|未经许可/], 6)
  },
  {
    id: "doc-rule-same-goods-liquor",
    label: "同类白酒商品",
    type: "goods_similarity",
    patterns: ["白酒", "同一种商品", "同类产品", "类似商品"],
    score: 8,
    legalMeaning: "被控对象同为白酒或类似商品时，商标/包装装潢近似的混淆风险更高。",
    examples: sentenceMatches(allText, [/白酒|同一种商品|同类产品|类似商品/], 6)
  }
];

const evidenceCombinations = [
  {
    id: "doc-combo-third-party-core-elements",
    label: "第三方主体 + 2 个以上核心包装要素",
    condition: "third_party_and_two_core_elements",
    score: 32,
    riskBand: "high",
    legalMeaning: "第三方主体或被控标识与核心瓶型/包装装潢组合同时出现，是律师资料中最稳定的高风险组合。"
  },
  {
    id: "doc-combo-four-core-elements",
    label: "4 个以上核心包装要素",
    condition: "four_core_elements",
    score: 24,
    riskBand: "high",
    legalMeaning: "圆形瓶体、梯形底座、细长瓶颈、金色环圈、凸起线条、酒盒装潢等核心要素高度集中时，整体近似风险显著。"
  },
  {
    id: "doc-combo-difference-still-risk",
    label: "存在局部差异但核心结构近似",
    condition: "differences_with_core_elements",
    score: 16,
    riskBand: "mid_high",
    legalMeaning: "即使颜色、正面汉字或局部文字不同，只要核心结构组合接近，仍需要提高复核等级。"
  },
  {
    id: "doc-combo-official-no-third-party",
    label: "官方/正品信号且无第三方主体",
    condition: "official_without_third_party",
    score: -35,
    riskBand: "low",
    legalMeaning: "正品、官网或授权渠道信号明确，且无第三方主体时，应优先排除高风险误判。"
  }
];

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: knowledge.source || "data/extracted/ocr/xijiu-doc-knowledge.json",
  sourceSummary: knowledge.summary || {},
  protectedElements,
  legalReasoningRules,
  evidenceCombinations,
  extractedStats: {
    protectedElementCount: protectedElements.length,
    legalReasoningRuleCount: legalReasoningRules.length,
    evidenceCombinationCount: evidenceCombinations.length,
    courtReasonCount: (knowledge.courtReasons || []).length,
    ocrRowCount: (knowledge.ocrRows || []).length
  }
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
console.log(`Protected elements: ${protectedElements.length}`);
console.log(`Legal rules: ${legalReasoningRules.length}`);
console.log(`Evidence combinations: ${evidenceCombinations.length}`);
