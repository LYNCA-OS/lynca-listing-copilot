const userLabel = document.querySelector("#sessionUserLabel");
const status = document.querySelector("#sessionControlStatus");
const logoutButton = document.querySelector("#logoutButton");

function currentAppPath() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function loginUrl() {
  const params = new URLSearchParams({ next: currentAppPath() });
  return `/login?${params.toString()}`;
}

async function loadSession() {
  try {
    const response = await fetch("/api/session", {
      credentials: "same-origin",
      cache: "no-store"
    });
    const session = await response.json().catch(() => ({}));
    if (response.status === 401 || (response.ok && session.authenticated === false)) {
      globalThis.__LYNCA_CONFIRMED_NAVIGATION__ = true;
      window.location.replace(loginUrl());
      return;
    }
    if (!response.ok) {
      status.textContent = "会话服务暂时不可用；当前内容不会被清空，请稍后重试。";
      logoutButton.disabled = true;
      return;
    }
    if (session.authenticated !== true) {
      status.textContent = "会话状态无法确认；当前内容不会被清空，请稍后重试。";
      logoutButton.disabled = true;
      return;
    }

    // This label is presentation only. API authorization must continue to use
    // the signed server session rather than any browser-visible identity field.
    userLabel.textContent = session.user ? `预览 · ${session.user}` : "已登录";
    userLabel.title = session.user || "已登录";
    status.textContent = "";
    logoutButton.disabled = false;
  } catch {
    status.textContent = "暂时无法确认会话状态；当前内容不会被清空。";
    logoutButton.disabled = true;
  }
}

logoutButton.addEventListener("click", async () => {
  const hasLocalWork = Boolean(document.querySelector("#imageInput")?.files?.length);
  if (hasLocalWork && !window.confirm("退出会离开当前工作台。尚未入库的本地内容不会自动恢复，确定退出吗？")) return;

  logoutButton.disabled = true;
  logoutButton.setAttribute("aria-busy", "true");
  logoutButton.textContent = "退出中…";
  status.textContent = "";

  try {
    const response = await fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}"
    });
    if (!response.ok) throw new Error("logout_failed");
    globalThis.__LYNCA_CONFIRMED_NAVIGATION__ = true;
    window.location.replace("/login");
  } catch {
    status.textContent = "退出失败，请检查网络后重试。";
    logoutButton.disabled = false;
    logoutButton.setAttribute("aria-busy", "false");
    logoutButton.textContent = "退出";
  }
});

void loadSession();
