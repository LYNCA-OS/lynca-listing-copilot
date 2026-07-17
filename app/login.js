import {
  normalizeLegacyUsername,
  safeAppRedirectPath
} from "./login-flow.mjs";

const form = document.querySelector("#listingLoginForm");
const error = document.querySelector("#loginError");
const submitButton = document.querySelector("#loginButton");
const params = new URLSearchParams(window.location.search);
const inviteToken = params.get("invite_token") || "";

function redirectPath() {
  return safeAppRedirectPath(params.get("next"), window.location.origin);
}

function normalizeLoginError(payload, status, rawText) {
  const text = String(rawText ?? "").toLowerCase();
  if (text.includes("atomic_enqueue_job_identity_invalid")) {
    return "登录后端队列身份校验异常（atomic_enqueue_job_identity_invalid），请稍后再试。";
  }

  if (text.includes("pgrst202")) {
    return "服务端 RPC 未配置（PGRST202），请联系管理员检查接口权限。";
  }

  if (text.includes("atomic_enqueue_rpc_failed")) {
    return "服务端队列任务提交失败（atomic_enqueue_rpc_failed），请稍后重试。";
  }

  if (typeof payload?.message === "string" && payload.message.trim()) {
    if (payload.message.includes("Invalid request.")) return "请求参数异常，请检查输入后重试。";
    if (payload.message.includes("Request is too large.")) return "请求参数过长，请缩短输入后重试。";
    return payload.message;
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }

  if (typeof rawText === "string" && rawText.includes("<html")) {
    return `登录请求被拦截（HTTP ${status}）。请确认部署访问凭据后重试。`;
  }

  if (status === 401) {
    return "账号或密码不正确。";
  }

  if (status === 404) {
    return "登录接口暂时不可访问（404）。请确认部署配置或稍后再试。";
  }

  if (status >= 500) {
    return "登录服务暂时不可用，请稍后再试。";
  }

  return `登录失败（HTTP ${status}）。`;
}

function parseResponsePayload(rawPayload) {
  if (!rawPayload.trim()) {
    return { data: {}, parseFailed: true };
  }

  try {
    return { data: JSON.parse(rawPayload), parseFailed: false };
  } catch {
    return { data: {}, parseFailed: true };
  }
}

async function redirectIfAuthenticated() {
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store"
    });
    if (!response.ok) return;
    const session = await response.json();
    if (session.authenticated) {
      window.location.replace(redirectPath());
    }
  } catch {
    // Stay on the login page when the local prototype server is unavailable.
  }
}

redirectIfAuthenticated();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  error.textContent = "";

  const username = normalizeLegacyUsername(form.username.value);
  const password = form.password.value;
  const tenantId = form.tenant_id?.value || "";
  let navigationStarted = false;

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "登录中…";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        username,
        password,
        tenant_id: tenantId || undefined,
        invite_token: inviteToken
      })
    });
    const rawPayload = await response.text();
    const parsed = parseResponsePayload(rawPayload);
    const result = parsed.data;

    if (!response.ok || !result.ok) {
      const resultCode = result?.code || result?.error_code;
      if (parsed.parseFailed && response.status === 503) {
        error.textContent = "登录服务返回非标准响应，请稍后重试。";
        return;
      }
      if (resultCode === "TENANT_SELECTION_REQUIRED" && Array.isArray(result.tenants) && result.tenants.length) {
        const select = form.tenant_id;
        select.replaceChildren(...result.tenants.map((tenant) => {
          const option = document.createElement("option");
          option.value = tenant.tenantId;
          option.textContent = `${tenant.name} · ${tenant.role}`;
          return option;
        }));
        select.closest("label").hidden = false;
      }
      if (resultCode === "INVITATION_TARGET_NOT_READY") {
        error.textContent = "该账号尚未在该 Workspace 下创建，请先让该用户先用账号登录一次再重新邀请。";
        return;
      }
      error.textContent = normalizeLoginError(result, response.status, String(rawPayload));
      return;
    }

    navigationStarted = true;
    window.location.replace(redirectPath());
  } catch {
    error.textContent = "登录服务暂时不可用。";
  } finally {
    if (!navigationStarted) {
      submitButton.disabled = false;
      submitButton.setAttribute("aria-busy", "false");
      submitButton.textContent = "登录";
    }
  }
});
