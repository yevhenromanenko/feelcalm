const showBtn = document.getElementById("showBtn");
const hideBtn = document.getElementById("hideBtn");
const positionSelect = document.getElementById("positionSelect");
const resumeText = document.getElementById("resumeText");
const saveResumeBtn = document.getElementById("saveResumeBtn");
const settingsBtn = document.getElementById("settingsBtn");
const statusEl = document.getElementById("status");

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("err", isError);
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function isMeetTab(tab) {
  return Boolean(tab?.url && tab.url.startsWith("https://meet.google.com/"));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(response || { ok: false, error: "No response from tab" });
    });
  });
}

async function loadResumeContext() {
  const data = await chrome.storage.local.get({ coachResumeContext: "" });
  resumeText.value = data.coachResumeContext || "";
}

async function refreshState() {
  const tab = await getActiveTab();
  const onMeet = isMeetTab(tab);

  showBtn.disabled = !onMeet;
  hideBtn.disabled = !onMeet;
  positionSelect.disabled = !onMeet;

  if (!onMeet) {
    setStatus("Open Google Meet tab to control panel.");
    return;
  }

  const state = await sendTabMessage(tab.id, { type: "panelState" });
  if (!state?.ok) {
    setStatus("Panel not ready. Refresh Meet tab.", true);
    return;
  }

  positionSelect.value = state.position || "right";
  setStatus(state.visible ? "Panel is visible" : "Panel is hidden");
}

showBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!isMeetTab(tab)) {
    setStatus("Open Google Meet tab first.", true);
    return;
  }

  const result = await sendTabMessage(tab.id, { type: "showPanel" });
  if (!result?.ok) {
    setStatus(result?.error || "Failed to show panel", true);
    return;
  }

  setStatus("Panel shown");
});

hideBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  if (!isMeetTab(tab)) {
    setStatus("Open Google Meet tab first.", true);
    return;
  }

  const result = await sendTabMessage(tab.id, { type: "hidePanel" });
  if (!result?.ok) {
    setStatus(result?.error || "Failed to hide panel", true);
    return;
  }

  setStatus("Panel hidden");
});

positionSelect.addEventListener("change", async () => {
  const tab = await getActiveTab();
  if (!isMeetTab(tab)) {
    setStatus("Open Google Meet tab first.", true);
    return;
  }

  const result = await sendTabMessage(tab.id, { type: "setPanelPosition", position: positionSelect.value });
  if (!result?.ok) {
    setStatus(result?.error || "Failed to set position", true);
    return;
  }

  setStatus(`Panel position: ${positionSelect.value}`);
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

saveResumeBtn.addEventListener("click", async () => {
  const value = resumeText.value.trim();
  await chrome.storage.local.set({ coachResumeContext: value });
  setStatus(value ? "Resume context saved" : "Resume context cleared");
});

loadResumeContext();
refreshState();
