const form = document.querySelector("#listingLoginForm");
const error = document.querySelector("#loginError");
const params = new URLSearchParams(window.location.search);

function redirectPath() {
  const next = params.get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function normalize(value) {
  return value.trim().toLowerCase();
}

async function redirectIfAuthenticated() {
  try {
    const response = await fetch("/api/session", { credentials: "same-origin" });
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
  error.textContent = "";

  const username = normalize(form.username.value);
  const password = form.password.value;
  const tenantId = form.tenant_id?.value || "";

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ username, password, tenant_id: tenantId || undefined })
    });
    const result = await response.json();

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

    window.location.replace(redirectPath());
  } catch {
    error.textContent = "登录服务暂时不可用。";
  }
});
