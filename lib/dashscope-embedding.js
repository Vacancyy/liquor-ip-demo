import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

export const DEFAULT_IMAGE_EMBEDDING_MODEL = "tongyi-embedding-vision-plus-2026-03-06";
export const DEFAULT_IMAGE_EMBEDDING_DIMENSION = 1152;
export const DEFAULT_IMAGE_EMBEDDING_RES_LEVEL = 1;
export const DASH_SCOPE_EMBEDDING_URL = "https://dashscope.aliyuncs.com/api/v1/services/embeddings/multimodal-embedding/multimodal-embedding";

export function loadEnvFile(filePath) {
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

export function loadProjectEnv(projectRoot = process.cwd()) {
  loadEnvFile(path.join(projectRoot, ".env"));
}

export function embeddingConfig() {
  return {
    model: process.env.DASHSCOPE_IMAGE_EMBEDDING_MODEL || DEFAULT_IMAGE_EMBEDDING_MODEL,
    dimension: Number(process.env.DASHSCOPE_IMAGE_EMBEDDING_DIMENSION || DEFAULT_IMAGE_EMBEDDING_DIMENSION),
    resLevel: Number(process.env.DASHSCOPE_IMAGE_EMBEDDING_RES_LEVEL || DEFAULT_IMAGE_EMBEDDING_RES_LEVEL),
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS || 30000)
  };
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function callDashscopeImageEmbedding(imageData, options = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !imageData) return null;

  const config = { ...embeddingConfig(), ...options };
  const response = await fetchWithTimeout(DASH_SCOPE_EMBEDDING_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: config.model,
      input: {
        contents: [{ image: imageData }]
      },
      parameters: {
        dimension: config.dimension,
        res_level: config.resLevel
      }
    })
  }, config.timeoutMs);

  if (!response.ok) throw new Error(`embedding_model_failed:${response.status}:${await response.text()}`);
  const data = await response.json();
  const embedding = data.output?.embeddings?.[0]?.embedding;
  if (!Array.isArray(embedding)) throw new Error("embedding_model_empty_output");
  return {
    model: config.model,
    dimension: embedding.length,
    embedding,
    usage: data.usage || null
  };
}

export function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]) || 0;
    const b = Number(right[index]) || 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function similarityPercentFromCosine(value) {
  return Math.max(0, Math.min(100, Math.round(((value + 1) / 2) * 100)));
}
