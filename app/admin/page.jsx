import AdminKnowledgeManager from "./AdminKnowledgeManager.jsx";
import { getAdminKnowledge } from "../../lib/admin-knowledge.js";

function MetricCard({ title, value, note, tone = "" }) {
  const numeric = Number(String(value).replace("%", ""));
  const hasMeter = Number.isFinite(numeric) && String(value).includes("%");
  return (
    <div className={`admin-metric ${tone}`}>
      <span>{title}</span>
      <strong>{value}</strong>
      {hasMeter ? (
        <div className="metric-meter" aria-hidden="true">
          <i style={{ width: `${Math.max(0, Math.min(100, numeric))}%` }} />
        </div>
      ) : null}
      <p>{note}</p>
    </div>
  );
}

function StatusTable({ rows }) {
  return (
    <div className="admin-table">
      {rows.map((row) => (
        <div className="admin-row" key={row.name}>
          <span>{row.name}</span>
          <strong>{row.value}</strong>
          <em>{row.note}</em>
        </div>
      ))}
    </div>
  );
}

export const metadata = {
  title: "管理端 - 酒类侵权线索智能研判工作台"
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const data = await getAdminKnowledge();
  const overview = data.overview;

  const knowledgeRows = [
    { name: "官网正品来源清单", value: `${overview.officialSources} 条`, note: data.files.officialSources.updatedAt },
    { name: "图片向量样本库", value: `${overview.totalSamples} 张`, note: data.files.imageLibrary.updatedAt },
    { name: "结构化正品产品名", value: `${overview.structuredProductNames} 个`, note: data.files.authenticProducts.updatedAt },
    {
      name: "律师文档结构化规则",
      value: `${data.structuredRules.protectedElements} 个要素`,
      note: `${data.structuredRules.legalReasoningRules} 条裁判规则`
    }
  ];

  const seriesRows = data.series.map((series) => ({
    name: series.name,
    value: `${series.count} 张`,
    note: "官网主销产品图"
  }));

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">IP</span>
          <div>
            <h1>管理端</h1>
            <p>维护知识库、查看测试表现和系统状态</p>
          </div>
        </div>
        <nav className="topnav" aria-label="系统入口">
          <a href="/">客户端</a>
          <a className="active" href="/admin">管理端</a>
        </nav>
        <div className="boundary">内部维护</div>
      </header>

      <main className="admin-shell">
        <section className="admin-hero">
          <div>
            <span>后台工作台</span>
            <h2>知识库运营、策略调节和样本回流集中管理</h2>
            <p>当前策略：{data.judgementConfig.strategy.name}。高风险阈值 {data.judgementConfig.strategy.highRiskThreshold}，向量相似阈值 {data.judgementConfig.strategy.embeddingSimilarityThreshold}。</p>
          </div>
          <div className="admin-hero-panel">
            <div>
              <span>样本总量</span>
              <strong>{overview.totalSamples}</strong>
            </div>
            <div>
              <span>向量覆盖</span>
              <strong>{overview.totalSamples - overview.missingEmbedding}/{overview.totalSamples}</strong>
            </div>
            <div>
              <span>策略模式</span>
              <strong>{data.judgementConfig.strategy.name}</strong>
            </div>
          </div>
        </section>

        <section className="admin-grid metrics">
          <MetricCard title="正品图片样本" value={overview.authenticSamples} note="官网/授权渠道正品图库" tone="low" />
          <MetricCard title="侵权图片样本" value={overview.accusedSamples} note="律师 Word 确认侵权样本" tone="high" />
          <MetricCard title="图片向量覆盖" value={`${overview.totalSamples - overview.missingEmbedding}/${overview.totalSamples}`} note="缺失 embedding 会影响相似检索" />
          <MetricCard title="官网主销系列" value={overview.series} note="已抓取左侧主销产品系列" />
        </section>

        <section className="admin-grid two">
          <div className="admin-panel">
            <div className="admin-section-head">
              <h2>内部测试表现</h2>
              <span>不是外部泛化承诺</span>
            </div>
            <div className="admin-grid metrics compact">
              <MetricCard title="灵敏度" value={overview.sensitivity} note={`侵权识别：${overview.sensitivityRaw.hit}/${overview.sensitivityRaw.total}`} tone="high" />
              <MetricCard title="特异度" value={overview.specificity} note={`正品排除：${overview.specificityRaw.hit}/${overview.specificityRaw.total}`} tone="low" />
              <MetricCard title="信度" value={overview.reliability} note={overview.reliabilityRaw.label} />
              <MetricCard title="效度" value={overview.validity} note={overview.validityRaw.label} />
            </div>
            <p className="admin-note">
              灵敏度、特异度、信度和效度是评测结果，不应手工填写；管理端可调整的是研判策略，调整后需要重新评测这些指标。
            </p>
          </div>

          <div className="admin-panel">
            <div className="admin-section-head">
              <h2>知识库概览</h2>
              <span>文件状态</span>
            </div>
            <StatusTable rows={knowledgeRows} />
          </div>
        </section>

        <AdminKnowledgeManager initialData={data} />

        <section className="admin-grid two">
          <div className="admin-panel">
            <div className="admin-section-head">
              <h2>官网正品系列</h2>
              <span>{overview.officialSources} 张图</span>
            </div>
            <StatusTable rows={seriesRows} />
          </div>

          <div className="admin-panel">
            <div className="admin-section-head">
              <h2>管理端后续能力</h2>
              <span>可继续迭代</span>
            </div>
            <ul className="admin-list">
              <li>误判样本一键回流到正品库或侵权库。</li>
              <li>律师规则可视化编辑和版本留痕。</li>
              <li>向量库重建任务队列、进度和失败重试。</li>
              <li>批量 Excel 线索导入、批量研判和导出报告。</li>
              <li>角色权限区分：客户查看、律师复核、管理员维护。</li>
            </ul>
          </div>
        </section>
      </main>
    </>
  );
}
