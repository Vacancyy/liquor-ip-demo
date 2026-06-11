import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const out = "酒类侵权风险智能研判Demo_精简汇报版.pptx";
const work = path.join("/private/tmp", `liquor-ppt-${Date.now()}`);
const ppt = path.join(work, "ppt");

const EMU = 914400;
const W = 13.333333 * EMU;
const H = 7.5 * EMU;

const C = {
  white: "FFFFFF",
  bg: "F7F8F6",
  ink: "1F2A28",
  muted: "66736F",
  line: "E3E8E4",
  green: "2F6B57",
  softGreen: "E7F0EB",
  gold: "B9933F",
  red: "B85C57",
};

let id = 1;
const nextId = () => ++id;
const inch = (v) => Math.round(v * EMU);
const fontSize = (v) => Math.round(v * 100);
const esc = (s) => String(s).replace(/[&<>"']/g, (m) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
})[m]);

function shape({ x, y, w, h, fill = C.white, line = C.line, radius = false, text = [], align = "l", valign = "mid" }) {
  return `
  <p:sp>
    <p:nvSpPr><p:cNvPr id="${nextId()}" name="Shape"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${inch(x)}" y="${inch(y)}"/><a:ext cx="${inch(w)}" cy="${inch(h)}"/></a:xfrm>
      <a:prstGeom prst="${radius ? "roundRect" : "rect"}"><a:avLst/></a:prstGeom>
      <a:solidFill><a:srgbClr val="${fill}"/></a:solidFill>
      <a:ln w="6350"><a:solidFill><a:srgbClr val="${line}"/></a:solidFill></a:ln>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="square" anchor="${valign}" lIns="152400" tIns="76200" rIns="152400" bIns="76200"><a:spAutoFit/></a:bodyPr>
      <a:lstStyle/>
      ${text.map((t) => `
      <a:p>
        <a:pPr algn="${align}"/>
        <a:r><a:rPr lang="zh-CN" sz="${fontSize(t.size || 16)}" ${t.bold ? 'b="1"' : ""}>
          <a:solidFill><a:srgbClr val="${t.color || C.ink}"/></a:solidFill>
          <a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/>
        </a:rPr><a:t>${esc(t.value)}</a:t></a:r>
      </a:p>`).join("")}
    </p:txBody>
  </p:sp>`;
}

function line({ x1, y1, x2, y2, color = C.line }) {
  return `
  <p:cxnSp>
    <p:nvCxnSpPr><p:cNvPr id="${nextId()}" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
    <p:spPr>
      <a:xfrm><a:off x="${inch(Math.min(x1, x2))}" y="${inch(Math.min(y1, y2))}"/><a:ext cx="${inch(Math.abs(x2 - x1))}" cy="${inch(Math.abs(y2 - y1))}"/></a:xfrm>
      <a:prstGeom prst="line"><a:avLst/></a:prstGeom>
      <a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln>
    </p:spPr>
  </p:cxnSp>`;
}

function base(title, section) {
  return `
    ${shape({ x: 0, y: 0, w: 13.333, h: 7.5, fill: C.bg, line: C.bg })}
    ${shape({ x: 0.7, y: 0.48, w: 0.14, h: 0.52, fill: C.green, line: C.green })}
    ${shape({ x: 0.95, y: 0.42, w: 7.8, h: 0.55, fill: C.bg, line: C.bg, text: [{ value: title, size: 20, bold: true }], align: "l" })}
    ${shape({ x: 10.4, y: 0.48, w: 2.1, h: 0.42, fill: C.bg, line: C.bg, text: [{ value: section, size: 10, color: C.muted }], align: "r" })}
    ${line({ x1: 0.7, y1: 1.14, x2: 12.65, y2: 1.14 })}
  `;
}

function bullets(items, x, y, w, gap = 0.72) {
  return items.map((item, i) => `
    ${shape({ x, y: y + i * gap + 0.08, w: 0.12, h: 0.12, fill: item.color || C.green, line: item.color || C.green })}
    ${shape({ x: x + 0.28, y: y + i * gap - 0.03, w, h: 0.32, fill: C.bg, line: C.bg, text: [{ value: item.text || item, size: item.size || 15, color: item.muted ? C.muted : C.ink, bold: item.bold }] })}
  `).join("");
}

function flow(items, x, y, boxW, boxH, gap, activeLast = false) {
  return items.map((t, i) => `
    ${shape({ x: x + i * (boxW + gap), y, w: boxW, h: boxH, fill: activeLast && i === items.length - 1 ? C.green : C.white, line: activeLast && i === items.length - 1 ? C.green : C.line, radius: true, text: [{ value: t, size: 12.5, color: activeLast && i === items.length - 1 ? C.white : C.ink, bold: true }], align: "c" })}
    ${i < items.length - 1 ? line({ x1: x + boxW + i * (boxW + gap) + 0.08, y1: y + boxH / 2, x2: x + boxW + gap - 0.08 + i * (boxW + gap), y2: y + boxH / 2, color: C.green }) : ""}
  `).join("");
}

const slideBodies = [
  () => `
    ${shape({ x: 0, y: 0, w: 13.333, h: 7.5, fill: C.bg, line: C.bg })}
    ${shape({ x: 0.85, y: 0.95, w: 1.3, h: 0.08, fill: C.green, line: C.green })}
    ${shape({ x: 0.85, y: 1.45, w: 10.7, h: 0.8, fill: C.bg, line: C.bg, text: [{ value: "酒类侵权线索智能研判工作台", size: 30, bold: true }], align: "l" })}
    ${shape({ x: 0.9, y: 2.42, w: 8.9, h: 0.52, fill: C.bg, line: C.bg, text: [{ value: "律师标准驱动的线索初筛与复核辅助 Demo", size: 18, color: C.muted }], align: "l" })}
    ${shape({ x: 0.9, y: 4.45, w: 7.1, h: 0.56, fill: C.softGreen, line: C.softGreen, radius: true, text: [{ value: "核心不是“AI 直接判侵权”，而是把判断标准、样本和复核过程沉淀下来", size: 13, color: C.green, bold: true }], align: "c" })}
    ${shape({ x: 9.8, y: 5.75, w: 2.55, h: 0.36, fill: C.bg, line: C.bg, text: [{ value: "2026.06", size: 12, color: C.muted }], align: "r" })}
  `,
  () => `
    ${base("业务问题", "01")}
    ${shape({ x: 0.95, y: 1.55, w: 5.3, h: 1.05, fill: C.white, line: C.line, radius: true, text: [{ value: "已发现线索之后，如何快速判断是否值得继续取证？", size: 18, bold: true }], align: "c" })}
    ${bullets([
      { text: "人工初筛重复、耗时，判断口径难统一。", bold: true, size: 14 },
      { text: "律师经验沉淀在文档和个案中，复用成本高。", size: 14 },
      { text: "线索材料不完整时，需要快速提示补证方向。", size: 14 },
      { text: "单靠通用图片识别，解释性和法律语境不足。", color: C.gold, size: 14 },
    ], 1.15, 3.15, 5.1, 0.58)}
    ${shape({ x: 6.85, y: 1.55, w: 5.45, h: 4.35, fill: C.white, line: C.line, radius: true, text: [{ value: "系统定位", size: 19, color: C.green, bold: true }, { value: "线索研判", size: 24, bold: true }, { value: "不是线索发现", size: 14, color: C.muted }, { value: "不是最终法律结论", size: 14, color: C.muted }], align: "c" })}
  `,
  () => `
    ${base("解决方案", "02")}
    ${flow(["上传线索图片", "识别文字/视觉", "匹配律师标准", "计算风险分级", "输出复核建议"], 0.85, 1.75, 1.85, 0.68, 0.58, true)}
    ${shape({ x: 1.0, y: 3.2, w: 11.25, h: 0.88, fill: C.white, line: C.line, radius: true, text: [{ value: "系统先判断“像不像正品/历史被控样本”，再结合律师规则给出线索风险评分。", size: 17, bold: true }], align: "c" })}
    ${shape({ x: 1.0, y: 4.75, w: 3.4, h: 1.0, fill: C.softGreen, line: C.softGreen, radius: true, text: [{ value: "律师标准", size: 18, color: C.green, bold: true }, { value: "主判断依据", size: 12, color: C.muted }] })}
    ${shape({ x: 4.7, y: 4.75, w: 3.4, h: 1.0, fill: C.white, line: C.line, radius: true, text: [{ value: "样本库", size: 18, color: C.green, bold: true }, { value: "正品 / 高风险样本", size: 12, color: C.muted }] })}
    ${shape({ x: 8.4, y: 4.75, w: 3.4, h: 1.0, fill: C.white, line: C.line, radius: true, text: [{ value: "多模态模型", size: 18, color: C.green, bold: true }, { value: "文字 / 包装 / 结构化识别", size: 12, color: C.muted }] })}
  `,
  () => `
    ${base("当前可演示能力", "03")}
    ${shape({ x: 1.05, y: 1.55, w: 11.15, h: 0.78, fill: C.softGreen, line: C.softGreen, radius: true, text: [{ value: "已具备单张图片线索的完整初筛链路。", size: 20, color: C.green, bold: true }], align: "c" })}
    ${bullets([
      { text: "上传图片后输出风险等级、风险评分和判断依据。", bold: true },
      { text: "支持正品样本、高风险样本、律师文档规则入库。" },
      { text: "展示相似点、差异点、证据缺口和补证建议。" },
      { text: "管理端可维护样本、规则和研判策略。" },
      { text: "可运行回归评测，持续发现误判和漏判。", color: C.gold },
    ], 1.25, 2.85, 10.8, 0.62)}
  `,
  () => `
    ${base("信息化价值", "04")}
    ${shape({ x: 0.95, y: 1.55, w: 3.65, h: 1.18, fill: C.white, line: C.line, radius: true, text: [{ value: "标准沉淀", size: 18, color: C.green, bold: true }, { value: "把律师判断逻辑结构化", size: 12, color: C.muted }] })}
    ${shape({ x: 4.85, y: 1.55, w: 3.65, h: 1.18, fill: C.white, line: C.line, radius: true, text: [{ value: "流程提效", size: 18, color: C.green, bold: true }, { value: "先分流，再人工复核", size: 12, color: C.muted }] })}
    ${shape({ x: 8.75, y: 1.55, w: 3.65, h: 1.18, fill: C.white, line: C.line, radius: true, text: [{ value: "数据闭环", size: 18, color: C.green, bold: true }, { value: "样本、反馈、评测可迭代", size: 12, color: C.muted }] })}
    ${shape({ x: 1.05, y: 3.55, w: 11.15, h: 1.0, fill: C.softGreen, line: C.softGreen, radius: true, text: [{ value: "从一次性判断，升级为可管理、可评估、可扩展的品牌保护知识资产。", size: 20, color: C.green, bold: true }], align: "c" })}
    ${bullets([
      { text: "适合对接已有 OA、案件管理、线索台账或品牌保护流程。", size: 14 },
      { text: "后续可扩展批量线索、角色权限、复核工单和处置记录。", size: 14 },
    ], 1.3, 5.25, 10.8, 0.58)}
  `,
  () => `
    ${base("当前边界与下一步", "05")}
    ${shape({ x: 1.0, y: 1.55, w: 5.55, h: 4.55, fill: C.white, line: C.line, radius: true, text: [{ value: "当前边界", size: 19, color: C.red, bold: true }, { value: "Demo 阶段，不能作为最终法律结论", size: 13, color: C.muted }, { value: "主要支持习酒相关单图研判", size: 13, color: C.muted }, { value: "准确率依赖样本质量和律师标签", size: 13, color: C.muted }, { value: "模型稳定性仍需工程化监控", size: 13, color: C.muted }], align: "l" })}
    ${shape({ x: 6.85, y: 1.55, w: 5.55, h: 4.55, fill: C.white, line: C.line, radius: true, text: [{ value: "下一步", size: 19, color: C.green, bold: true }, { value: "建立固定测试集和准确率看板", size: 13, color: C.muted }, { value: "强化正品保护和高风险模板匹配", size: 13, color: C.muted }, { value: "加入律师复核反馈闭环", size: 13, color: C.muted }, { value: "扩展批量处理与系统对接", size: 13, color: C.muted }], align: "l" })}
  `,
  () => `
    ${base("Demo 演示路径", "06")}
    ${shape({ x: 1.0, y: 1.55, w: 11.25, h: 0.8, fill: C.softGreen, line: C.softGreen, radius: true, text: [{ value: "演示重点：看系统如何把一张图片变成可复核的线索研判报告。", size: 19, color: C.green, bold: true }], align: "c" })}
    ${flow(["上传图片", "查看风险分级", "解释判断依据", "看补证建议", "进入管理端"], 0.85, 3.0, 1.85, 0.68, 0.58, true)}
    ${bullets([
      { text: "话术：这是初筛助手，帮助决定“是否值得继续取证/复核”。", bold: true, size: 14 },
      { text: "重点展示：不是只给分数，而是给依据、差异点和下一步动作。", size: 14 },
      { text: "收口：信息化价值在于标准、样本、反馈和评测持续沉淀。", color: C.gold, size: 14 },
    ], 1.25, 4.75, 10.8, 0.56)}
  `,
];

function slideXml(body) {
  id = 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
    <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${Math.round(W)}" cy="${Math.round(H)}"/><a:chOff x="0" y="0"/><a:chExt cx="${Math.round(W)}" cy="${Math.round(H)}"/></a:xfrm></p:grpSpPr>
    ${body()}
  </p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

function write(file, content) {
  writeFileSync(path.join(work, file), content.trim(), "utf8");
}

mkdirSync(path.join(ppt, "slides", "_rels"), { recursive: true });
mkdirSync(path.join(work, "_rels"), { recursive: true });
mkdirSync(path.join(ppt, "_rels"), { recursive: true });
mkdirSync(path.join(ppt, "theme"), { recursive: true });
mkdirSync(path.join(ppt, "slideMasters", "_rels"), { recursive: true });
mkdirSync(path.join(ppt, "slideLayouts", "_rels"), { recursive: true });

write("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  ${slideBodies.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("\n  ")}
</Types>`);

write("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

write("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
  <p:sldIdLst>${slideBodies.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join("")}</p:sldIdLst>
  <p:sldSz cx="${Math.round(W)}" cy="${Math.round(H)}" type="wide"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`);

write("ppt/_rels/presentation.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
  ${slideBodies.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("\n  ")}
</Relationships>`);

write("ppt/theme/theme1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Clean Report">
  <a:themeElements>
    <a:clrScheme name="Clean"><a:dk1><a:srgbClr val="${C.ink}"/></a:dk1><a:lt1><a:srgbClr val="${C.white}"/></a:lt1><a:dk2><a:srgbClr val="${C.green}"/></a:dk2><a:lt2><a:srgbClr val="${C.bg}"/></a:lt2><a:accent1><a:srgbClr val="${C.green}"/></a:accent1><a:accent2><a:srgbClr val="${C.gold}"/></a:accent2><a:accent3><a:srgbClr val="${C.red}"/></a:accent3><a:accent4><a:srgbClr val="${C.softGreen}"/></a:accent4><a:accent5><a:srgbClr val="${C.muted}"/></a:accent5><a:accent6><a:srgbClr val="${C.line}"/></a:accent6><a:hlink><a:srgbClr val="${C.green}"/></a:hlink><a:folHlink><a:srgbClr val="${C.green}"/></a:folHlink></a:clrScheme>
    <a:fontScheme name="YaHei"><a:majorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:majorFont><a:minorFont><a:latin typeface="Microsoft YaHei"/><a:ea typeface="Microsoft YaHei"/></a:minorFont></a:fontScheme>
    <a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
  </a:themeElements>
</a:theme>`);

write("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
  <p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles>
</p:sldMaster>`);

write("ppt/slideMasters/_rels/slideMaster1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`);

write("ppt/slideLayouts/slideLayout1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`);

write("ppt/slideLayouts/_rels/slideLayout1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`);

slideBodies.forEach((body, i) => {
  write(`ppt/slides/slide${i + 1}.xml`, slideXml(body));
  write(`ppt/slides/_rels/slide${i + 1}.xml.rels`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>`);
});

rmSync(out, { force: true });
execFileSync("zip", ["-qr", path.resolve(out), "."], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(`generated ${out}`);
