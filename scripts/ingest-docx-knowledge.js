import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const defaultDocx = path.join(rootDir, "data", "source", "习酒典型侵权产品图片及判决.docx");
const outputPath = path.join(rootDir, "data", "extracted", "ocr", "xijiu-doc-knowledge.json");
const dbPath = path.join(rootDir, "data", "db.json");
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS || 30000);

loadEnvFile(path.join(rootDir, ".env"));

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
  }
}

function argValue(name, fallback = "") {
  const arg = process.argv.find((item) => item.startsWith(`${name}=`));
  return arg ? arg.slice(name.length + 1) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

async function readJsonIfExists(filePath, fallback = null) {
  if (!existsSync(filePath)) return fallback;
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function unzipList(docxPath) {
  return execFileSync("unzip", ["-Z1", docxPath], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split(/\r?\n/)
    .filter(Boolean);
}

function unzipEntry(docxPath, entry) {
  return execFileSync("unzip", ["-p", docxPath, entry], { maxBuffer: 64 * 1024 * 1024 });
}

function xmlText(value) {
  return String(value || "")
    .replace(/<w:tab\s*\/>/g, " ")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/w:p>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\u00a0/g, " ");
}

function cleanLines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function extractCaseRows(lines) {
  const start = lines.findIndex((line) => line === "序号");
  const body = start >= 0 ? lines.slice(start + 5) : lines;
  const rows = [];
  let current = null;

  for (const line of body) {
    if (/^\d{1,3}$/.test(line)) {
      if (current) rows.push(current);
      current = { sequence: Number(line), text: [] };
      continue;
    }
    if (current) current.text.push(line);
  }
  if (current) rows.push(current);
  return rows
    .filter((row) => row.text.length)
    .map((row) => {
      const text = row.text.join("\n");
      return {
        sequence: row.sequence,
        rawText: text,
        rightBases: uniqueMatches(text, [
          /第?\s*(?:11218168|9000971|184873|27250465|6018549|9000975|12435314|6018649|11848242|1522796|9368299|14911161|1753987|14911160|9368305|30736612)\s*号?(?:注册?商标)?/g,
          /ZL\s?\d{12,}\.\d/g,
          /2L\s?\d{12,}\.\d/g,
          /有一定影响的包装、?装潢/g,
          /外观设计专利/g
        ]),
        courtReason: sentenceMatches(text, ["混淆", "近似", "相似", "关联", "知名", "包装", "装潢", "误认"]),
        visualFactors: uniqueMatches(text, [
          /圆形瓶体/g,
          /梯形底座/g,
          /细长型/g,
          /多层金色环圈/g,
          /凸起状装饰线条/g,
          /整体造型/g,
          /瓶身/g,
          /底座形状/g,
          /酒瓶/g,
          /酒盒/g
        ])
      };
    });
}

function sentenceMatches(text, needles) {
  return text
    .split(/[。；;]/)
    .map((item) => item.trim())
    .filter((item) => needles.some((needle) => item.includes(needle)))
    .slice(0, 8);
}

function uniqueMatches(text, patterns) {
  const result = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) result.push(match[0].replace(/\s+/g, ""));
  }
  return [...new Set(result)];
}

function pngDimensions(buffer) {
  if (buffer.length < 24) return null;
  if (buffer.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function jpegDimensions(buffer) {
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  return null;
}

function imageInfo(docxPath, entry) {
  const buffer = unzipEntry(docxPath, entry);
  const ext = path.extname(entry).toLowerCase();
  const dimensions = ext === ".png" ? pngDimensions(buffer) : jpegDimensions(buffer);
  return {
    entry,
    fileName: path.basename(entry),
    mimeType: ext === ".png" ? "image/png" : "image/jpeg",
    size: buffer.length,
    width: dimensions?.width || null,
    height: dimensions?.height || null
  };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("model_timeout")), MODEL_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function ocrImage(docxPath, image, model) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("DASHSCOPE_API_KEY_missing");
  const buffer = unzipEntry(docxPath, image.entry);
  const dataUrl = `data:${image.mimeType};base64,${buffer.toString("base64")}`;
  const response = await fetchWithTimeout("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "请对图片做 OCR，并尽量保留表格结构。只输出图片中的文字；如果是酒瓶/酒盒对比图，请补充可见的品牌、产品名、视觉要素。"
            },
            { type: "image_url", image_url: { url: dataUrl } }
          ]
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`ocr_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content || "";
}

function buildKnowledge({ lines, caseRows, images, ocrResults }) {
  const fullText = lines.join("\n");
  const successfulOcr = ocrResults.filter((item) => item.text);
  const failedOcr = ocrResults.filter((item) => item.error);
  const ocrText = successfulOcr.map((item) => item.text).join("\n");
  const allText = `${fullText}\n${ocrText}`;
  const ocrRows = successfulOcr.map((item, index) => {
    const text = item.text || "";
    return {
      sequence: `ocr-${index + 1}`,
      image: item.image,
      rawText: text,
      rightBases: uniqueMatches(text, [
        /第?\s*(?:11218168|9000971|184873|27250465|6018549|9000975|12435314|6018649|11848242|1522796|9368299|14911161|1753987|14911160|9368305|30736612)\s*号?(?:注册?商标)?/g,
        /ZL\s?\d{12,}\.\d/g,
        /2L\s?\d{12,}\.\d/g,
        /有一定影响的包装、?装潢/g,
        /外观设计专利/g
      ]),
      courtReason: sentenceMatches(text, ["混淆", "近似", "相似", "关联", "知名", "包装", "装潢", "误认"]),
      visualFactors: uniqueMatches(text, [
        /圆形瓶体/g,
        /梯形底座/g,
        /细长型/g,
        /多层金色环圈/g,
        /凸起状装饰线条/g,
        /整体造型/g,
        /瓶身/g,
        /底座形状/g,
        /酒瓶/g,
        /酒盒/g,
        /瓶盖/g,
        /酒标/g,
        /金色环圈/g
      ])
    };
  });
  const allRows = [...caseRows, ...ocrRows];
  const rightBases = [...new Set(allRows.flatMap((row) => row.rightBases))].slice(0, 80);
  const visualFactors = [...new Set(allRows.flatMap((row) => row.visualFactors))];
  const courtReasons = [...new Set(allRows.flatMap((row) => row.courtReason))].slice(0, 120);

  return {
    generatedAt: new Date().toISOString(),
    source: "data/source/习酒典型侵权产品图片及判决.docx",
    summary: {
      title: lines[0] || "习酒典型侵权产品权利基础、侵权产品、法院判决",
      textLineCount: lines.length,
      caseRowCount: caseRows.length,
      embeddedImageCount: images.length,
      ocrImageCount: successfulOcr.length,
      ocrErrorCount: failedOcr.length
    },
    rightBases,
    visualFactors,
    courtReasons,
    reusableRules: [
      "窖藏1988酒瓶、酒盒及其包装装潢在资料中被反复作为有一定影响的包装、装潢引用。",
      "被控产品与权利商品同为白酒时，商品类似性应作为风险判断基础。",
      "圆形瓶体、梯形底座、细长瓶颈、多层金色环圈、两侧凸起状装饰线条可作为组合式视觉近似要素。",
      "瓶身颜色、正面汉字不同，不当然排除混淆风险，应结合整体造型、瓶身、底座和装饰线条判断。",
      "涉及酒盒时，需要同步提示包装装潢和外观设计专利复核。"
    ].filter((rule) => allText.includes(rule.slice(0, 6)) || rule.includes("不当然")),
    caseRows,
    ocrRows,
    images,
    ocrResults
  };
}

async function syncKnowledgeToDb(knowledge) {
  const db = await readJsonIfExists(dbPath, { standardVersion: 2, leads: [], rules: [], rightBases: [], precedentCases: [] });
  db.rules = Array.isArray(db.rules) ? db.rules.filter((item) => item.source !== "docx-knowledge") : [];
  db.rightBases = Array.isArray(db.rightBases) ? db.rightBases.filter((item) => item.source !== "docx-knowledge") : [];
  db.precedentCases = Array.isArray(db.precedentCases) ? db.precedentCases.filter((item) => item.source !== "docx-knowledge") : [];

  db.rules.push(
    ...knowledge.reusableRules.map((text, index) => ({
      id: `doc-rule-${index + 1}`,
      title: `律所资料规则 ${index + 1}`,
      text,
      weight: index === 2 ? 4 : 3,
      source: "docx-knowledge"
    }))
  );

  db.rightBases.push(
    ...knowledge.rightBases.map((title, index) => ({
      id: `doc-right-${index + 1}`,
      type: title.includes("专利") || title.includes("2L") || title.includes("ZL") ? "外观设计专利" : title.includes("包装") ? "包装装潢" : "注册商标",
      title,
      keywords: [...new Set([title, title.replace(/[第号注册商标\s]/g, ""), "习酒", "窖藏1988"].filter(Boolean))],
      source: "docx-knowledge"
    }))
  );

  const usefulRows = [...(knowledge.caseRows || []), ...(knowledge.ocrRows || [])]
    .filter((row) => row.courtReason?.length || row.visualFactors?.length || row.rightBases?.length)
    .slice(0, 30);
  db.precedentCases.push(
    ...usefulRows.map((row, index) => ({
      id: `doc-case-${row.sequence}`,
      title: `律所资料案例 ${row.sequence}`,
      image: `/case-images/xijiu-case-${index % 8 + 1}.png`,
      points: [...new Set([...(row.visualFactors || []), ...(row.rightBases || [])])].slice(0, 8),
      holding: (row.courtReason?.[0] || row.rawText || "").slice(0, 180),
      source: "docx-knowledge"
    }))
  );

  db.standardVersion = Math.max(Number(db.standardVersion || 2), 3);
  await writeFile(dbPath, `${JSON.stringify(db, null, 2)}\n`);
}

async function main() {
  const docxPath = path.resolve(argValue("--docx", defaultDocx));
  const ocr = hasFlag("--ocr");
  const forceOcr = hasFlag("--force-ocr");
  const retryErrors = hasFlag("--retry-errors");
  const ocrLimit = Number(argValue("--ocr-limit", "0"));
  const ocrModel = argValue("--ocr-model", process.env.DASHSCOPE_OCR_MODEL || "qwen-vl-ocr");

  if (!existsSync(docxPath)) throw new Error(`docx_not_found:${docxPath}`);

  const entries = unzipList(docxPath);
  const documentXml = unzipEntry(docxPath, "word/document.xml").toString("utf8");
  const lines = cleanLines(xmlText(documentXml));
  const caseRows = extractCaseRows(lines);
  const images = entries
    .filter((entry) => /^word\/media\/image\d+\.(png|jpe?g)$/i.test(entry))
    .sort((a, b) => Number(a.match(/image(\d+)/)?.[1] || 0) - Number(b.match(/image(\d+)/)?.[1] || 0))
    .map((entry) => imageInfo(docxPath, entry));

  const ocrTargets = ocr ? images.slice(0, ocrLimit || images.length) : [];
  const previousKnowledge = await readJsonIfExists(outputPath, {});
  const previousOcr = new Map((previousKnowledge.ocrResults || []).filter((item) => item.text).map((item) => [item.image, item]));
  const previousErrors = new Map((previousKnowledge.ocrResults || []).filter((item) => item.error).map((item) => [item.image, item]));
  const ocrResults = ocr ? [...previousOcr.values(), ...(!retryErrors ? previousErrors.values() : [])] : [];
  for (const image of ocrTargets) {
    if (retryErrors && !previousErrors.has(image.fileName)) continue;
    if (!forceOcr && previousOcr.has(image.fileName)) {
      console.log(`OCR ${image.fileName}: cached`);
      continue;
    }
    try {
      const text = await ocrImage(docxPath, image, ocrModel);
      ocrResults.push({ image: image.fileName, model: ocrModel, text });
      console.log(`OCR ${image.fileName}: ok`);
    } catch (error) {
      ocrResults.push({ image: image.fileName, model: ocrModel, error: error.message });
      console.log(`OCR ${image.fileName}: ${error.message}`);
    }
  }

  const knowledge = buildKnowledge({ lines, caseRows, images, ocrResults });
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(knowledge, null, 2)}\n`);
  await syncKnowledgeToDb(knowledge);
  console.log(`Wrote ${path.relative(rootDir, outputPath)}`);
  console.log(`Synced ${path.relative(rootDir, dbPath)}`);
  console.log(`Cases: ${knowledge.summary.caseRowCount}, images: ${knowledge.summary.embeddedImageCount}, OCR: ${knowledge.summary.ocrImageCount}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
