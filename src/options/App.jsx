import { useEffect, useState } from "react";
import ActionButton from "../shared/components/ActionButton";
import FormField from "../shared/components/FormField";
import Modal from "../shared/components/Modal";
import StatusMessage from "../shared/components/StatusMessage";

const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "uk",
  model: "gpt-4o-mini",
  apiKey: ""
};

export default function App() {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [targetLang, setTargetLang] = useState(DEFAULT_SETTINGS.targetLang);
  const [enabled, setEnabled] = useState(DEFAULT_SETTINGS.enabled);
  const [status, setStatus] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function loadSettings() {
      const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
      if (!mounted) return;
      setApiKey(settings.apiKey || "");
      setModel(settings.model || DEFAULT_SETTINGS.model);
      setTargetLang(settings.targetLang || DEFAULT_SETTINGS.targetLang);
      setEnabled(Boolean(settings.enabled));
    }

    function onEscape(event) {
      if (event.key === "Escape") {
        setIsModalOpen(false);
      }
    }

    loadSettings();
    document.addEventListener("keydown", onEscape);
    return () => {
      mounted = false;
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function saveSettings() {
    const payload = {
      apiKey: apiKey.trim(),
      model: model || DEFAULT_SETTINGS.model,
      targetLang,
      enabled
    };

    await chrome.storage.sync.set(payload);
    setStatus("Saved");
    setTimeout(() => {
      setStatus("");
    }, 1500);
  }

  const apiKeyInfoAction = (
    <ActionButton
      id="apiKeyInfoBtn"
      className="info-btn"
      aria-label="How to get OpenAI API key"
      onClick={() => setIsModalOpen(true)}
    >
      How to get key
    </ActionButton>
  );

  return (
    <>
      <div className="wrap">
        <div className="eyebrow">feelcalm extension</div>
        <h1>Settings for calm meetings</h1>
        <p className="subtitle">Configure translation once, then use it directly in Google Meet.</p>

        <FormField label="OpenAI API key" htmlFor="apiKey" labelRowExtra={apiKeyInfoAction}>
          <input
            id="apiKey"
            type="password"
            placeholder="sk-..."
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </FormField>

        <FormField label="Model" htmlFor="model">
          <select id="model" value={model} onChange={(event) => setModel(event.target.value)}>
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
            <option value="gpt-4.1-nano">gpt-4.1-nano</option>
            <option value="gpt-4.1">gpt-4.1</option>
          </select>
        </FormField>

        <FormField label="Default target language" htmlFor="targetLang">
          <select id="targetLang" value={targetLang} onChange={(event) => setTargetLang(event.target.value)}>
            <option value="uk">Ukrainian</option>
            <option value="ru">Russian</option>
          </select>
        </FormField>

        <div className="field checkbox-field">
          <label className="checkbox" htmlFor="enabled">
            <input
              id="enabled"
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enable translation by default
          </label>
        </div>

        <div className="actions">
          <ActionButton id="saveBtn" onClick={saveSettings}>
            Save settings
          </ActionButton>
          <StatusMessage id="status" text={status} />
        </div>

        <p className="hint">
          On Meet page enable captions first. Then the extension listens to caption updates and translates them.
        </p>
        <p className="hint">
          Open this page any time via extensions list -&gt; <code>feelcalm</code> -&gt; Details -&gt; Extension options.
        </p>
      </div>

      <Modal isOpen={isModalOpen} titleId="apiKeyInfoTitle" title="How to get OpenAI API key" onClose={() => setIsModalOpen(false)}>
        <ol className="modal-list">
          <li>Sign in to your OpenAI account.</li>
          <li>Open API keys page.</li>
          <li>Click Create new secret key.</li>
          <li>Copy the key once and paste it into this field.</li>
        </ol>
        <p className="modal-note">
          Open page:{" "}
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">
            platform.openai.com/api-keys
          </a>
        </p>
      </Modal>
    </>
  );
}
