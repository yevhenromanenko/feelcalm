const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "uk",
  model: "gpt-4o-mini",
  apiKey: ""
};

const apiKeyEl = document.getElementById("apiKey");
const modelEl = document.getElementById("model");
const targetLangEl = document.getElementById("targetLang");
const enabledEl = document.getElementById("enabled");
const saveBtnEl = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");
const apiKeyInfoBtnEl = document.getElementById("apiKeyInfoBtn");
const apiKeyInfoModalEl = document.getElementById("apiKeyInfoModal");
const apiKeyInfoCloseBtnEl = document.getElementById("apiKeyInfoCloseBtn");

async function loadSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  apiKeyEl.value = settings.apiKey || "";
  modelEl.value = settings.model || DEFAULT_SETTINGS.model;
  targetLangEl.value = settings.targetLang || DEFAULT_SETTINGS.targetLang;
  enabledEl.checked = Boolean(settings.enabled);
}

async function saveSettings() {
  const payload = {
    apiKey: apiKeyEl.value.trim(),
    model: modelEl.value || DEFAULT_SETTINGS.model,
    targetLang: targetLangEl.value,
    enabled: enabledEl.checked
  };

  await chrome.storage.sync.set(payload);
  statusEl.textContent = "Saved";
  setTimeout(() => {
    statusEl.textContent = "";
  }, 1500);
}

function openApiKeyInfoModal() {
  apiKeyInfoModalEl.classList.add("open");
  apiKeyInfoModalEl.setAttribute("aria-hidden", "false");
}

function closeApiKeyInfoModal() {
  apiKeyInfoModalEl.classList.remove("open");
  apiKeyInfoModalEl.setAttribute("aria-hidden", "true");
}

function handleApiKeyInfoBackdropClick(event) {
  if (event.target === apiKeyInfoModalEl) {
    closeApiKeyInfoModal();
  }
}

function handleEscapeClose(event) {
  if (event.key === "Escape" && apiKeyInfoModalEl.classList.contains("open")) {
    closeApiKeyInfoModal();
  }
}

saveBtnEl.addEventListener("click", saveSettings);
apiKeyInfoBtnEl.addEventListener("click", openApiKeyInfoModal);
apiKeyInfoCloseBtnEl.addEventListener("click", closeApiKeyInfoModal);
apiKeyInfoModalEl.addEventListener("click", handleApiKeyInfoBackdropClick);
document.addEventListener("keydown", handleEscapeClose);
loadSettings();
