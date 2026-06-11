# 酒类侵权风险智能研判 Demo

这是一个基于 Next.js 的酒类侵权图片初筛系统 Demo，当前重点面向“第二步判断”：用户上传图片后，系统结合正品样本库、侵权样本库、律师判断标准和大模型辅助识别，输出疑似侵权风险、判断依据和补证建议。

## 当前功能

- 客户端上传图片并生成风险判断报告
- 展示上传素材、风险评分、风险等级、判断依据、排除理由和补证建议
- 管理端维护正品来源、结构化产品名、人工上传样本
- 管理端支持上传正品样本或侵权样本
- 管理端支持研判策略配置，包括高灵敏度、平衡、高特异度和自定义策略
- 展示灵敏度、特异度、信度、效度等内部评估指标
- 支持构建图片样本库和图片 embedding 向量库
- 支持从贵州习酒官网抓取正品产品图片来源
- 支持基于律师 Word 文档提取图片和规则知识

## 技术栈

- Next.js 16
- React 19
- Node.js
- Sharp
- 阿里云百炼 DashScope
- 本地 JSON 知识库

## 项目结构

```text
app/                         Next.js 页面和 API 路由
app/page.jsx                 客户端上传和结果展示页面
app/admin/                   管理端页面
app/api/                     后端 API
data/knowledge/              本地知识库、样本库、策略配置
data/evaluation/             评测样本和评测报告
data/extracted/              律师文档提取内容
lib/                         公共工具和知识库维护逻辑
scripts/                     样本构建、评测、抓取、文档入库脚本
public/                      前端样式和案例图片
server.js                    核心研判服务逻辑
```

## 本地运行

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:3766
```

管理端：

```text
http://127.0.0.1:3766/admin
```

## 环境变量

项目会读取 `.env`。该文件不应提交到 GitHub。

常用配置示例：

```bash
DASHSCOPE_API_KEY=你的百炼APIKey
DASHSCOPE_MULTIMODAL_MODEL=qwen3-vl-plus
DASHSCOPE_REASONING_MODEL=qwen-plus
MODEL_TIMEOUT_MS=8000
MULTIMODAL_TIMEOUT_MS=30000
IMAGE_EMBEDDING_MATCH_THRESHOLD=90
```

## 常用脚本

构建项目：

```bash
npm run build
```

启动生产服务：

```bash
npm start
```

回归检查：

```bash
npm run check:regression
```

构建图片样本库：

```bash
npm run build:image-library
```

构建图片向量库：

```bash
npm run build:image-library:embedding
```

抓取习酒官网正品来源：

```bash
npm run scrape:xijiu:official
```

律师 Word 文档入库：

```bash
npm run ingest:docx
```

带图片文字抽取的律师 Word 文档入库：

```bash
npm run ingest:docx:ocr
```

正品样本评测：

```bash
npm run evaluate:authentic
```

律师文档侵权样本评测：

```bash
npm run evaluate:lawyer-doc
```

## 研判流程

当前上传图片后的主要流程：

```text
上传图片
  ↓
精确哈希检查
  ↓
图片向量相似检索
  ↓
正品库 / 侵权库对照
  ↓
图片内容识别与多模态辅助
  ↓
律师文档结构化标准判断
  ↓
风险评分与证据冲突检查
  ↓
生成风险结论和补证建议
```

## 管理端能力

管理端当前用于内部维护，不直接面向客户：

- 查看知识库状态
- 查看内部评测指标
- 管理正品来源
- 管理结构化正品名称
- 上传正品/侵权确认样本
- 配置研判策略
- 查看已上传样本

注意：上传新图片样本后，相同图片可以通过哈希立即命中；如果要让相似图片也能匹配，需要重新执行：

```bash
npm run build:image-library:embedding
```

## 注意事项

- `.env` 不会提交，部署或换机器时需要重新配置 API Key
- `data/db*.json` 是本地运行数据，不提交
- 当前项目是 Demo，不应直接作为法律结论使用
- 输出结果应理解为线索初筛和律师复核辅助
- 准确率依赖样本库、律师规则结构化程度、图片质量和客户真实测试集

## GitHub

当前仓库：

```text
https://github.com/Vacancyy/liquor-ip-demo
```
