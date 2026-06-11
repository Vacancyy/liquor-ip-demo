"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const initialState = {
  leads: [],
  selectedId: null,
  imageData: "",
  imageName: "",
  loading: false,
  progressStage: 0
};

const analysisSteps = [
  { title: "上传图片", note: "读取图片内容", percent: 10 },
  { title: "整理信息", note: "整理图片和参考资料", percent: 30 },
  { title: "看图识别", note: "提取品牌、包装和文字信息", percent: 55 },
  { title: "按律师标准判断", note: "对照律师整理的判断标准", percent: 75 },
  { title: "核对矛盾点", note: "区分像侵权和像正品的地方", percent: 90 },
  { title: "生成结果", note: "整理结论、原因和补充建议", percent: 100 }
];

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(path, {
      headers: { "content-type": "application/json" },
      ...options,
      signal: controller.signal
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function mergeLead(leads, lead) {
  return leads.map((item) => (item.id === lead.id ? { ...item, ...lead } : item));
}

function fmtTime(value) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function shortText(value = "", max = 42) {
  const text = String(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function inferScore(riskLevel) {
  if (riskLevel === "高风险") return "85";
  if (riskLevel === "中风险") return "68";
  if (riskLevel === "低风险") return "45";
  return "--";
}

function compactSuggestion(suggestions = []) {
  const joined = suggestions.join(" ");
  if (joined.includes("重点复核") || joined.includes("线下取证")) return "重点查看";
  if (joined.includes("补充")) return "补充材料";
  return "人工再看";
}

function publicModelLabel(value = "") {
  const text = String(value || "");
  if (!text || text.includes("模型响应超时") || text.includes("调用失败") || text.includes("未配置")) return "按律师标准判断";
  if (text.includes("多模态模型") || text.includes("阿里云模型")) return "图片辅助判断";
  return "按律师标准判断";
}

function riskTone(riskLevel) {
  if (riskLevel === "高风险") return "risk-high";
  if (riskLevel === "中风险") return "risk-mid";
  if (riskLevel === "低风险") return "risk-low";
  return "risk-pending";
}

function displayRiskLabel(riskLevel) {
  if (riskLevel === "高风险") return "问题较大";
  if (riskLevel === "中风险") return "需要再看";
  if (riskLevel === "低风险") return "问题较小";
  return riskLevel || "待确认";
}

function displayDecisionLabel(label = "") {
  const text = String(label || "");
  if (text.includes("证据冲突")) return "需律师进一步确认";
  if (text.includes("人工复核")) return "需要律师确认";
  if (text.includes("高风险取证")) return "建议重点核实";
  if (text.includes("中风险复核")) return "需要再看";
  if (text.includes("材料不足")) return "需要补充材料";
  if (text.includes("正品保护")) return "问题较小";
  return text || "判断结果";
}

function plainReportText(value = "") {
  return String(value || "")
    .replace(/当前证据存在冲突[:：]?/g, "当前还有关键信息需要确认：")
    .replace(/同时存在高风险证据和正品\/排除证据，需要律师优先复核证据来源。?/g, "图片中既有需要关注的相似点，也有正品或授权相关信息，需要先核实材料来源。")
    .replace(/命中包装要素但缺少第三方主体，不能仅凭权利产品特征推定侵权。?/g, "包装外观有相似点，但未看到非习酒方信息，不能仅凭正品包装特征判断侵权。")
    .replace(/图片命中正品图库，但同时识别到第三方主体或异常标识。?/g, "图片与正品参考图接近，但同时出现非习酒方信息，需要核实是否授权。")
    .replace(/存在第三方主体，但受保护包装要素不足，需要补充瓶身\/酒盒清晰图。?/g, "看到非习酒方信息，但包装细节不足，需要补充瓶身或酒盒清晰图。")
    .replace(/建议先由律师复核冲突证据/g, "建议律师先核实材料来源和授权情况")
    .replace(/复核冲突证据/g, "核实材料来源和授权情况")
    .replace(/冲突复核/g, "重点确认")
    .replace(/线索风险评分/g, "可疑程度")
    .replace(/疑似侵权概率/g, "可疑程度");
}

function CompactList({ items = [], limit = 3 }) {
  const visibleItems = uniqueItems(items.map(plainReportText)).slice(0, limit);
  if (!visibleItems.length) return null;
  return (
    <ul className="compact-list">
      {visibleItems.map((item, index) => (
        <li key={`${item}-${index}`}>{shortText(item, 70)}</li>
      ))}
    </ul>
  );
}

function uniqueItems(items = []) {
  const seen = new Set();
  return items
    .map((item) => String(item || "").trim())
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function CaseGrid({ cases = [] }) {
  if (!cases.length) {
    return (
      <div className="tag-row">
        <span className="pill">暂无匹配</span>
      </div>
    );
  }
  return (
    <div className="case-grid">
      {cases.map((item, index) => (
        <article className="case-card" key={item.id || `${item.title}-${index}`}>
          <img src={item.image} alt="" loading="lazy" />
          <div>
            <strong>{item.title}</strong>
            <span>{shortText(item.holding, 46)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function AnalysisProgress({ active, stage = 0 }) {
  if (!active) return null;
  const current = Math.min(stage, analysisSteps.length - 1);
  const percent = analysisSteps[current]?.percent || 0;
  return (
    <div className="analysis-progress">
      <div className="progress-head">
        <strong>处理进度</strong>
        <span>{percent}%</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="progress-steps">
        {analysisSteps.map((item, index) => {
          const status = index < current ? "done" : index === current ? "active" : "pending";
          return (
            <div className={`progress-step ${status}`} key={item.title}>
              <span className="step-dot" />
              <div>
                <strong>{item.title}</strong>
                <small>{status === "done" ? "已完成" : item.note}</small>
              </div>
            </div>
          );
        })}
      </div>
      <div className="progress-models">
        <span>图片库对照：进行中</span>
        <span>律师标准：进行中</span>
        <span>图片辅助判断：按需启用</span>
      </div>
    </div>
  );
}

function StructuredCriteria({ matches = [], documentMatches = [], evidence }) {
  const criteria = matches.length ? matches : [];
  const documentRules = documentMatches.length ? documentMatches : [];
  const vectorMatch = evidence?.imageVectorMatch;
  if (!criteria.length && !documentRules.length && !vectorMatch) {
    return null;
  }
  return (
    <div className="criteria-list">
      {vectorMatch ? (
        <div className="criterion-row">
          <strong>{vectorMatch.side === "authentic" ? "相似正品图片参考" : "相似问题图片参考"}</strong>
          <span>{shortText(`${vectorMatch.sampleTitle || "样本"} ${vectorMatch.similarity ? `${vectorMatch.similarity}%` : ""}`, 60)}</span>
        </div>
      ) : null}
      {criteria.map((item) => (
        <div className="criterion-row" key={item.id}>
          <strong>{item.label}</strong>
          <span>{item.evidence?.length ? shortText(item.evidence.join("、"), 70) : shortText(item.legalMeaning, 70)}</span>
        </div>
      ))}
      {documentRules.map((item) => (
        <div className="criterion-row document-rule" key={item.id}>
          <strong>{item.label}</strong>
          <span>{item.evidence?.length ? shortText(item.evidence.join("、"), 70) : shortText(item.legalMeaning, 70)}</span>
        </div>
      ))}
    </div>
  );
}

function plainEvidenceItems(items = []) {
  return items.map((item) => `${item.label}${item.evidence?.length ? `：${item.evidence.join("、")}` : ""}`);
}

function imageReferenceReason(vector) {
  if (!vector || vector.side !== "accused") return "";
  return `参考图库中有外观接近的问题图片${vector.similarity ? `，相似度约 ${vector.similarity}%` : ""}；该项只能提示需要重点比对，不能单独作为侵权结论。`;
}

function cleanHighRiskReason(item = "") {
  const text = String(item || "");
  if (!text) return "";
  if (/产品身份进入|线索身份/.test(text)) {
    return "当前材料被归入需要重点关注的对象，建议核对是否存在仿冒标识、非授权销售或与律师样本一致的外观细节。";
  }
  if (/文件名|线索标题/.test(text)) return "";
  return text
    .replace(/命中/g, "符合")
    .replace(/第三方主体/g, "非习酒方信息")
    .replace(/受保护包装要素/g, "包装相似点");
}

function lawyerViewReasons(sections, side) {
  const structured = sections?.structuredEvidence || {};
  const decision = sections?.evidenceDecision || {};
  const official = structured.officialSignals || [];
  const thirdParty = structured.thirdPartySignals || [];
  const protectedElements = structured.protectedElementsMatched || [];
  const vector = structured.imageVectorMatch || null;
  const high = decision.highRiskEvidence || [];
  const low = decision.lowRiskEvidence || [];
  const hasSource = sections?.basicInfo?.sourceUrl && sections.basicInfo.sourceUrl !== "未提供";

  if (side === "low") {
    const modelUnavailable = /超时|调用失败|未配置|兜底/.test(String(sections?.modelUsed || sections?.modelError || ""));
    return uniqueItems([
      official.length ? `图片里有正品或官方相关信息：${official.join("、")}。` : "",
      !thirdParty.length ? "没有看到其他厂家、店铺、联合出品方等非习酒官方信息。" : "",
      "没有发现律师资料中已确认的问题产品名称、仿冒标识或搭便车文字。",
      modelUnavailable ? "本次图片辅助识别未完整返回，当前低风险判断主要来自律师标准和本地知识库的排除规则。" : "",
      !hasSource ? "目前没有商品链接、店铺页面、购买记录等销售来源材料；如要进入案件判断，还需要补充来源证据。" : "",
      protectedElements.length && !thirdParty.length ? "即使包装元素与习酒正品相似，也需要先确认是否存在非授权销售或仿冒使用。" : "",
      ...plainEvidenceItems(low).filter((item) => !/文件名|线索标题|只有图片|产品身份更接近/.test(item))
    ]);
  }

  return uniqueItems([
    imageReferenceReason(vector),
    thirdParty.length ? `图片里出现了非习酒官方的信息：${thirdParty.join("、")}。` : "",
    protectedElements.length ? `包装上有这些相似点需要重点看：${protectedElements.join("、")}。` : "",
    ...plainEvidenceItems(high).map(cleanHighRiskReason),
    sections?.conclusion && !high.length && !thirdParty.length && !protectedElements.length ? sections.conclusion : ""
  ]).slice(0, 5);
}

function lawyerReviewFocus(sections) {
  const decision = sections?.evidenceDecision || {};
  const structured = sections?.structuredEvidence || {};
  const thirdParty = structured.thirdPartySignals || [];
  const protectedElements = structured.protectedElementsMatched || [];
  const gaps = sections?.evidenceGaps || [];
  const questions = sections?.lawyerReviewQuestions || [];
  return uniqueItems([
    thirdParty.length ? "核实图片中的非习酒方信息是否真实、是否有授权关系。" : "",
    protectedElements.length ? "对照正品和问题样本，重点看瓶型、瓶盖、酒盒布局、图案位置等细节是否足以造成混淆。" : "",
    "确认销售主体、商品链接、店铺页面、购买记录等证据能否固定。",
    "判断是否需要线下购买、实物取证或进一步鉴定。",
    ...(decision.reviewFocus || []),
    ...gaps,
    ...questions
  ]).slice(0, 4);
}

function EvidenceDecision({ sections }) {
  const decision = sections?.evidenceDecision;
  if (!decision) return null;
  const conflicts = decision.conflictPoints || [];
  const isLowRisk = sections?.riskLevel === "低风险";
  const primaryTitle = isLowRisk ? "低风险理由" : "高风险理由";
  const secondaryTitle = isLowRisk ? "仍需核实的地方" : "建议律师重点核实";
  const primaryItems = isLowRisk ? lawyerViewReasons(sections, "low") : lawyerViewReasons(sections, "high");
  const secondaryItems = isLowRisk ? lawyerViewReasons(sections, "high") : lawyerReviewFocus(sections);
  return (
    <div className="decision-grid">
      <div className="decision-head">
        <strong>{displayDecisionLabel(decision.decisionLabel)}</strong>
        <span>说明当前判断依据</span>
      </div>
      {conflicts.length ? (
        <div className="decision-section conflict">
          <strong>需要确认的关键问题</strong>
          <CompactList items={conflicts} limit={4} />
        </div>
      ) : null}
      <div className="decision-columns">
        <div className="decision-section">
          <strong>{primaryTitle}</strong>
          <CompactList items={primaryItems} limit={4} />
        </div>
        {secondaryItems.length ? (
          <div className="decision-section">
            <strong>{secondaryTitle}</strong>
            <CompactList items={secondaryItems} limit={4} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActionPlan({ gaps = [], suggestions = [] }) {
  const nextGaps = uniqueItems(gaps).slice(0, 3);
  const nextSuggestions = uniqueItems(suggestions).slice(0, 3);
  if (!nextGaps.length && !nextSuggestions.length) return null;
  return (
    <div className="report-block">
      <h3>接下来怎么做</h3>
      <div className="next-action-grid">
        {nextSuggestions.length ? (
          <div className="next-action-card">
            <strong>建议做法</strong>
            <CompactList items={nextSuggestions} limit={3} />
          </div>
        ) : null}
        {nextGaps.length ? (
          <div className="next-action-card">
            <strong>还缺什么材料</strong>
            <CompactList items={nextGaps} limit={3} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function displayLayerName(name = "") {
  const text = String(name || "");
  if (text === "样本比对") return "图库参考";
  if (text === "第三方主体") return "非习酒方信息";
  if (text === "核心包装要素") return "包装相似点";
  if (text === "正品排除信号") return "正品/授权信号";
  return text;
}

function displayLayerResult(layer) {
  const name = String(layer?.name || "");
  const result = String(layer?.result || "");
  if (name === "样本比对" || name === "图库参考") {
    const similarity = result.match(/(\d+(?:\.\d+)?)%/)?.[1];
    if (/找到相似|相似.*样本|相似.*图片/.test(result)) {
      return `找到外观相似参考图${similarity ? ` ${similarity}%` : ""}，仅作参考，不能单独说明真假或侵权`;
    }
  }
  if (result === "未识别") return "暂未看到";
  if (result === "缺少") return "暂未提供";
  return result;
}

function hasUsefulLayerResult(layer) {
  const result = displayLayerResult(layer);
  return result && !["暂未看到", "暂未提供", "未识别", "缺少"].includes(result);
}

function DecisionPath({ layers = [] }) {
  const visibleLayers = layers.filter(hasUsefulLayerResult).slice(0, 4);
  if (!visibleLayers.length) return null;
  return (
    <div className="report-block">
      <h3>判断过程</h3>
      <div className="layer-list">
        {visibleLayers.map((item) => (
          <div className="layer-row" key={item.name}>
            <span>{displayLayerName(item.name)}</span>
            <strong>{shortText(displayLayerResult(item), 62)}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function BasisSummary({ sections }) {
  const structured = sections?.structuredEvidence || {};
  const modelText = String(sections?.modelUsed || sections?.modelError || "");
  const modelFailed = /超时|调用失败|未配置|兜底|fetch failed|model_timeout/.test(modelText);
  const hasModelDetails = Boolean(
    !modelFailed &&
    (
      structured.detectedBrand?.length ||
      structured.detectedProductName?.length ||
      structured.officialSignals?.length ||
      structured.thirdPartySignals?.length ||
      structured.protectedElementsMatched?.length
    )
  );
  const rows = [
    {
      name: "图片识别",
      value: hasModelDetails ? "已提取图片中的品牌、文字或包装信息" : "未完整返回，本次未作为主要依据"
    },
    {
      name: "律师标准",
      value: "已对照律师整理的问题产品、正品排除和包装关注点"
    },
    {
      name: "图片库参考",
      value: structured.imageVectorMatch
        ? `找到外观相似参考图${structured.imageVectorMatch.similarity ? ` ${structured.imageVectorMatch.similarity}%` : ""}，仅作参考`
        : "未找到可直接参考的相似图片"
    },
    {
      name: "来源材料",
      value: sections?.basicInfo?.sourceUrl && sections.basicInfo.sourceUrl !== "未提供" ? "已提供链接或来源" : "暂未提供商品链接、店铺页面或购买记录"
    }
  ];

  return (
    <div className="report-block basis-summary">
      <h3>本次判断依据</h3>
      <div className="basis-list">
        {rows.map((item) => (
          <div className="basis-row" key={item.name}>
            <span>{item.name}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportView({ lead }) {
  if (!lead?.report) return null;
  const s = lead.report.sections;
  const courtFactors = (s.courtFactors || []).filter((item) => item && item !== "暂未发现明确律师关注要素");
  const hasCriteria = Boolean(
    s.structuredCriteriaMatches?.length ||
    s.documentRuleMatches?.length ||
    s.structuredEvidence?.imageVectorMatch
  );
  const probability = s.infringementProbability ?? inferScore(s.riskLevel);
  const action = s.recommendedAction || compactSuggestion(s.suggestions);
  const tone = riskTone(s.riskLevel);

  return (
    <div className="report-view">
      <div className={`hero-card ${tone}`}>
        <div className="hero-meta">
          <span>{s.basicInfo.sourceType}</span>
          <span>{s.basicInfo.sourceUrl === "未提供" ? "无链接" : "有链接"}</span>
        </div>
        <h3>{shortText(s.basicInfo.title, 34)}</h3>
        <div className="probability">
          <strong>{probability}%</strong>
          <span>可疑程度</span>
        </div>
        <div className="score-row">
          <span className={`risk ${tone}`}>{displayRiskLabel(s.riskLevel)}</span>
          <span className="tag">{action}</span>
          <span className="tag">{publicModelLabel(s.modelUsed)}</span>
        </div>
      </div>

      {lead.imageData ? (
        <div className="material-preview">
        <div>
            <h3>上传图片</h3>
            <span>{lead.imageName || lead.title}</span>
          </div>
          <img src={lead.imageData} alt={lead.imageName || lead.title || "上传图片"} />
        </div>
      ) : null}

      <div className="verdict-card">
        <h3>判断结果</h3>
        <p>{plainReportText(s.conclusion || "已生成初步判断，需要律师再确认。")}</p>
      </div>

      <BasisSummary sections={s} />

      <div className="report-block">
        <h3>为什么这样判断</h3>
        <EvidenceDecision sections={s} />
      </div>

      <DecisionPath layers={s.evidenceDecision?.layers || []} />

      <ActionPlan gaps={s.evidenceGaps} suggestions={s.suggestions} />

      <details className="report-more">
        <summary>查看更多细节</summary>
          <div className="report-block">
            <h3>认为有问题的地方</h3>
            <CompactList items={s.similarities} />
          </div>
          <div className="report-block">
            <h3>认为问题不大的地方</h3>
            <CompactList items={s.differences} />
          </div>
          {courtFactors.length ? (
            <div className="report-block">
              <h3>律师关注点</h3>
              <div className="tag-row">
                {courtFactors.map((item, index) => (
                  <span className="pill" key={`${item}-${index}`}>{item}</span>
                ))}
              </div>
            </div>
          ) : null}
          {hasCriteria ? (
            <div className="report-block">
              <h3>参考依据</h3>
              <StructuredCriteria
                matches={s.structuredCriteriaMatches}
                documentMatches={s.documentRuleMatches}
                evidence={s.structuredEvidence}
              />
            </div>
          ) : null}
        <div className="report-block">
          <h3>参考案例</h3>
          <CaseGrid cases={s.caseBasis || []} />
        </div>
        <div className="report-block">
          <h3>还要确认的问题</h3>
          <CompactList items={s.lawyerReviewQuestions} />
        </div>
        <div className="report-block">
          <h3>系统参考规则</h3>
          {s.matchedRules.length ? (
            <CompactList items={s.matchedRules.map((rule) => rule.title)} />
          ) : (
            <div className="tag-row">
              <span className="pill">暂无</span>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

export default function Page() {
  const [state, setState] = useState(initialState);
  const [analyzingId, setAnalyzingId] = useState("");
  const [historyCollapsed, setHistoryCollapsed] = useState(false);
  const [showAllHistory, setShowAllHistory] = useState(false);
  const previewRef = useRef(null);
  const leadFormRef = useRef(null);
  const feedbackFormRef = useRef(null);
  const reportPanelRef = useRef(null);

  const selectedLead = useMemo(
    () => state.leads.find((item) => item.id === state.selectedId),
    [state.leads, state.selectedId]
  );
  const visibleLeads = showAllHistory ? state.leads : state.leads.slice(0, 5);

  async function loadLeads() {
    const leads = await api("/api/leads");
    setState((current) => ({
      ...current,
      leads,
      selectedId: current.selectedId || leads[0]?.id || null
    }));
  }

  async function loadLeadDetail(id) {
    if (!id) return;
    try {
      const lead = await api(`/api/leads/${id}`);
      setState((current) => ({
        ...current,
        leads: mergeLead(current.leads, lead)
      }));
    } catch {
      // Keep the list view usable if the detail endpoint fails.
    }
  }

  useEffect(() => {
    loadLeads();
  }, []);

  useEffect(() => {
    if (selectedLead?.report && reportPanelRef.current) reportPanelRef.current.scrollTop = 0;
  }, [selectedLead?.id, selectedLead?.report]);

  useEffect(() => {
    if (selectedLead && !selectedLead.imageData && selectedLead.hasImage) loadLeadDetail(selectedLead.id);
  }, [selectedLead?.id]);

  useEffect(() => {
    const active = state.loading || Boolean(analyzingId);
    if (!active) return;
    const timer = setInterval(() => {
      setState((current) => ({
        ...current,
        progressStage: Math.min((current.progressStage || 0) + 1, analysisSteps.length - 2)
      }));
    }, 1400);
    return () => clearInterval(timer);
  }, [state.loading, analyzingId]);

  function handleImageChange(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setState((current) => ({ ...current, imageData: reader.result, imageName: file.name }));
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!state.imageData) return;
    const form = new FormData(event.currentTarget);
    setState((current) => ({ ...current, loading: true, progressStage: 0 }));
    try {
      const created = await api("/api/leads", {
        method: "POST",
        body: JSON.stringify({
          title: form.get("title") || state.imageName || "图片线索",
          brandHint: form.get("brandHint"),
          sourceType: form.get("sourceType"),
          sourceUrl: form.get("sourceUrl"),
          description: form.get("description"),
          features: [],
          imageName: state.imageName,
          imageData: state.imageData
        })
      });
      const lead = await api(`/api/leads/${created.id}/analyze`, { method: "POST", body: "{}", timeoutMs: 180000 });
      leadFormRef.current?.reset();
      setState((current) => ({
        ...current,
        leads: [lead, ...current.leads.filter((item) => item.id !== lead.id)],
        selectedId: lead.id,
        imageData: "",
        imageName: "",
        loading: false,
        progressStage: analysisSteps.length - 1
      }));
    } catch {
      alert("研判超时或失败，线索已保存。请稍后在列表中点击“重新研判”。");
      setState((current) => ({ ...current, loading: false, imageData: "", imageName: "", progressStage: 0 }));
      await loadLeads();
    }
  }

  async function selectOrAnalyze(id, shouldAnalyze = false) {
    setState((current) => ({ ...current, selectedId: id }));
    if (!shouldAnalyze) return;
    setAnalyzingId(id);
    setState((current) => ({ ...current, progressStage: 0 }));
    try {
      const lead = await api(`/api/leads/${id}/analyze`, { method: "POST", body: "{}", timeoutMs: 180000 });
      setState((current) => ({
        ...current,
        selectedId: id,
        leads: mergeLead(current.leads, lead),
        progressStage: analysisSteps.length - 1
      }));
    } catch {
      alert("研判超时或失败，请稍后重试。");
    } finally {
      setAnalyzingId("");
    }
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!state.selectedId) return;
    const form = new FormData(event.currentTarget);
    const lead = await api(`/api/leads/${state.selectedId}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating: form.get("rating"), note: form.get("note") })
    });
    setState((current) => ({
      ...current,
      leads: current.leads.map((item) => (item.id === lead.id ? lead : item))
    }));
    feedbackFormRef.current?.reset();
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">IP</span>
          <div>
            <h1>图片判断工具</h1>
            <p>上传图片，查看是否需要重点关注以及原因</p>
          </div>
        </div>
        <nav className="topnav" aria-label="系统入口">
          <a className="active" href="/">客户端</a>
          <a href="/admin">管理端</a>
        </nav>
        <div className="boundary">仅供参考</div>
      </header>

      <main className={`shell ${historyCollapsed ? "history-collapsed" : ""}`}>
        <section className="panel intake">
          <div className="section-head">
            <h2>上传</h2>
            <span>一张图即可</span>
          </div>
          <form ref={leadFormRef} onSubmit={handleSubmit}>
            <label className="dropzone" htmlFor="imageInput">
              <span className="drop-title">点击上传图片</span>
              <span className="drop-copy">酒瓶、酒盒、商品图、门头图均可</span>
              <input id="imageInput" type="file" accept="image/*" required onChange={handleImageChange} />
            </label>
            {state.imageData ? <img ref={previewRef} className="preview" src={state.imageData} alt="" /> : null}

            <details className="optional-fields">
              <summary>补充信息（可不填）</summary>
              <label>
                名称
                <input name="title" placeholder="默认使用图片文件名" />
              </label>
              <label>
                可能涉及的产品/品牌
                <input name="brandHint" placeholder="例：窖藏1988 / 君品习酒" />
              </label>
              <label>
                来源链接
                <input name="sourceUrl" placeholder="商品页 / 店铺页 / POI" />
              </label>
              <input name="sourceType" type="hidden" value="图片材料" />
              <textarea name="description" rows={3} placeholder="其他说明，可不填" />
            </details>

            <AnalysisProgress active={state.loading || Boolean(analyzingId)} stage={state.progressStage} />

            <button className="primary" type="submit" disabled={state.loading}>
              {state.loading ? "判断中..." : "上传并判断"}
            </button>
          </form>
        </section>

        <section className="panel report" ref={reportPanelRef}>
          <div className="section-head">
            <h2>结果</h2>
            <span>{selectedLead ? (selectedLead.report ? "已判断" : "待判断") : "未选择图片"}</span>
          </div>
          <ReportView lead={selectedLead} />
          {selectedLead?.report ? (
            <form ref={feedbackFormRef} className="feedback" onSubmit={submitFeedback}>
              <h3>律师反馈</h3>
              <select name="rating">
                <option>判断合理</option>
                <option>风险偏高</option>
                <option>风险偏低</option>
                <option>需要补证</option>
                <option>暂时不用处理</option>
              </select>
              <textarea name="note" rows={3} placeholder="补充律师经验、证据要求或判断标准" />
              <button type="submit">保存反馈</button>
            </form>
          ) : null}
        </section>

        <section className={`panel list ${historyCollapsed ? "collapsed" : ""}`}>
          <div className="section-head">
            <h2>最近</h2>
            <span>{state.leads.length} 条</span>
            <button
              type="button"
              className="ghost-toggle"
              onClick={() => setHistoryCollapsed((value) => !value)}
              title={historyCollapsed ? "展开最近记录" : "收起最近记录"}
            >
              {historyCollapsed ? "展开" : "收起"}
            </button>
          </div>
          {!historyCollapsed ? (
            <>
              <div className="lead-list">
                {visibleLeads.map((lead) => (
                  <article
                    className={`lead-card ${lead.id === state.selectedId ? "active" : ""}`}
                    key={lead.id}
                    onClick={() => selectOrAnalyze(lead.id)}
                  >
                    <div className="lead-card-main">
                      <div className="lead-thumb" aria-hidden="true">
                        {lead.imageThumbnail || lead.imageData ? <img src={lead.imageThumbnail || lead.imageData} alt="" loading="lazy" /> : <span>无图</span>}
                      </div>
                      <div className="lead-card-text">
                        <h3>{lead.title}</h3>
                        <div className="lead-meta">
                          <span className="pill">{lead.sourceType}</span>
                          <span className="pill status-dot">{lead.status}</span>
                          <span>{fmtTime(lead.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <div className="card-actions">
                      <button type="button" onClick={(event) => { event.stopPropagation(); selectOrAnalyze(lead.id); }}>
                        查看
                      </button>
                      <button
                        type="button"
                        disabled={analyzingId === lead.id}
                        onClick={(event) => { event.stopPropagation(); selectOrAnalyze(lead.id, true); }}
                      >
                        {analyzingId === lead.id ? "判断中..." : "重新判断"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {state.leads.length > 5 ? (
                <div className="history-more">
                  <button type="button" onClick={() => setShowAllHistory((value) => !value)}>
                    {showAllHistory ? "收起到最近 5 条" : `显示全部 ${state.leads.length} 条`}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </main>
    </>
  );
}
