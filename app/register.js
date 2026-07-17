const form = document.querySelector("#tenantInviteForm");
const emailInput = document.querySelector("#invitee_email");
const roleInput = document.querySelector("#inviteRole");
const durationInput = document.querySelector("#inviteDuration");
const resendInput = document.querySelector("#inviteResend");
const submitButton = document.querySelector("#inviteButton");
const errorMessage = document.querySelector("#inviteError");
const resultSection = document.querySelector("#inviteResultSection");
const inviteUrlInput = document.querySelector("#inviteUrl");
const copyInviteButton = document.querySelector("#copyInviteButton");
const params = new URLSearchParams(window.location.search);
const tokenFromInvite = params.get("invite_token") || "";
const tokenSectionText = document.querySelector("#registerHelp");
const inviteLoginSection = document.querySelector("#inviteLoginSection");
const inviteLoginHint = document.querySelector("#inviteLoginHint");
const inviteLoginLink = document.querySelector("#inviteLoginLink");

if (tokenFromInvite) {
  if (tokenSectionText) {
    tokenSectionText.textContent = "检测到邀请链接参数。请先使用受邀账号登录以完成权限绑定。";
  }
  if (inviteLoginHint) {
    inviteLoginHint.hidden = false;
  }
  if (inviteLoginLink) {
    inviteLoginLink.href = `/login?invite_token=${encodeURIComponent(tokenFromInvite)}`;
    inviteLoginSection.hidden = false;
  }
  if (form) {
    form.hidden = true;
  }
  if (resultSection) {
    resultSection.setAttribute("hidden", "");
  }
  if (errorMessage) {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
  }
}

function resetButton() {
  if (!submitButton) return;
  submitButton.disabled = false;
  submitButton.removeAttribute("aria-busy");
  submitButton.textContent = "生成邀请链接";
}

function resetCopyButton() {
  if (!copyInviteButton) return;
  copyInviteButton.disabled = false;
  copyInviteButton.textContent = "复制链接";
}

async function copyInviteLink() {
  if (!inviteUrlInput?.value) return;
  try {
    await navigator.clipboard.writeText(inviteUrlInput.value);
    copyInviteButton.textContent = "已复制";
  } catch {
    inviteUrlInput.focus();
    inviteUrlInput.select();
    document.execCommand("copy");
    copyInviteButton.textContent = "已复制";
  } finally {
    setTimeout(resetCopyButton, 1200);
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form || !emailInput || !submitButton || !roleInput || !durationInput || !resendInput) return;

  errorMessage.textContent = "";
  errorMessage.hidden = true;
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "生成中…";
  resultSection?.setAttribute("hidden", "");
  inviteUrlInput.value = "";
  resetCopyButton();

  try {
    const response = await fetch("/api/v4/tenant-invitations", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: emailInput.value,
        role: roleInput.value,
        duration: durationInput.value,
        resend: resendInput.checked
      })
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.ok) {
      errorMessage.hidden = false;
      errorMessage.textContent = payload?.message
        || "生成邀请失败，请稍后再试。";
      return;
    }

    const inviteUrl = payload.invite_url;
    if (!inviteUrl || !inviteUrlInput) {
      errorMessage.hidden = false;
      errorMessage.textContent = "接口返回缺少邀请链接，请联系技术支持。";
      return;
    }

    inviteUrlInput.value = inviteUrl;
    resultSection?.removeAttribute("hidden");
    if (copyInviteButton) {
      copyInviteButton.onclick = copyInviteLink;
    }
  } catch {
    errorMessage.hidden = false;
    errorMessage.textContent = "网络异常，暂时无法创建邀请。";
  } finally {
    resetButton();
  }
});
