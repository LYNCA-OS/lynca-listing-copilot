(function () {
  "use strict";

  var STORAGE_KEY = "lynca-listing-theme-v1";
  var DEFAULT_THEME = "deep-purple";
  var themes = Object.freeze([
    Object.freeze({ id: "deep-purple", label: "深紫科技", themeColor: "#160F23" }),
    Object.freeze({ id: "midnight-blue", label: "午夜蓝", themeColor: "#07111F" }),
    Object.freeze({ id: "jade-tech", label: "翡翠科技", themeColor: "#071813" }),
    Object.freeze({ id: "classic-light", label: "原生紫白", themeColor: "#685D70" })
  ]);

  function themeById(id) {
    return themes.find(function (theme) { return theme.id === id; }) || null;
  }

  function readSavedTheme() {
    try {
      var saved = globalThis.localStorage && globalThis.localStorage.getItem(STORAGE_KEY);
      return themeById(saved) ? saved : DEFAULT_THEME;
    } catch (_error) {
      return DEFAULT_THEME;
    }
  }

  function persistTheme(id) {
    try {
      if (globalThis.localStorage) globalThis.localStorage.setItem(STORAGE_KEY, id);
    } catch (_error) {
      // The selected theme still applies for this document when storage is unavailable.
    }
  }

  function nextTheme(currentId) {
    var currentIndex = themes.findIndex(function (theme) { return theme.id === currentId; });
    return themes[(currentIndex + 1 + themes.length) % themes.length];
  }

  function updateThemeControls(theme) {
    var upcoming = nextTheme(theme.id);
    document.querySelectorAll("[data-theme-cycle]").forEach(function (button) {
      button.dataset.themeId = theme.id;
      button.setAttribute("aria-label", "换肤。当前主题：" + theme.label + "；点击切换到：" + upcoming.label + "。");
      button.setAttribute("title", "当前：" + theme.label + " · 切换到：" + upcoming.label);
      var label = button.querySelector("[data-theme-label]");
      if (label) label.textContent = theme.label;
    });
    document.querySelectorAll("[data-theme-status]").forEach(function (status) {
      status.textContent = "当前主题已设为" + theme.label;
    });
  }

  function guardInstantThemeSwitch() {
    document.documentElement.dataset.themeSwitching = "true";
    var clearGuard = function () { delete document.documentElement.dataset.themeSwitching; };
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(function () {
        globalThis.requestAnimationFrame(clearGuard);
      });
    } else {
      globalThis.setTimeout(clearGuard, 32);
    }
  }

  function applyTheme(id, options) {
    var theme = themeById(id) || themeById(DEFAULT_THEME);
    if (options && options.instant) guardInstantThemeSwitch();
    document.documentElement.dataset.lyncaTheme = theme.id;
    var themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.setAttribute("content", theme.themeColor);
    if (options && options.persist) persistTheme(theme.id);
    if (document.body) updateThemeControls(theme);
    return theme;
  }

  function bindThemeControls() {
    updateThemeControls(themeById(document.documentElement.dataset.lyncaTheme) || themeById(DEFAULT_THEME));
    document.querySelectorAll("[data-theme-cycle]").forEach(function (button) {
      if (button.dataset.themeBound === "true") return;
      button.dataset.themeBound = "true";
      button.addEventListener("click", function () {
        var current = themeById(document.documentElement.dataset.lyncaTheme) || themeById(DEFAULT_THEME);
        applyTheme(nextTheme(current.id).id, { persist: true, instant: true });
      });
    });
  }

  globalThis.LyncaTheme = Object.freeze({
    storageKey: STORAGE_KEY,
    themes: themes,
    apply: applyTheme,
    next: nextTheme
  });

  applyTheme(readSavedTheme());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindThemeControls, { once: true });
  } else {
    bindThemeControls();
  }
  globalThis.addEventListener("storage", function (event) {
    if (event.key !== STORAGE_KEY) return;
    applyTheme(themeById(event.newValue) ? event.newValue : DEFAULT_THEME, { instant: true });
  });
}());
