const elements = Object.fromEntries([
  "tenantLabel", "windowSelect", "refreshButton", "snapshotTime", "healthBadge", "notice",
  "queueCount", "queueLanes", "runningCount", "failedCount", "avgWait", "p95Wait", "p95Latency",
  "feedbackCoverage", "recognitionCount", "successRate", "acceptRate", "editRate", "rejectRate",
  "pricingCoverage", "costGrid", "providerCalls", "tokenCount", "totalCost", "costPerCard"
].map((id) => [id, document.querySelector(`#${id}`)]));

const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const percent = new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 4 });

function number(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function count(value) {
  const parsed = number(value);
  return parsed === null ? "—" : integer.format(parsed);
}

function rate(value) {
  const parsed = number(value);
  return parsed === null ? "—" : percent.format(parsed);
}

function duration(value) {
  const parsed = number(value);
  if (parsed === null) return "—";
  if (parsed < 1000) return `${Math.round(parsed)} ms`;
  return `${(parsed / 1000).toFixed(parsed < 10_000 ? 1 : 0)} s`;
}

function money(value, configured = true) {
  const parsed = number(value);
  if (!configured || parsed === null) return "未配置";
  return usd.format(parsed);
}

function setMetricDetail(element, value) {
  const detail = element?.closest?.("article")?.querySelector?.("small");
  if (detail) detail.textContent = value;
}

function setHealth(snapshot) {
  const queue = snapshot.queue || {};
  const failed = number(queue.failed_final) || 0;
  const queued = number(queue.queued) || 0;
  const state = failed > 0 || queued > 100 ? "attention" : "healthy";
  elements.healthBadge.dataset.state = state;
  elements.healthBadge.textContent = state === "healthy" ? "运行正常" : "需要关注";
}

function render(snapshot) {
  const queue = snapshot.queue || {};
  const ai = snapshot.ai || {};
  const feedback = snapshot.feedback || {};
  const cost = snapshot.cost || {};
  const coverage = snapshot.coverage || {};

  elements.snapshotTime.textContent = snapshot.generated_at
    ? `快照生成于 ${new Date(snapshot.generated_at).toLocaleString("zh-CN")}`
    : "快照时间不可用。";
  elements.queueCount.textContent = count(queue.queued);
  elements.queueLanes.textContent = [
    `interactive ${count(queue.interactive_queued)}`,
    `background ${count(queue.background_queued)}`,
    `窗口完成 ${count(queue.completed)}`,
    `重试 ${count(queue.retry_count)}`
  ].join(" · ");
  elements.runningCount.textContent = count(queue.running);
  elements.failedCount.textContent = count(queue.failed_final);
  setMetricDetail(elements.failedCount, `可重试失败 ${count(queue.retryable_failed)}`);
  elements.avgWait.textContent = duration(queue.average_wait_ms);
  setMetricDetail(elements.avgWait, `p50 ${duration(queue.p50_wait_ms)} · created → started`);
  elements.p95Wait.textContent = duration(queue.p95_wait_ms);
  elements.p95Latency.textContent = duration(queue.p95_writer_visible_latency_ms);
  setMetricDetail(
    elements.p95Latency,
    `p50 ${duration(queue.p50_writer_visible_latency_ms)} · created → writer ready`
  );

  elements.recognitionCount.textContent = count(ai.recognition_count);
  elements.successRate.textContent = rate(ai.success_rate);
  elements.acceptRate.textContent = rate(feedback.accept_rate);
  elements.editRate.textContent = rate(feedback.edit_rate);
  elements.rejectRate.textContent = rate(feedback.reject_rate);
  elements.feedbackCoverage.textContent = `反馈覆盖率 ${rate(coverage.feedback_rate)}`;

  const costVisible = cost.visible !== false;
  elements.costGrid.hidden = !costVisible;
  elements.pricingCoverage.textContent = costVisible
    ? `费率覆盖 ${rate(coverage.pricing_rate)}`
    : "仅 Owner 可查看费用";
  if (costVisible) {
    elements.providerCalls.textContent = count(cost.provider_calls);
    elements.tokenCount.textContent = count(cost.total_tokens);
    elements.totalCost.textContent = money(cost.estimated_cost_usd, cost.cost_configured === true);
    elements.costPerCard.textContent = money(cost.average_cost_per_successful_card_usd, cost.cost_configured === true);
  }
  setHealth(snapshot);
}

async function loadSession() {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  const session = await response.json();
  if (!response.ok || !session.authenticated) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    return false;
  }
  elements.tenantLabel.textContent = [session.tenant_name || session.tenant_id, session.role].filter(Boolean).join(" · ") || "已登录";
  return true;
}

async function refresh() {
  elements.refreshButton.disabled = true;
  elements.notice.textContent = "正在读取最新快照…";
  elements.healthBadge.dataset.state = "loading";
  elements.healthBadge.textContent = "读取中";
  try {
    const params = new URLSearchParams({ window_hours: elements.windowSelect.value });
    const response = await fetch(`/api/v4/ops-snapshot?${params}`, { credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false || !payload.snapshot) {
      throw new Error(payload.message || "运营快照暂时不可用。");
    }
    render(payload.snapshot);
    elements.notice.textContent = "";
  } catch (error) {
    elements.healthBadge.dataset.state = "attention";
    elements.healthBadge.textContent = "读取失败";
    elements.notice.textContent = String(error?.message || "运营快照暂时不可用。");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

elements.refreshButton.addEventListener("click", refresh);
elements.windowSelect.addEventListener("change", refresh);

if (await loadSession()) await refresh();
