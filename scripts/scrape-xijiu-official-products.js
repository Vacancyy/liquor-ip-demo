import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const rootDir = process.cwd();
const imageDir = path.join(rootDir, "data", "knowledge", "authentic-images");
const outputPath = path.join(rootDir, "data", "knowledge", "official-authentic-image-sources.json");
const baseUrl = "https://www.gzxijiu.com";
const staticImagePrefix = "https://static-ow.gzxijiu.com/";

function curl(url, options = []) {
  const env = { ...process.env };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]) {
    delete env[key];
  }
  return execFileSync("curl", [
    "-L",
    "-A",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    "-e",
    "https://www.gzxijiu.com/",
    "--retry",
    "3",
    "--retry-delay",
    "2",
    "--connect-timeout",
    "20",
    "--max-time",
    "45",
    "--http1.1",
    ...options,
    url
  ], { encoding: options.includes("-o") ? undefined : "utf8", env, maxBuffer: 64 * 1024 * 1024 });
}

function safeId(value) {
  const hash = createHash("sha1").update(String(value)).digest("hex").slice(0, 10);
  const ascii = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
  return ascii ? `${ascii}-${hash}` : hash;
}

function routeFor(parent, item) {
  return `/product/${parent.jumpUrl}-${item.jumpUrl}?menuId=${encodeURIComponent(item.id)}`;
}

function resolveNuxt(value, payload, seen = new Set()) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value < payload.length) {
    if (seen.has(value)) return value;
    seen.add(value);
    return resolveNuxt(payload[value], payload, seen);
  }
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && ["ShallowReactive", "Reactive", "Set"].includes(value[0])) {
      return resolveNuxt(value[1], payload, seen);
    }
    return value.map((item) => resolveNuxt(item, payload, new Set(seen)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveNuxt(item, payload, new Set(seen))]));
  }
  return value;
}

function extractNuxtPayload(html) {
  const match = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return [];
  return JSON.parse(match[1]);
}

function extractProducts(html) {
  const payload = extractNuxtPayload(html);
  const products = [];
  for (const item of payload) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    if (!Object.hasOwn(item, "imgHdUrl") || !Object.hasOwn(item, "productName")) continue;
    const resolved = resolveNuxt(item, payload);
    if (!resolved.imgHdUrl || !String(resolved.imgHdUrl).startsWith(staticImagePrefix)) continue;
    products.push(resolved);
  }
  const seen = new Set();
  return products.filter((item) => {
    const key = `${item.id}-${item.imgHdUrl}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function downloadImage(url, filePath) {
  if (existsSync(filePath) && statSync(filePath).size > 0) return;
  curl(url, ["-o", filePath]);
}

function sourceFromProduct(category, product) {
  const productName = String(product.productName || "").trim();
  const id = `authentic-xijiu-official-${safeId(`${category.jumpUrl}-${product.id}-${productName}`)}`;
  const fileName = `${id}.jpg`;
  return {
    id,
    title: `习酒官网正品图-${category.name}-${productName}`,
    productName,
    officialProductId: product.id,
    officialSeriesId: category.id,
    officialSeriesName: category.name,
    filePath: `data/knowledge/authentic-images/${fileName}`,
    imageUrl: product.imgHdUrl,
    thumbnailUrl: product.imgAbbrUrl || "",
    sourceUrl: `${baseUrl}/product/detail?menuId=${encodeURIComponent(category.id)}&id=${encodeURIComponent(product.id)}`,
    sourceName: `贵州习酒官网产品中心-${category.name}`,
    labelSource: "official_website",
    structuredTags: [
      "官网正品",
      category.name,
      product.vol || "",
      product.specification || "",
      "贵州习酒"
    ].filter(Boolean),
    visualFactors: ["习酒标识", "正品酒瓶", "正品酒盒"]
  };
}

await mkdir(imageDir, { recursive: true });

const menuResponse = JSON.parse(curl(`${baseUrl}/api/menuConfig/queryAll`, ["-X", "POST"]));
const menu = menuResponse.data || [];
const productRoot = menu.find((item) => item.name === "产品中心");
const mainProduct = menu.find((item) => item.parentId === productRoot?.id && item.name === "主销产品");
const categories = menu
  .filter((item) => item.parentId === mainProduct?.id && item.menuRenderType === "MultimediaList")
  .sort((left, right) => Number(right.sort || 0) - Number(left.sort || 0));

const sources = [];
const skippedSeries = [];
for (const category of categories) {
  const pageUrl = `${baseUrl}${routeFor(mainProduct, category)}`;
  console.log(`抓取系列: ${category.name} ${pageUrl}`);
  let html = "";
  try {
    html = curl(pageUrl);
  } catch (error) {
    skippedSeries.push({ id: category.id, name: category.name, pageUrl, error: error.message });
    console.warn(`  跳过系列: ${category.name} (${error.message})`);
    continue;
  }
  const products = extractProducts(html);
  console.log(`  产品图片: ${products.length}`);
  for (const product of products) {
    const source = sourceFromProduct(category, product);
    try {
      await downloadImage(source.imageUrl, path.join(rootDir, source.filePath));
    } catch (error) {
      skippedSeries.push({ id: category.id, name: category.name, imageUrl: source.imageUrl, error: error.message });
      console.warn(`  图片下载失败: ${source.title} (${error.message})`);
      continue;
    }
    sources.push(source);
  }
}

const previous = existsSync(outputPath)
  ? JSON.parse(await readFile(outputPath, "utf8"))
  : { sources: [] };
const byImageUrl = new Map((previous.sources || []).map((source) => [source.imageUrl || source.filePath, source]));
for (const source of sources) byImageUrl.set(source.imageUrl || source.filePath, source);

const output = {
  version: 3,
  source: "贵州习酒官网产品中心 SSR 数据",
  sourceUrl: `${baseUrl}/product/mainProduct-junpin?menuId=Wds3VhamjqkrJ4TCRFJY5`,
  description: "官网正品图片样本来源清单。构建脚本会把这些图片加入正品图片向量库，用于降低正品误判为侵权的风险。",
  scrapedAt: new Date().toISOString(),
  series: categories.map((item) => ({
    id: item.id,
    name: item.name,
    jumpUrl: item.jumpUrl,
    pageUrl: `${baseUrl}${routeFor(mainProduct, item)}`
  })),
  skippedSeries,
  sources: [...byImageUrl.values()].sort((left, right) => String(left.title).localeCompare(String(right.title), "zh-CN"))
};

await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`已写入 ${outputPath}`);
console.log(`系列数: ${categories.length}`);
console.log(`官网正品图片来源数: ${output.sources.length}`);
