import {
  AUTH_CHANNELS,
  authDestinationValid,
  maskAuthDestination,
  normalizeAuthDestination,
  normalizeOtp,
  otpReady,
  resendSecondsRemaining
} from "./auth-product-flow.mjs";

const requestPanel = document.querySelector("#otpRequestPanel");
const verifyPanel = document.querySelector("#otpVerifyPanel");
const requestForm = document.querySelector("#otpRequestForm");
const verifyForm = document.querySelector("#otpVerifyForm");
const emailInput = document.querySelector("#authEmail");
const otpInput = document.querySelector("#authOtp");
const requestStatus = document.querySelector("#authRequestStatus");
const verifyStatus = document.querySelector("#authVerifyStatus");
const humanCheck = document.querySelector("#authHumanCheck");
const humanButton = document.querySelector("#authHumanButton");
const humanStatus = document.querySelector("#authHumanStatus");
const maskedDestination = document.querySelector("#maskedDestination");
const editDestinationButton = document.querySelector("#editDestinationButton");
const resendButton = document.querySelector("#resendOtpButton");
const requestButton = document.querySelector("#requestOtpButton");
const verifyButton = document.querySelector("#verifyOtpButton");
const adminToggle = document.querySelector("#adminPreviewToggle");
const adminPanel = document.querySelector("#adminPreviewPanel");
const adminForm = document.querySelector("#adminPreviewForm");
const adminStatus = document.querySelector("#adminPreviewStatus");

let destination = "";
let sentAt = 0;
let countdownTimer = null;
let humanVerified = false;
let requestPending = false;
let requestSequence = 0;

function setStatus(element, message = "", tone = "") {
  element.textContent = message;
  element.classList.toggle("is-error", tone === "error");
  element.classList.toggle("is-success", tone === "success");
}

function setInputError(input, invalid) {
  input.setAttribute("aria-invalid", invalid ? "true" : "false");
}

function renderCountdown() {
  const seconds = resendSecondsRemaining({ sentAt });
  resendButton.disabled = seconds > 0;
  resendButton.textContent = seconds > 0 ? `${seconds} 秒后重新发送` : "重新发送验证码";
  if (seconds === 0 && countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function beginCountdown() {
  sentAt = Date.now();
  if (countdownTimer) clearInterval(countdownTimer);
  renderCountdown();
  countdownTimer = setInterval(renderCountdown, 1_000);
}

function resetHumanCheck(message = "") {
  humanVerified = false;
  humanCheck.dataset.state = "idle";
  humanButton.disabled = false;
  humanButton.textContent = "验证当前环境";
  setStatus(humanStatus, message);
}

function showRequestStep() {
  requestSequence += 1;
  verifyPanel.hidden = true;
  requestPanel.hidden = false;
  setStatus(verifyStatus);
  otpInput.value = "";
  setInputError(otpInput, false);
  requestPending = false;
  requestButton.disabled = false;
  requestButton.textContent = "获取验证码";
  verifyButton.disabled = false;
  resetHumanCheck();
  requestAnimationFrame(() => emailInput.focus());
}

function showVerifyStep() {
  requestPanel.hidden = true;
  verifyPanel.hidden = false;
  maskedDestination.textContent = maskAuthDestination(destination, AUTH_CHANNELS.EMAIL);
  beginCountdown();
  requestAnimationFrame(() => otpInput.focus());
}

requestForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (requestPending) return;
  destination = normalizeAuthDestination(emailInput.value, AUTH_CHANNELS.EMAIL);
  const valid = authDestinationValid(destination, AUTH_CHANNELS.EMAIL);
  setInputError(emailInput, !valid);
  if (!valid) {
    setStatus(requestStatus, "请输入有效的邮箱地址。", "error");
    emailInput.focus();
    return;
  }

  if (!humanVerified) {
    setStatus(humanStatus, "发送验证码前，请先完成真人与环境验证。", "error");
    humanButton.focus();
    return;
  }

  requestPending = true;
  requestButton.disabled = true;
  requestButton.textContent = "正在请求…";
  setStatus(requestStatus, "正在请求设计预览验证码，请勿重复提交。");
  const requestedDestination = destination;
  const requestId = ++requestSequence;

  window.setTimeout(() => {
    if (
      requestId !== requestSequence ||
      !humanVerified ||
      normalizeAuthDestination(emailInput.value, AUTH_CHANNELS.EMAIL) !== requestedDestination
    ) {
      requestPending = false;
      requestButton.disabled = false;
      requestButton.textContent = "获取验证码";
      resetHumanCheck("邮箱已修改，请重新验证当前环境。");
      return;
    }
    requestPending = false;
    showVerifyStep();
    setStatus(verifyStatus, "设计预览已发送验证码。正式版本会使用统一提示保护账号隐私。", "success");
  }, 350);
});

emailInput.addEventListener("input", () => {
  setInputError(emailInput, false);
  setStatus(requestStatus);
  if (requestPending) {
    requestSequence += 1;
    requestPending = false;
    requestButton.disabled = false;
    requestButton.textContent = "获取验证码";
  }
  if (humanVerified) resetHumanCheck("邮箱已修改，请重新验证当前环境。");
});

humanButton.addEventListener("click", () => {
  destination = normalizeAuthDestination(emailInput.value, AUTH_CHANNELS.EMAIL);
  const valid = authDestinationValid(destination, AUTH_CHANNELS.EMAIL);
  setInputError(emailInput, !valid);
  if (!valid) {
    setStatus(humanStatus, "请先填写有效邮箱，再验证当前环境。", "error");
    emailInput.focus();
    return;
  }

  humanCheck.dataset.state = "checking";
  humanButton.disabled = true;
  humanButton.textContent = "验证中…";
  setStatus(humanStatus, "正在运行设计预览环境检查。正式版本由服务端验证一次性挑战令牌。");
  const verifiedDestination = destination;

  window.setTimeout(() => {
    if (normalizeAuthDestination(emailInput.value, AUTH_CHANNELS.EMAIL) !== verifiedDestination) {
      resetHumanCheck("邮箱已修改，请重新验证当前环境。");
      return;
    }
    humanVerified = true;
    humanCheck.dataset.state = "verified";
    humanButton.textContent = "已验证";
    setStatus(humanStatus, "当前环境已通过设计预览验证。", "success");
  }, 650);
});

otpInput.addEventListener("input", () => {
  otpInput.value = normalizeOtp(otpInput.value);
  setInputError(otpInput, false);
});

verifyForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = otpInput.value;
  if (!otpReady(code)) {
    setInputError(otpInput, true);
    setStatus(verifyStatus, "请输入完整的 6 位验证码。", "error");
    otpInput.focus();
    return;
  }
  if (code !== "123456") {
    setInputError(otpInput, true);
    setStatus(verifyStatus, "验证码不正确或已过期，请检查后重试。", "error");
    otpInput.select();
    return;
  }

  setInputError(otpInput, false);
  verifyButton.disabled = true;
  setStatus(verifyStatus, "验证成功。正式接入后将进入获邀工作区。", "success");
});

resendButton.addEventListener("click", () => {
  showRequestStep();
  setStatus(humanStatus, "重新发送会进行新的风险判断，请再次验证当前环境。");
});

editDestinationButton.addEventListener("click", showRequestStep);

adminToggle.addEventListener("click", () => {
  const expanded = adminToggle.getAttribute("aria-expanded") === "true";
  adminToggle.setAttribute("aria-expanded", String(!expanded));
  adminPanel.hidden = expanded;
  adminToggle.lastElementChild.textContent = expanded ? "展开" : "收起";
  if (!expanded) requestAnimationFrame(() => adminForm.username.focus());
});

adminForm.addEventListener("submit", (event) => {
  event.preventDefault();
  setStatus(adminStatus);
  const usernameMissing = !adminForm.username.value.trim();
  const passwordMissing = !adminForm.password.value;
  setInputError(adminForm.username, usernameMissing);
  setInputError(adminForm.password, passwordMissing);
  if (usernameMissing || passwordMissing) {
    setStatus(adminStatus, "请输入管理员账号和密码。", "error");
    (usernameMissing ? adminForm.username : adminForm.password).focus();
    return;
  }
  setStatus(adminStatus, "交互演示完成，未验证任何真实凭据。正式版本将进入隔离预览工作区。", "success");
});
