import { useEffect, useState } from "react";
import ActionButton from "../shared/components/ActionButton";
import FormField from "../shared/components/FormField";
import StatusMessage from "../shared/components/StatusMessage";

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

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] || null;
}

function isMeetTab(tab) {
  return Boolean(tab?.url && tab.url.startsWith("https://meet.google.com/"));
}

export default function App() {
  const [status, setStatus] = useState({ text: "Open Meet tab to control panel.", isError: false });
  const [isOnMeet, setIsOnMeet] = useState(false);
  const [position, setPosition] = useState("right");
  const [resumeText, setResumeText] = useState("");

  function updateStatus(text, isError = false) {
    setStatus({ text, isError });
  }

  async function refreshState() {
    const tab = await getActiveTab();
    const onMeet = isMeetTab(tab);
    setIsOnMeet(onMeet);

    if (!onMeet) {
      updateStatus("Open Google Meet tab to control panel.");
      return;
    }

    const state = await sendTabMessage(tab.id, { type: "panelState" });
    if (!state?.ok) {
      updateStatus("Panel not ready. Refresh Meet tab.", true);
      return;
    }

    setPosition(state.position || "right");
    updateStatus(state.visible ? "Panel is visible" : "Panel is hidden");
  }

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const data = await chrome.storage.local.get({ coachResumeContext: "" });
      if (mounted) {
        setResumeText(data.coachResumeContext || "");
      }
      await refreshState();
    }

    boot();
    return () => {
      mounted = false;
    };
  }, []);

  async function showPanel() {
    const tab = await getActiveTab();
    if (!isMeetTab(tab)) {
      updateStatus("Open Google Meet tab first.", true);
      return;
    }

    const result = await sendTabMessage(tab.id, { type: "showPanel" });
    if (!result?.ok) {
      updateStatus(result?.error || "Failed to show panel", true);
      return;
    }

    updateStatus("Panel shown");
  }

  async function hidePanel() {
    const tab = await getActiveTab();
    if (!isMeetTab(tab)) {
      updateStatus("Open Google Meet tab first.", true);
      return;
    }

    const result = await sendTabMessage(tab.id, { type: "hidePanel" });
    if (!result?.ok) {
      updateStatus(result?.error || "Failed to hide panel", true);
      return;
    }

    updateStatus("Panel hidden");
  }

  async function changePosition(nextPosition) {
    setPosition(nextPosition);

    const tab = await getActiveTab();
    if (!isMeetTab(tab)) {
      updateStatus("Open Google Meet tab first.", true);
      return;
    }

    const result = await sendTabMessage(tab.id, { type: "setPanelPosition", position: nextPosition });

    if (!result?.ok) {
      updateStatus(result?.error || "Failed to set position", true);
      return;
    }

    updateStatus(`Panel position: ${nextPosition}`);
  }

  async function saveResumeContext() {
    const value = resumeText.trim();
    await chrome.storage.local.set({ coachResumeContext: value });
    updateStatus(value ? "Resume context saved" : "Resume context cleared");
  }

  return (
    <>
      <div className="title">feelcalm</div>

      <div className="row">
        <ActionButton onClick={showPanel} disabled={!isOnMeet}>
          Show panel
        </ActionButton>
        <ActionButton onClick={hidePanel} disabled={!isOnMeet}>
          Hide panel
        </ActionButton>
      </div>

      <div style={{ marginTop: 8 }}>
        <FormField label="Panel position" htmlFor="positionSelect">
          <select
            id="positionSelect"
            className="field-control"
            value={position}
            disabled={!isOnMeet}
            onChange={(event) => changePosition(event.target.value)}
          >
            <option value="right">Right</option>
            <option value="center">Center</option>
            <option value="left">Left</option>
          </select>
        </FormField>
      </div>

      <div style={{ marginTop: 8 }}>
        <FormField label="Resume context for Coach" htmlFor="resumeText">
          <textarea
            id="resumeText"
            className="field-control"
            placeholder="Paste your resume/summary here..."
            value={resumeText}
            onChange={(event) => setResumeText(event.target.value)}
          />
        </FormField>
        <ActionButton className="full" onClick={saveResumeContext}>
          Save resume context
        </ActionButton>
      </div>

      <ActionButton className="full" onClick={() => chrome.runtime.openOptionsPage()}>
        Open settings
      </ActionButton>

      <StatusMessage text={status.text} isError={status.isError} />
    </>
  );
}
