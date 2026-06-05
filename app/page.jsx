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
  { title: "上传素材", note: "读取图片并创建线索", percent: 10 },
  { title: "图片相似比对", note: "比对正品样本和高风险样本", percent: 30 },
  { title: "图片内容识别", note: "必要时提取品牌、包装要素和主体信息", percent: 55 },
  { title: "律师规则研判", note: "按律师文档规则计算线索风险", percent: 75 },
  { title: "证据冲突检查", note: "区分高风险依据和排除依据", percent: 90 },
  { title: "生成报告", note: "整理结论、判断依据和补证建议", percent: 100 }
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
  if (joined.includes("重点复核") || joined.includes("线下取证")) return "重点复核";
  if (joined.includes("补充")) return "补充材料";
  return "人工复核";
}

function publicModelLabel(value = "") {
  const text = String(value || "");
  if (!text || text.includes("模型响应超时") || text.includes("调用失败") || text.includes("未配置")) return "规则初筛";
  if (text.includes("视觉大模型") || text.includes("阿里云模型")) return "图片识别辅助";
  return "规则初筛";
}

function riskTone(riskLevel) {
  if (riskLevel === "高风险") return "risk-high";
  if (riskLevel === "中风险") return "risk-mid";
  if (riskLevel === "低风险") return "risk-low";
  return "risk-pending";
}

function CompactList({ items = [], limit = 3 }) {
  return (
    <ul className="compact-list">
      {items.slice(0, limit).map((item, index) => (
        <li key={`${item}-${index}`}>{shortText(item, 70)}</li>
      ))}
    </ul>
  );
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
        <strong>研判进度</strong>
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
        <span>样本比对：进行中</span>
        <span>规则初筛：进行中</span>
        <span>图片识别辅助：按需启用</span>
      </div>
    </div>
  );
}

function StructuredCriteria({ matches = [], documentMatches = [], evidence }) {
  const criteria = matches.length ? matches : [];
  const documentRules = documentMatches.length ? documentMatches : [];
  const vectorMatch = evidence?.imageVectorMatch;
  if (!criteria.length && !documentRules.length && !vectorMatch) {
    return (
      <div className="tag-row">
        <span className="pill">暂无明确判断依据</span>
      </div>
    );
  }
  return (
    <div className="criteria-list">
      {vectorMatch ? (
        <div className="criterion-row">
          <strong>{vectorMatch.side === "authentic" ? "找到相似正品样本" : "找到相似高风险样本"}</strong>
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

function EvidenceDecision({ decision }) {
  if (!decision) return null;
  const high = decision.highRiskEvidence || [];
  const low = decision.lowRiskEvidence || [];
  const conflicts = decision.conflictPoints || [];
  const focus = decision.reviewFocus || [];
  const layers = decision.layers || [];
  return (
    <div className="decision-grid">
      <div className="decision-head">
        <strong>{decision.decisionLabel || "分层研判"}</strong>
        <span>系统分层判断</span>
      </div>
      {conflicts.length ? (
        <div className="decision-section conflict">
          <strong>冲突点</strong>
          <CompactList items={conflicts} limit={4} />
        </div>
      ) : null}
      <div className="decision-columns">
        <div className="decision-section">
          <strong>高风险依据</strong>
          <CompactList items={high.map((item) => `${item.label}${item.evidence?.length ? `：${item.evidence.join("、")}` : ""}`)} limit={4} />
        </div>
        <div className="decision-section">
          <strong>排除/低风险依据</strong>
          <CompactList items={low.map((item) => `${item.label}${item.evidence?.length ? `：${item.evidence.join("、")}` : ""}`)} limit={4} />
        </div>
      </div>
      <div className="layer-list">
        {layers.map((item) => (
          <div className="layer-row" key={item.name}>
            <span>{item.name}</span>
            <strong>{shortText(item.result, 52)}</strong>
          </div>
        ))}
      </div>
      {focus.length ? (
        <div className="decision-section">
          <strong>复核重点</strong>
          <CompactList items={focus} limit={4} />
        </div>
      ) : null}
    </div>
  );
}

function ReportView({ lead }) {
  if (!lead?.report) return null;
  const s = lead.report.sections;
  const courtFactors = s.courtFactors || ["暂未发现明确律师关注要素"];
  const probability = s.infringementProbability ?? inferScore(s.riskLevel);
  const visualSimilarity = s.visualSimilarity ?? "--";
  const confidence = s.confidence ?? "--";
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
          <span>线索风险评分</span>
        </div>
        <div className="score-row">
          <span className={`risk ${tone}`}>{s.riskLevel}</span>
          <span className="tag">{action}</span>
          <span className="tag">{publicModelLabel(s.modelUsed)}</span>
        </div>
      </div>

      {lead.imageData ? (
        <div className="material-preview">
        <div>
            <h3>上传素材</h3>
            <span>{lead.imageName || lead.title}</span>
          </div>
          <img src={lead.imageData} alt={lead.imageName || lead.title || "上传素材"} />
        </div>
      ) : null}

      <div className="summary-grid">
        <div className="metric">
          <span>图片相似比对</span>
          <strong>{visualSimilarity}%</strong>
        </div>
        <div className="metric">
          <span>参考可信度</span>
          <strong>{confidence}%</strong>
        </div>
        <div className="metric">
          <span>待补材料</span>
          <strong>{s.evidenceGaps.length}</strong>
        </div>
      </div>

      <div className="verdict-card">
        <h3>判定答案</h3>
        <p>{s.conclusion || "已生成初筛判断，需律师复核。"}</p>
      </div>

      <div className="report-block">
        <h3>分层研判</h3>
        <EvidenceDecision decision={s.evidenceDecision} />
      </div>

      <div className="report-block">
        <h3>主要风险理由</h3>
        <CompactList items={s.similarities} />
      </div>
      <div className="report-block">
        <h3>差异与排除理由</h3>
        <CompactList items={s.differences} />
      </div>
      <div className="report-block">
        <h3>权利基础</h3>
        <CompactList items={s.rightsBasis} />
      </div>
      <div className="report-block">
        <h3>律师关注要素</h3>
        <div className="tag-row">
          {courtFactors.map((item, index) => (
            <span className="pill" key={`${item}-${index}`}>{item}</span>
          ))}
        </div>
      </div>
      <div className="report-block">
        <h3>判断依据</h3>
        <StructuredCriteria
          matches={s.structuredCriteriaMatches}
          documentMatches={s.documentRuleMatches}
          evidence={s.structuredEvidence}
        />
      </div>
      <div className="report-block">
        <h3>需要补充的材料</h3>
        <CompactList items={s.evidenceGaps} />
      </div>
      <div className="report-block">
        <h3>建议动作</h3>
        <CompactList items={s.suggestions} />
      </div>

      <details className="report-more">
        <summary>查看详细依据和律师复核问题</summary>
        <div className="report-block">
          <h3>案例依据</h3>
          <CaseGrid cases={s.caseBasis || []} />
        </div>
        <div className="report-block">
          <h3>复核问题</h3>
          <CompactList items={s.lawyerReviewQuestions} />
        </div>
        <div className="report-block">
          <h3>系统规则依据</h3>
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
  const previewRef = useRef(null);
  const leadFormRef = useRef(null);
  const feedbackFormRef = useRef(null);
  const reportPanelRef = useRef(null);

  const selectedLead = useMemo(
    () => state.leads.find((item) => item.id === state.selectedId),
    [state.leads, state.selectedId]
  );

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
            <h1>客户端研判端</h1>
            <p>上传图片，查看线索风险结论和律师复核依据</p>
          </div>
        </div>
        <nav className="topnav" aria-label="系统入口">
          <a className="active" href="/">客户端</a>
          <a href="/admin">管理端</a>
        </nav>
        <div className="boundary">仅供初筛</div>
      </header>

      <main className="shell">
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
                疑似对象
                <input name="brandHint" placeholder="例：窖藏1988 / 君品习酒" />
              </label>
              <label>
                来源链接
                <input name="sourceUrl" placeholder="商品页 / 店铺页 / POI" />
              </label>
              <input name="sourceType" type="hidden" value="图片线索" />
              <textarea name="description" rows={3} placeholder="其他说明，可不填" />
            </details>

            <AnalysisProgress active={state.loading || Boolean(analyzingId)} stage={state.progressStage} />

            <button className="primary" type="submit" disabled={state.loading}>
              {state.loading ? "研判中..." : "上传并研判"}
            </button>
          </form>
        </section>

        <section className="panel report" ref={reportPanelRef}>
          <div className="section-head">
            <h2>结果</h2>
            <span>{selectedLead ? (selectedLead.report ? "已研判" : "待研判") : "未选择线索"}</span>
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
                <option>无价值线索</option>
              </select>
              <textarea name="note" rows={3} placeholder="补充律师经验、证据要求或规则说明" />
              <button type="submit">保存反馈</button>
            </form>
          ) : null}
        </section>

        <section className="panel list">
          <div className="section-head">
            <h2>最近</h2>
            <span>{state.leads.length} 条</span>
          </div>
          <div className="lead-list">
            {state.leads.map((lead) => (
              <article
                className={`lead-card ${lead.id === state.selectedId ? "active" : ""}`}
                key={lead.id}
                onClick={() => selectOrAnalyze(lead.id)}
              >
                <h3>{lead.title}</h3>
                <div className="lead-meta">
                  <span className="pill">{lead.sourceType}</span>
                  <span className="pill status-dot">{lead.status}</span>
                  <span>{fmtTime(lead.createdAt)}</span>
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
                    {analyzingId === lead.id ? "研判中..." : "重新研判"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
