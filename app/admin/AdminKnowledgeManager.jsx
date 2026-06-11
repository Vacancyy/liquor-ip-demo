"use client";

import { useMemo, useState } from "react";

const emptySource = {
  title: "",
  productName: "",
  officialSeriesName: "",
  imageUrl: "",
  thumbnailUrl: "",
  sourceUrl: "",
  sourceName: "",
  filePath: ""
};

async function requestKnowledge(options = {}) {
  const response = await fetch("/api/admin/knowledge", {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "操作失败");
  return data;
}

export default function AdminKnowledgeManager({ initialData }) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState("");
  const [sourceForm, setSourceForm] = useState(emptySource);
  const [editingId, setEditingId] = useState("");
  const [productName, setProductName] = useState("");
  const [uploadForm, setUploadForm] = useState({
    labelType: "authentic",
    title: "",
    productName: "",
    reason: "",
    file: null
  });
  const [strategyForm, setStrategyForm] = useState(initialData.judgementConfig?.strategy || {});
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  const filteredSources = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const sources = data.officialSources || [];
    if (!keyword) return sources;
    return sources.filter((item) => {
      const haystack = [item.productName, item.officialSeriesName, item.sourceName, item.sourceUrl, item.imageUrl].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [data.officialSources, query]);

  const selectedSource = useMemo(
    () => (data.officialSources || []).find((item) => item.id === editingId),
    [data.officialSources, editingId]
  );
  const strategy = data.judgementConfig?.strategy || strategyForm;
  const presetCards = data.judgementConfig?.presets || [];

  function updateForm(key, value) {
    setSourceForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(item) {
    setEditingId(item.id);
    setSourceForm({
      title: item.title || "",
      productName: item.productName || "",
      officialSeriesName: item.officialSeriesName || "",
      imageUrl: item.imageUrl || "",
      thumbnailUrl: item.thumbnailUrl || "",
      sourceUrl: item.sourceUrl || "",
      sourceName: item.sourceName || "",
      filePath: item.filePath || ""
    });
    setStatus(`正在编辑：${item.productName}`);
  }

  function resetSourceForm() {
    setEditingId("");
    setSourceForm(emptySource);
  }

  function updateUploadForm(key, value) {
    setUploadForm((current) => ({ ...current, [key]: value }));
  }

  function updateStrategyForm(key, value) {
    setStrategyForm((current) => ({ ...current, [key]: value }));
  }

  function applyPreset(mode) {
    const preset = (data.judgementConfig?.presets || []).find((item) => item.mode === mode);
    if (preset) setStrategyForm(preset);
  }

  async function submitSource(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const next = editingId
        ? await requestKnowledge({
            method: "PATCH",
            body: JSON.stringify({ type: "officialSource", id: editingId, patch: sourceForm })
          })
        : await requestKnowledge({
            method: "POST",
            body: JSON.stringify({ type: "officialSource", item: sourceForm })
          });
      setData(next);
      setStatus(editingId ? "正品来源已更新。重新生成向量库后，研判流程会使用最新来源。" : "正品来源已添加。需要重新生成向量库后才会参与图片向量匹配。");
      resetSourceForm();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteSource(item) {
    if (!window.confirm(`删除正品来源：${item.productName}？`)) return;
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/knowledge?type=officialSource&id=${encodeURIComponent(item.id)}`, { method: "DELETE" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "删除失败");
      setData(next);
      setStatus("正品来源已删除。重新生成向量库后，旧向量样本才会移出匹配库。");
      if (editingId === item.id) resetSourceForm();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function addProductName(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const next = await requestKnowledge({
        method: "POST",
        body: JSON.stringify({ type: "productName", name: productName })
      });
      setData(next);
      setProductName("");
      setStatus("结构化产品名已添加，会直接参与多模态文字识别/文本命中的正品排除信号。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload(event) {
    event.preventDefault();
    if (!uploadForm.file) {
      setStatus("请选择要上传的图片。");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      const formData = new FormData();
      formData.append("file", uploadForm.file);
      formData.append("labelType", uploadForm.labelType);
      formData.append("title", uploadForm.title);
      formData.append("productName", uploadForm.productName);
      formData.append("reason", uploadForm.reason);
      const response = await fetch("/api/admin/knowledge", { method: "POST", body: formData });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "上传失败");
      setData(next);
      setUploadForm({ labelType: "authentic", title: "", productName: "", reason: "", file: null });
      event.currentTarget.reset();
      setStatus("图片样本已上传。相同图片可立即精确命中；运行向量库构建后可参与相似图片匹配。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteProductName(name) {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/admin/knowledge?type=productName&name=${encodeURIComponent(name)}`, { method: "DELETE" });
      const next = await response.json();
      if (!response.ok) throw new Error(next.error || "删除失败");
      setData(next);
      setStatus("结构化产品名已删除。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function editProductName(name) {
    const nextName = window.prompt("修改结构化产品名", name);
    if (nextName === null || nextName.trim() === name) return;
    setBusy(true);
    setStatus("");
    try {
      const next = await requestKnowledge({
        method: "PATCH",
        body: JSON.stringify({ type: "productName", oldName: name, newName: nextName })
      });
      setData(next);
      setStatus("结构化产品名已更新。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitStrategy(event) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const next = await requestKnowledge({
        method: "PATCH",
        body: JSON.stringify({ type: "judgementStrategy", strategy: strategyForm })
      });
      setData(next);
      setStrategyForm(next.judgementConfig.strategy);
      setStatus("研判策略已保存。后续上传研判会使用新阈值；灵敏度、特异度、信度、效度需要重新跑评测后更新。");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-panel admin-management">
      <div className="admin-section-head">
        <div>
          <h2>运营控制台</h2>
          <span>策略、样本、知识库</span>
        </div>
        <button type="button" className="secondary" onClick={() => requestKnowledge().then(setData)} disabled={busy}>
          刷新
        </button>
      </div>

      <div className="admin-command-strip">
        <div className="admin-command-card accent">
          <span>当前策略</span>
          <strong>{strategy.name || "平衡模式"}</strong>
          <small>高风险阈值 {strategy.highRiskThreshold ?? 75} / 相似候选阈值 {strategy.embeddingSimilarityThreshold ?? 90}</small>
        </div>
        <div className="admin-command-card">
          <span>人工样本</span>
          <strong>{data.uploadedSamples?.length || 0} 张</strong>
          <small>上传后进入确认样本库</small>
        </div>
        <div className="admin-command-card">
          <span>正品来源</span>
          <strong>{data.officialSources?.length || 0} 条</strong>
          <small>官网/授权渠道来源</small>
        </div>
        <div className="admin-command-card">
          <span>结构化名称</span>
          <strong>{data.structuredProductNames?.length || 0} 个</strong>
          <small>参与多模态文字识别和文本命中</small>
        </div>
      </div>

      <div className="admin-crud-grid">
        <form className="admin-form upload-form" onSubmit={submitUpload}>
          <div className="admin-form-head">
            <h3>上传确认样本</h3>
            <span>正品/侵权</span>
          </div>
          <label>
            样本类型
            <select value={uploadForm.labelType} onChange={(event) => updateUploadForm("labelType", event.target.value)}>
              <option value="authentic">正品样本</option>
              <option value="accused">侵权样本</option>
            </select>
          </label>
          <label>
            图片文件
            <input type="file" accept="image/*" onChange={(event) => updateUploadForm("file", event.target.files?.[0] || null)} required />
          </label>
          <label>
            样本标题
            <input value={uploadForm.title} onChange={(event) => updateUploadForm("title", event.target.value)} placeholder="例如：律师确认侵权样本-包装正面" />
          </label>
          <label>
            产品名称
            <input value={uploadForm.productName} onChange={(event) => updateUploadForm("productName", event.target.value)} placeholder="例如：君品习酒 / 黔粮坊" />
          </label>
          <label>
            人工确认理由
            <textarea value={uploadForm.reason} onChange={(event) => updateUploadForm("reason", event.target.value)} rows={3} placeholder="例如：律师确认该图为侵权产品，应作为高风险样本。" />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            上传入库
          </button>
          <p className="admin-note inline">上传后会写入人工确认样本库；相同图片可立即哈希命中，相似图片需要重建 embedding。</p>
        </form>

        <form className="admin-form strategy-form" onSubmit={submitStrategy}>
          <div className="admin-form-head">
            <h3>研判策略配置</h3>
            <span>{strategyForm.name || "当前策略"}</span>
          </div>
          <div className="strategy-preset-grid">
            {presetCards.map((preset) => (
              <button
                type="button"
                className={`strategy-preset ${strategyForm.mode === preset.mode ? "active" : ""}`}
                key={preset.mode}
                onClick={() => applyPreset(preset.mode)}
              >
                <strong>{preset.name}</strong>
                <small>{preset.mode === "high_sensitivity" ? "少漏判" : preset.mode === "high_specificity" ? "少误判" : "折中"}</small>
              </button>
            ))}
          </div>
          <label>
            策略模式
            <select
              value={strategyForm.mode || "balanced"}
              onChange={(event) => {
                if (event.target.value === "custom") {
                  updateStrategyForm("mode", "custom");
                  updateStrategyForm("name", "自定义策略");
                } else {
                  applyPreset(event.target.value);
                }
              }}
            >
              {(data.judgementConfig?.presets || []).map((preset) => (
                <option value={preset.mode} key={preset.mode}>{preset.name}</option>
              ))}
              <option value="custom">自定义策略</option>
            </select>
          </label>
          <div className="strategy-gauge">
            <div>
              <span>高风险触发</span>
              <strong>{strategyForm.highRiskThreshold ?? 75}</strong>
              <em style={{ width: `${Math.max(0, Math.min(100, strategyForm.highRiskThreshold ?? 75))}%` }} />
            </div>
            <div>
              <span>向量匹配严格度</span>
              <strong>{strategyForm.embeddingSimilarityThreshold ?? 90}</strong>
              <em style={{ width: `${Math.max(0, Math.min(100, strategyForm.embeddingSimilarityThreshold ?? 90))}%` }} />
            </div>
          </div>
          <div className="admin-slider-grid">
            <label>
              高风险阈值
              <input type="number" min="50" max="95" value={strategyForm.highRiskThreshold ?? 75} onChange={(event) => updateStrategyForm("highRiskThreshold", event.target.value)} />
            </label>
            <label>
              低风险上限
              <input type="number" min="0" max="50" value={strategyForm.lowRiskMax ?? 29} onChange={(event) => updateStrategyForm("lowRiskMax", event.target.value)} />
            </label>
            <label>
              相似候选阈值
              <input type="number" min="75" max="99" value={strategyForm.embeddingSimilarityThreshold ?? 90} onChange={(event) => updateStrategyForm("embeddingSimilarityThreshold", event.target.value)} />
            </label>
            <label>
              视觉相似阈值
              <input type="number" min="70" max="98" value={strategyForm.visualSimilarityThreshold ?? 88} onChange={(event) => updateStrategyForm("visualSimilarityThreshold", event.target.value)} />
            </label>
            <label>
              正品保护权重
              <input type="number" min="-100" max="-20" value={strategyForm.authenticProtectionScore ?? -70} onChange={(event) => updateStrategyForm("authenticProtectionScore", event.target.value)} />
            </label>
            <label>
              高风险样本权重
              <input type="number" min="60" max="100" value={strategyForm.confirmedAccusedScore ?? 90} onChange={(event) => updateStrategyForm("confirmedAccusedScore", event.target.value)} />
            </label>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            保存策略
          </button>
          <p className="admin-note inline">策略参数会影响后续研判；灵敏度、特异度、信度、效度仍由测试结果自动计算。</p>
        </form>

        <form className="admin-form" onSubmit={submitSource}>
          <div className="admin-form-head">
            <h3>{editingId ? "编辑正品来源" : "新增正品来源"}</h3>
            {editingId ? (
              <button type="button" className="secondary" onClick={resetSourceForm}>
                取消编辑
              </button>
            ) : null}
          </div>
          <label>
            产品名称
            <input value={sourceForm.productName} onChange={(event) => updateForm("productName", event.target.value)} placeholder="例如：君品习酒" required />
          </label>
          <label>
            产品系列
            <input value={sourceForm.officialSeriesName} onChange={(event) => updateForm("officialSeriesName", event.target.value)} placeholder="例如：君品系列" />
          </label>
          <label>
            图片地址
            <input value={sourceForm.imageUrl} onChange={(event) => updateForm("imageUrl", event.target.value)} placeholder="https://..." required />
          </label>
          <label>
            来源页面
            <input value={sourceForm.sourceUrl} onChange={(event) => updateForm("sourceUrl", event.target.value)} placeholder="https://..." />
          </label>
          <label>
            标题
            <input value={sourceForm.title} onChange={(event) => updateForm("title", event.target.value)} placeholder="管理端显示标题，可不填" />
          </label>
          <label>
            本地文件路径
            <input value={sourceForm.filePath} onChange={(event) => updateForm("filePath", event.target.value)} placeholder="下载后本地图片路径，可不填" />
          </label>
          <button type="submit" className="primary" disabled={busy}>
            {editingId ? "保存修改" : "添加来源"}
          </button>
          <p className="admin-note inline">新增或删除正品图片来源后，需要运行 `npm run build:image-library:embedding`，新的图片才会进入向量检索。</p>
        </form>

        <div className="admin-query-panel">
          <div className="admin-form-head">
            <h3>正品来源库</h3>
            <span>{filteredSources.length}/{data.officialSources?.length || 0} 条</span>
          </div>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按产品名、系列、来源链接查询" />
          <div className="admin-source-list">
            {filteredSources.slice(0, 80).map((item) => (
              <article className={`admin-source-card ${item.id === editingId ? "selected" : ""}`} key={item.id}>
                <div>
                  <strong>{item.productName}</strong>
                  <span>{item.officialSeriesName || "未设置系列"}</span>
                  <small>{item.labelSource === "admin_manual" ? "人工维护，待构建向量" : "官网来源，已进入构建流程"}</small>
                </div>
                <div className="admin-inline-actions">
                  <button type="button" onClick={() => startEdit(item)}>
                    编辑
                  </button>
                  <button type="button" className="danger" onClick={() => deleteSource(item)} disabled={busy}>
                    删除
                  </button>
                </div>
              </article>
            ))}
            {!filteredSources.length ? <p className="admin-empty">没有匹配的正品来源。</p> : null}
            {filteredSources.length > 80 ? <p className="admin-empty">已显示前 80 条，请用搜索缩小范围。</p> : null}
          </div>
        </div>

        <div className="admin-query-panel product-names">
          <div className="admin-form-head">
            <h3>结构化正品产品名</h3>
            <span>{data.structuredProductNames?.length || 0} 个</span>
          </div>
          <form className="admin-inline-form" onSubmit={addProductName}>
            <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="新增多模态文字识别/文本可命中的正品名称" />
            <button type="submit" className="primary" disabled={busy}>
              添加
            </button>
          </form>
          <div className="admin-chip-list">
            {(data.structuredProductNames || []).map((name) => (
              <span className="admin-chip" key={name}>
                {name}
                <button type="button" aria-label={`编辑 ${name}`} onClick={() => editProductName(name)} disabled={busy}>
                  改
                </button>
                <button type="button" aria-label={`删除 ${name}`} onClick={() => deleteProductName(name)} disabled={busy}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <p className="admin-note inline">产品名库不需要重新生成向量，会在多模态文字识别结果、文字线索和规则解释中直接生效。</p>
        </div>

        <div className="admin-query-panel">
          <div className="admin-form-head">
            <h3>已上传样本</h3>
            <span>{data.uploadedSamples?.length || 0} 张</span>
          </div>
          <div className="admin-source-list compact">
            {(data.uploadedSamples || []).slice(0, 60).map((item) => (
              <article className="admin-source-card" key={item.id}>
                <div>
                  <strong>{item.title || item.productName || item.id}</strong>
                  <span>{item.category === "authentic_product_confirmed" ? "正品样本" : "侵权样本"}</span>
                  <small>{item.filePath}</small>
                </div>
                <small className={item.expectedRiskLevel === "高风险" ? "risk-text high" : "risk-text low"}>{item.expectedRiskLevel}</small>
              </article>
            ))}
            {!data.uploadedSamples?.length ? <p className="admin-empty">暂无管理端上传样本。</p> : null}
          </div>
        </div>

        <div className="admin-query-panel">
          <div className="admin-form-head">
            <h3>维护动作清单</h3>
            <span>后台职责</span>
          </div>
          <ul className="admin-list compact-list">
            <li>查询：按产品名、系列、来源链接快速定位正品来源。</li>
            <li>新增：补充官网、授权渠道或律师确认的正品来源。</li>
            <li>编辑：修正名称、系列、图片地址、来源页面和本地路径。</li>
            <li>删除：移除错误来源，重建向量库后同步影响研判。</li>
            <li>复核：误判样本后续可回流为正品样本或侵权样本。</li>
          </ul>
          {selectedSource ? <p className="admin-note inline">当前编辑 ID：{selectedSource.id}</p> : null}
          {status ? <p className="admin-status">{status}</p> : null}
        </div>
      </div>
    </section>
  );
}
