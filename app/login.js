import {
  normalizeLegacyUsername,
  safeAppRedirectPath
} from "./login-flow.mjs";

const form = document.querySelector("#listingLoginForm");
const error = document.querySelector("#loginError");
const submitButton = document.querySelector("#loginButton");
const params = new URLSearchParams(window.location.search);

function redirectPath() {
  return safeAppRedirectPath(params.get("next"), window.location.origin);
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
      body: JSON.stringify({ username, password, tenant_id: tenantId || undefined })
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || !result.ok) {
      if (result.code === "TENANT_SELECTION_REQUIRED" && Array.isArray(result.tenants) && result.tenants.length) {
        const select = form.tenant_id;
        select.replaceChildren(...result.tenants.map((tenant) => {
          const option = document.createElement("option");
          option.value = tenant.tenantId;
          option.textContent = `${tenant.name} · ${tenant.role}`;
          return option;
        }));
        select.closest("label").hidden = false;
      }
      error.textContent = result.message || "账号或密码不正确。";
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
      submitButton.textContent = "进入管理员预览";
    }
  }
});
