const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "uk",
  model: "gpt-4o-mini",
  coachEnabled: true,
  collapsed: false,
  listCollapsed: false,
  panelVisible: true,
  panelPosition: "right"
};

const MAX_ITEMS = 8;
const RECENT_SOURCE_TTL_MS = 20_000;
const MIN_TEXT_LENGTH = 2;
const STABLE_CAPTION_DELAY_MS = 900;
const FALLBACK_SCAN_INTERVAL_MS = 1200;
const COACH_RECENT_TTL_MS = 45_000;
const SCREEN_SHARE_CHECK_INTERVAL_MS = 1500;

let settings = { ...DEFAULT_SETTINGS };
const recentSource = new Map();
const recentCoachQuestions = new Map();
let pendingCaption = null;
let pendingCaptionTimer = null;
let fallbackScanTimer = null;
let screenShareWatchTimer = null;

const state = {
  isMounted: false,
  root: null,
  statusEl: null,
  listEl: null,
  toggleEl: null,
  collapseBtnEl: null,
  closeBtnEl: null,
  langEl: null,
  modelSelectEl: null,
  modelCustomEl: null,
  coachToggleEl: null,
  coachTabsEl: null,
  coachTabUkEl: null,
  coachTabEnEl: null,
  coachQuestionEl: null,
  coachAnswerEl: null,
  coachCurrentQuestion: "",
  coachActiveTab: "same",
  coachResponses: {},
  listSectionEl: null,
  listToggleBtnEl: null,
  settingsBtnEl: null
};

const MODEL_PRESETS = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"];
const SELF_SPEAKER_LABELS = new Set(["you", "вы"]);
const START_PRESENTING_TOKENS = [
  "показать экран",
  "поделиться экраном",
  "представить экран",
  "демонстрация экрана",
  "present now",
  "share screen",
  "present your screen",
  "present",
  "presenter",
  "показ екрана",
  "демонстрація екрана",
  "показати екран",
  "поділитися екраном"
];
const PRESENTING_TOKENS = [
  "you are presenting",
  "stop presenting",
  "вы показываете экран",
  "прекратить показ",
  "остановить показ",
  "ви демонструєте екран",
  "зупинити показ",
  "демонстрация экрана",
  "демонстрація екрана"
];
const CONTINUE_CUE_TOKENS = [
  "продолжай",
  "продовжуй",
  "дальше",
  "далі",
  "угу продолжай",
  "ok continue",
  "continue",
  "go on",
  "keep going",
  "next"
];

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeSpeakerLabel(name) {
  return normalizeText(name || "")
    .toLowerCase()
    .replace(/[.,!?;:()[\]"']/g, "");
}

function isSelfSpeaker(name) {
  const normalized = normalizeSpeakerLabel(name);
  return SELF_SPEAKER_LABELS.has(normalized);
}

function looksLikeEnglish(text) {
  return /[A-Za-z]/.test(text);
}

function hasCyrillic(text) {
  return /[А-Яа-яЁёІіЇїЄєҐґ]/.test(text);
}

function isLikelyQuestion(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  if (normalized.includes("?")) {
    return true;
  }

  const lower = normalized.toLowerCase();
  const englishStart =
    /^(what|why|how|when|where|which|who|can|could|would|do|does|did|are|is|was|were)\b/.test(
      lower
    );
  const ruUkQuestionWord =
    /\b(як|чому|що|коли|де|навіщо|хто|який|яка|яке|які|можете|можеш|можна|поясніть|поясни|розкажіть|розкажи|опишіть|опиши|покажіть|покажи|як би ви|как|почему|что|когда|где|зачем|кто|какой|какая|какие|можете|можешь|можно|объясните|объясни|расскажите|расскажи|опишите|опиши|покажите|покажи)\b/.test(
      lower
    );
  const imperativeAsk =
    /\b(describe|tell me|walk me through|explain|опиши|опишите|расскажи|расскажите|поясни|поясните|розкажи|розкажіть|опишіть|поясніть)\b/.test(
      lower
    );
  return englishStart || ruUkQuestionWord || imperativeAsk;
}

function shouldTriggerCoach(text, questionDetected) {
  if (questionDetected) {
    return true;
  }

  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }

  // Fallback for imperfect live captions: trigger on longer prompt-like phrases.
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length < 4) {
    return false;
  }

  const promptLike =
    /\b(опиши|опишите|расскажи|расскажите|поясни|поясните|розкажи|розкажіть|поясни|поясніть|яким чином|каким образом|сценарий|flow|флоу|інтеграц|интеграц|архитектур|архітектур)\b/.test(
      normalized
    );
  return promptLike;
}

function isSubstantialInterviewerText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 4 || normalized.length >= 24;
}

function isLikelyCaption(text) {
  if (!text || text.length < MIN_TEXT_LENGTH || text.length > 280) {
    return false;
  }

  const lower = text.toLowerCase();
  const blocked = [
    "you are presenting",
    "microphone",
    "camera",
    "joined",
    "left the meeting",
    "meeting details",
    "turn on captions",
    "raise hand"
  ];

  if (blocked.some((token) => lower.includes(token))) {
    return false;
  }

  return looksLikeEnglish(text) || hasCyrillic(text);
}

function isContinuationCue(text) {
  const normalized = normalizeText(text).toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.length <= 2) {
    return true;
  }
  return CONTINUE_CUE_TOKENS.some((token) => normalized === token || normalized.includes(token));
}

function pushStatus(text, isError = false) {
  if (!state.statusEl) {
    return;
  }
  state.statusEl.textContent = text;
  state.statusEl.dataset.error = String(Boolean(isError));
}

function pushCoachHint(question, hint) {
  if (!state.coachQuestionEl || !state.coachAnswerEl) {
    return;
  }
  state.coachQuestionEl.textContent = question ? `Q: ${question}` : "Coach is ready";
  renderCoachHint(hint || "Ask a question to get a structured answer hint.");
}

function findCoachLine(lines, prefixes) {
  return lines.find((line) => prefixes.some((prefix) => line.toLowerCase().startsWith(prefix)));
}

function extractCoachValue(line) {
  const idx = line.indexOf(":");
  if (idx < 0) {
    return line.trim();
  }
  return line.slice(idx + 1).trim();
}

function renderCoachHint(hint) {
  if (!state.coachAnswerEl) {
    return;
  }

  const text = String(hint || "").trim();
  const lines = text
    .split("\n")
    .map((line) => normalizeText(line))
    .filter(Boolean);

  const keywordsLine = findCoachLine(lines, ["keywords:", "ключевые слова:", "ключові слова:"]);
  const answerLine = findCoachLine(lines, ["answer:", "ответ:", "відповідь:"]);
  const exampleLine = findCoachLine(lines, ["example:", "пример:", "приклад:"]);

  if (!keywordsLine || !answerLine) {
    state.coachAnswerEl.textContent = text || "Ask a question to get a structured answer hint.";
    return;
  }

  state.coachAnswerEl.textContent = "";

  const keywordsEl = document.createElement("div");
  keywordsEl.className = "mlt-coach-keywords";
  keywordsEl.textContent = extractCoachValue(keywordsLine);

  const separatorEl = document.createElement("div");
  separatorEl.className = "mlt-coach-separator";

  const answerEl = document.createElement("div");
  answerEl.className = "mlt-coach-main-answer";
  answerEl.textContent = extractCoachValue(answerLine);

  state.coachAnswerEl.appendChild(keywordsEl);
  state.coachAnswerEl.appendChild(separatorEl);
  state.coachAnswerEl.appendChild(answerEl);

  if (exampleLine) {
    const exampleEl = document.createElement("div");
    exampleEl.className = "mlt-coach-example";
    exampleEl.textContent = extractCoachValue(exampleLine);
    state.coachAnswerEl.appendChild(exampleEl);
  }
}

function isEnglishQuestion(text) {
  return looksLikeEnglish(text) && !hasCyrillic(text);
}

function setCoachTabsVisible(visible) {
  if (!state.coachTabsEl) {
    return;
  }
  state.coachTabsEl.style.display = visible ? "flex" : "none";
}

function setCoachActiveTab(tab) {
  state.coachActiveTab = tab;
  if (state.coachTabUkEl) {
    state.coachTabUkEl.classList.toggle("active", tab === "uk");
  }
  if (state.coachTabEnEl) {
    state.coachTabEnEl.classList.toggle("active", tab === "en");
  }

  const current = state.coachResponses[tab] || state.coachResponses.same || "Thinking...";
  if (state.coachAnswerEl) {
    renderCoachHint(current);
  }
}

function addTranslationItem(source, translated, cached = false) {
  if (!state.listEl) {
    return;
  }

  const item = document.createElement("div");
  item.className = "mlt-item";

  const sourceEl = document.createElement("div");
  sourceEl.className = "mlt-source";
  sourceEl.textContent = source;

  const targetEl = document.createElement("div");
  targetEl.className = "mlt-target";
  targetEl.textContent = translated;

  const meta = document.createElement("div");
  meta.className = "mlt-meta";
  meta.textContent = cached ? "cache" : "live";

  item.appendChild(sourceEl);
  item.appendChild(targetEl);
  item.appendChild(meta);

  state.listEl.prepend(item);

  while (state.listEl.childElementCount > MAX_ITEMS) {
    state.listEl.removeChild(state.listEl.lastElementChild);
  }
}

async function loadSettings() {
  const saved = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  settings = { ...DEFAULT_SETTINGS, ...saved };
}

async function updateSetting(key, value) {
  settings[key] = value;
  await chrome.storage.sync.set({ [key]: value });
}

async function hidePanelPersist() {
  if (!settings.panelVisible) {
    return;
  }
  applyPanelVisibility(false);
  await updateSetting("panelVisible", false);
}

function applyPanelVisibility(visible) {
  if (!state.root) {
    return;
  }
  state.root.classList.toggle("mlt-hidden", !visible);
}

function applyPanelPosition(position) {
  if (!state.root) {
    return;
  }

  const normalized = ["left", "center", "right"].includes(position) ? position : "right";
  state.root.classList.remove("mlt-pos-left", "mlt-pos-center", "mlt-pos-right");
  state.root.classList.add(`mlt-pos-${normalized}`);
}

function mountUi() {
  if (state.isMounted) {
    return;
  }

  const root = document.createElement("div");
  root.id = "mlt-root";
  root.innerHTML = `
    <div class="mlt-header">
      <label class="mlt-switch" for="mlt-toggle">
        <input id="mlt-toggle" type="checkbox" />
        <span class="mlt-switch-track"><span class="mlt-switch-knob"></span></span>
      </label>
      <div class="mlt-header-actions">
        <select id="mlt-lang" class="mlt-header-lang" aria-label="Target language">
          <option value="uk">ua</option>
          <option value="ru">ru</option>
        </select>
        <button id="mlt-settings" type="button" class="mlt-settings-icon-btn" aria-label="Settings">
          <svg class="mlt-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M20 7h-9"></path>
            <path d="M14 17H5"></path>
            <circle cx="17" cy="17" r="3"></circle>
            <circle cx="8" cy="7" r="3"></circle>
          </svg>
        </button>
        <button id="mlt-collapse" type="button" class="mlt-collapse-btn" aria-label="Collapse panel">
          <svg class="mlt-icon mlt-icon-out" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          <svg class="mlt-icon mlt-icon-in" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="4 14 10 14 10 20"></polyline>
            <polyline points="20 10 14 10 14 4"></polyline>
            <line x1="14" y1="10" x2="21" y2="3"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        <button id="mlt-close" type="button" class="mlt-close-btn" aria-label="Hide panel">
          <svg class="mlt-icon" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
    <div class="mlt-body">
      <div class="mlt-model-row">
        <label>Model
          <select id="mlt-model" class="mlt-model-select">
            <option value="gpt-4o-mini">gpt-4o-mini</option>
            <option value="gpt-4o">gpt-4o</option>
            <option value="gpt-4.1-mini">gpt-4.1-mini</option>
            <option value="gpt-4.1">gpt-4.1</option>
            <option value="__custom__">Custom...</option>
          </select>
        </label>
        <input id="mlt-model-custom" class="mlt-model-custom" type="text" placeholder="custom model id" />
      </div>
      <div class="mlt-coach-row">
        <label class="mlt-coach-toggle">
          <input id="mlt-coach-toggle" type="checkbox" />
          Interview Coach
        </label>
      </div>
      <div class="mlt-coach-box">
        <div id="mlt-coach-tabs" class="mlt-coach-tabs" style="display:none">
          <button id="mlt-coach-tab-uk" type="button" class="mlt-coach-tab">UKR</button>
          <button id="mlt-coach-tab-en" type="button" class="mlt-coach-tab">ENG</button>
        </div>
        <div id="mlt-coach-question" class="mlt-coach-question">Coach is ready</div>
        <div id="mlt-coach-answer" class="mlt-coach-answer">Ask a question to get a structured answer hint.</div>
      </div>
      <div class="mlt-status-row">
        <div id="mlt-status" class="mlt-status"></div>
        <button id="mlt-list-toggle" type="button" class="mlt-list-toggle">
          <span class="mlt-list-caret">▾</span>
        </button>
      </div>
      <div id="mlt-list-section" class="mlt-list-section">
        <div id="mlt-list" class="mlt-list"></div>
      </div>
    </div>
  `;

  document.documentElement.appendChild(root);

  state.root = root;
  state.statusEl = root.querySelector("#mlt-status");
  state.listEl = root.querySelector("#mlt-list");
  state.toggleEl = root.querySelector("#mlt-toggle");
  state.collapseBtnEl = root.querySelector("#mlt-collapse");
  state.closeBtnEl = root.querySelector("#mlt-close");
  state.langEl = root.querySelector("#mlt-lang");
  state.modelSelectEl = root.querySelector("#mlt-model");
  state.modelCustomEl = root.querySelector("#mlt-model-custom");
  state.coachToggleEl = root.querySelector("#mlt-coach-toggle");
  state.coachTabsEl = root.querySelector("#mlt-coach-tabs");
  state.coachTabUkEl = root.querySelector("#mlt-coach-tab-uk");
  state.coachTabEnEl = root.querySelector("#mlt-coach-tab-en");
  state.coachQuestionEl = root.querySelector("#mlt-coach-question");
  state.coachAnswerEl = root.querySelector("#mlt-coach-answer");
  state.listSectionEl = root.querySelector("#mlt-list-section");
  state.listToggleBtnEl = root.querySelector("#mlt-list-toggle");
  state.settingsBtnEl = root.querySelector("#mlt-settings");

  state.toggleEl.checked = settings.enabled;
  state.langEl.value = settings.targetLang;
  state.coachToggleEl.checked = Boolean(settings.coachEnabled);
  applyPanelVisibility(Boolean(settings.panelVisible));
  applyPanelPosition(settings.panelPosition);
  root.classList.toggle("mlt-collapsed", Boolean(settings.collapsed));
  state.listSectionEl.classList.toggle("collapsed", Boolean(settings.listCollapsed));
  root.classList.toggle("mlt-list-collapsed", Boolean(settings.listCollapsed));
  state.collapseBtnEl.setAttribute(
    "aria-label",
    settings.collapsed ? "Expand panel" : "Collapse panel"
  );
  if (MODEL_PRESETS.includes(settings.model)) {
    state.modelSelectEl.value = settings.model;
    state.modelCustomEl.style.display = "none";
  } else {
    state.modelSelectEl.value = "__custom__";
    state.modelCustomEl.style.display = "block";
    state.modelCustomEl.value = settings.model;
  }

  state.toggleEl.addEventListener("change", async () => {
    const enabled = state.toggleEl.checked;
    await updateSetting("enabled", enabled);
    pushStatus(enabled ? "Translation enabled" : "Translation paused");
  });

  state.langEl.addEventListener("change", async () => {
    const targetLang = state.langEl.value;
    await updateSetting("targetLang", targetLang);
    pushStatus(`Target language: ${targetLang.toUpperCase()}`);
  });

  state.modelSelectEl.addEventListener("change", async () => {
    const selected = state.modelSelectEl.value;
    if (selected === "__custom__") {
      state.modelCustomEl.style.display = "block";
      state.modelCustomEl.focus();
      pushStatus("Enter custom model id");
      return;
    }

    state.modelCustomEl.style.display = "none";
    state.modelCustomEl.value = "";
    await updateSetting("model", selected);
    pushStatus(`Model: ${selected}`);
  });

  state.modelCustomEl.addEventListener("change", async () => {
    const value = normalizeText(state.modelCustomEl.value);
    if (!value) {
      pushStatus("Custom model id is empty", true);
      return;
    }
    await updateSetting("model", value);
    pushStatus(`Model: ${value}`);
  });

  state.coachToggleEl.addEventListener("change", async () => {
    const coachEnabled = state.coachToggleEl.checked;
    await updateSetting("coachEnabled", coachEnabled);
    pushStatus(coachEnabled ? "Coach enabled" : "Coach disabled");
  });

  state.coachTabUkEl.addEventListener("click", () => setCoachActiveTab("uk"));
  state.coachTabEnEl.addEventListener("click", () => setCoachActiveTab("en"));
  state.listToggleBtnEl.addEventListener("click", async () => {
    const next = !state.listSectionEl.classList.contains("collapsed");
    state.listSectionEl.classList.toggle("collapsed", next);
    root.classList.toggle("mlt-list-collapsed", next);
    await updateSetting("listCollapsed", next);
  });

  state.settingsBtnEl.addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "openOptions" }, (response) => {
      if (chrome.runtime.lastError) {
        pushStatus(chrome.runtime.lastError.message, true);
        return;
      }
      if (!response?.ok) {
        pushStatus(response?.error || "Failed to open settings", true);
      }
    });
  });

  state.collapseBtnEl.addEventListener("click", async () => {
    const nextCollapsed = !root.classList.contains("mlt-collapsed");
    root.classList.toggle("mlt-collapsed", nextCollapsed);
    state.collapseBtnEl.setAttribute("aria-label", nextCollapsed ? "Expand panel" : "Collapse panel");
    await updateSetting("collapsed", nextCollapsed);
  });

  state.closeBtnEl.addEventListener("click", async () => {
    await hidePanelPersist();
  });

  state.isMounted = true;
  pushCoachHint("", "");
  pushStatus("Waiting for captions...");
}

function shouldSkipAsRecent(text) {
  const now = Date.now();

  for (const [key, ts] of recentSource.entries()) {
    if (now - ts > RECENT_SOURCE_TTL_MS) {
      recentSource.delete(key);
    }
  }

  const existingTs = recentSource.get(text);
  if (existingTs && now - existingTs < RECENT_SOURCE_TTL_MS) {
    return true;
  }

  recentSource.set(text, now);
  return false;
}

async function processCaptionText(rawText, speaker = "") {
  if (!settings.enabled || !settings.panelVisible) {
    return;
  }

  const normalizedSpeaker = normalizeSpeakerLabel(speaker);
  // Only react to clear, speaker-attributed captions from interlocutors.
  if (!normalizedSpeaker || isSelfSpeaker(normalizedSpeaker)) {
    return;
  }

  const text = normalizeText(rawText);
  if (!isLikelyCaption(text) || shouldSkipAsRecent(text)) {
    return;
  }

  const questionDetected = isLikelyQuestion(text);
  const cyrillicText = hasCyrillic(text);

  // For RU/UK text run coach only (no translation call).
  if (cyrillicText) {
    if (isContinuationCue(text)) {
      pushStatus("Coach keeps previous answer");
      return;
    }

    const shouldCoachRespond =
      settings.coachEnabled && (shouldTriggerCoach(text, questionDetected) || isSubstantialInterviewerText(text));
    if (shouldCoachRespond) {
      state.coachCurrentQuestion = text;
      state.coachResponses = {};
      setCoachTabsVisible(false);
      setCoachActiveTab("same");
      pushCoachHint(text, "Thinking...");
      requestCoachHintVariant(text, "same", true);
    }
    pushStatus("Coach-only mode for RU/UK");
    return;
  }

  const shouldCoachRespond = settings.coachEnabled && shouldTriggerCoach(text, questionDetected);
  if (shouldCoachRespond) {
    requestCoachHint(text);
  }

  pushStatus("Translating...");

  chrome.runtime.sendMessage({ type: "translate", text }, (response) => {
    if (chrome.runtime.lastError) {
      pushStatus(chrome.runtime.lastError.message, true);
      return;
    }

    if (!response?.ok) {
      pushStatus(response?.error || "Translation failed", true);
      return;
    }

    addTranslationItem(text, response.translatedText, response.cached);
    pushStatus("Listening...");
  });
}

function shouldSkipRecentCoach(questionText) {
  const now = Date.now();
  for (const [key, ts] of recentCoachQuestions.entries()) {
    if (now - ts > COACH_RECENT_TTL_MS) {
      recentCoachQuestions.delete(key);
    }
  }

  const key = questionText.trim().toLowerCase();
  const existing = recentCoachQuestions.get(key);
  if (existing && now - existing < COACH_RECENT_TTL_MS) {
    return true;
  }
  return false;
}

function requestCoachHint(questionText) {
  if (!settings.coachEnabled) {
    return;
  }

  const english = isEnglishQuestion(questionText);
  state.coachCurrentQuestion = questionText;
  state.coachResponses = {};
  setCoachTabsVisible(english);
  setCoachActiveTab(english ? "uk" : "same");
  pushCoachHint(questionText, "Thinking...");

  if (english) {
    requestCoachHintVariant(questionText, "uk");
    requestCoachHintVariant(questionText, "en");
    return;
  }

  requestCoachHintVariant(questionText, "same");
}

function requestCoachHintVariant(questionText, coachLanguage, force = false) {
  const dedupeKey = `${coachLanguage}|${questionText.trim().toLowerCase()}`;
  if (!force && shouldSkipRecentCoach(dedupeKey)) {
    return;
  }

  chrome.runtime.sendMessage({ type: "coach", text: questionText, coachLanguage }, (response) => {
    if (chrome.runtime.lastError) {
      if (coachLanguage === state.coachActiveTab || coachLanguage === "same") {
        pushCoachHint(questionText, chrome.runtime.lastError.message);
      }
      return;
    }
    if (!response?.ok) {
      if (coachLanguage === state.coachActiveTab || coachLanguage === "same") {
        pushCoachHint(questionText, response?.error || "Coach failed");
      }
      return;
    }

    state.coachResponses[coachLanguage] = response.coachText || "";
    recentCoachQuestions.set(`${coachLanguage}|${questionText.trim().toLowerCase()}`, Date.now());
    if (
      coachLanguage === state.coachActiveTab ||
      (coachLanguage === "same" && state.coachActiveTab === "same")
    ) {
      pushCoachHint(questionText, state.coachResponses[coachLanguage]);
    }
  });
}

function scheduleCaptionProcessing(text, speaker = "") {
  const normalizedSpeaker = normalizeSpeakerLabel(speaker || "");
  const incomingIsSelf = normalizedSpeaker ? isSelfSpeaker(normalizedSpeaker) : false;
  if (incomingIsSelf) {
    return;
  }

  const incomingHasSpeaker = Boolean(normalizedSpeaker);
  const existingSpeaker = normalizeSpeakerLabel(pendingCaption?.speaker || "");
  const existingHasSpeaker = Boolean(existingSpeaker);

  // Do not let anonymous/empty-speaker updates overwrite a concrete speaker caption.
  if (pendingCaption && existingHasSpeaker && !incomingHasSpeaker) {
    return;
  }

  pendingCaption = { text, speaker };
  if (pendingCaptionTimer) {
    clearTimeout(pendingCaptionTimer);
  }

  pendingCaptionTimer = setTimeout(() => {
    const next = pendingCaption;
    pendingCaption = null;
    pendingCaptionTimer = null;
    if (next?.text) {
      processCaptionText(next.text, next.speaker || "");
    }
  }, STABLE_CAPTION_DELAY_MS);
}

function isMeetCaptionRegion(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  if (element.classList.contains("vNKgIf")) {
    return true;
  }

  const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
  if (!ariaLabel) {
    return false;
  }

  return ariaLabel.includes("caption") || ariaLabel.includes("субтитр");
}

function parseCaptionRow(rowEl) {
  if (!rowEl) {
    return { text: "", speaker: "" };
  }

  const speaker = normalizeText(rowEl.querySelector(".NWpY1d")?.textContent || "");
  const text = normalizeText(rowEl.querySelector(".ygicle, .VbkSUe")?.textContent || "");
  return { text, speaker };
}

function getLatestMeetCaption(root = document) {
  const regions = [...root.querySelectorAll("[role='region'][aria-label], .vNKgIf.UDinHf")].filter(
    isMeetCaptionRegion
  );

  for (const region of regions) {
    const rows = region.querySelectorAll(".nMcdL");
    if (rows.length > 0) {
      const latestRow = rows[rows.length - 1];
      const parsed = parseCaptionRow(latestRow);
      if (parsed.text) {
        return parsed;
      }
    }

    const latestTextEl = region.querySelector(".ygicle:last-of-type, .VbkSUe:last-of-type");
    const fallbackText = normalizeText(latestTextEl?.textContent || "");
    if (fallbackText) {
      return { text: fallbackText, speaker: "" };
    }
  }

  return { text: "", speaker: "" };
}

function extractPotentialCaptions(node) {
  if (!node) {
    return [];
  }

  const captions = [];

  if (node.nodeType === Node.TEXT_NODE) {
    const parent = node.parentElement;
    const row = parent?.closest(".nMcdL");
    if (row) {
      const parsed = parseCaptionRow(row);
      if (parsed.text) {
        captions.push(parsed);
      }
      return captions;
    }

    const meetCaptionEl = parent?.closest(".ygicle, .VbkSUe");
    if (meetCaptionEl) {
      const value = normalizeText(meetCaptionEl.textContent || "");
      if (value) {
        const speaker = normalizeText(meetCaptionEl.closest(".nMcdL")?.querySelector(".NWpY1d")?.textContent || "");
        captions.push({ text: value, speaker });
      }
      return captions;
    }

    const value = normalizeText(node.textContent || "");
    if (value) {
      captions.push({ text: value, speaker: "" });
    }
    return captions;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return captions;
  }

  const element = node;
  if (element.matches(".nMcdL")) {
    const parsed = parseCaptionRow(element);
    if (parsed.text) {
      captions.push(parsed);
      return captions;
    }
  }

  if (element.matches(".ygicle, .VbkSUe")) {
    const ownText = normalizeText(element.textContent || "");
    if (ownText) {
      const speaker = normalizeText(element.closest(".nMcdL")?.querySelector(".NWpY1d")?.textContent || "");
      captions.push({ text: ownText, speaker });
      return captions;
    }
  }

  const nestedCaptionEls = element.querySelectorAll?.(".ygicle, .VbkSUe");
  if (nestedCaptionEls && nestedCaptionEls.length > 0) {
    for (const captionEl of nestedCaptionEls) {
      const captionText = normalizeText(captionEl.textContent || "");
      if (captionText) {
        const speaker = normalizeText(captionEl.closest(".nMcdL")?.querySelector(".NWpY1d")?.textContent || "");
        captions.push({ text: captionText, speaker });
      }
    }
    if (captions.length > 0) {
      return captions;
    }
  }

  const captionRegion = element.closest("[role='region'][aria-label], .vNKgIf.UDinHf");
  if (captionRegion && isMeetCaptionRegion(captionRegion)) {
    const latest = getLatestMeetCaption(captionRegion);
    if (latest.text) {
      captions.push(latest);
      return captions;
    }
  }

  const ariaLive = element.closest("[aria-live='polite'], [aria-live='assertive']");
  if (!ariaLive) {
    return captions;
  }

  const directText = normalizeText(element.textContent || "");
  if (directText) {
    captions.push({ text: directText, speaker: "" });
  }

  return captions;
}

function watchCaptions() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const captions = extractPotentialCaptions(mutation.target);
        for (const caption of captions) {
          scheduleCaptionProcessing(caption.text, caption.speaker);
        }
      }

      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          const captions = extractPotentialCaptions(node);
          for (const caption of captions) {
            scheduleCaptionProcessing(caption.text, caption.speaker);
          }
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true
  });

  if (fallbackScanTimer) {
    clearInterval(fallbackScanTimer);
  }

  fallbackScanTimer = setInterval(() => {
    const latest = getLatestMeetCaption(document);
    if (latest.text) {
      scheduleCaptionProcessing(latest.text, latest.speaker);
    }
  }, FALLBACK_SCAN_INTERVAL_MS);
}

function isScreenSharingActive() {
  const nodes = document.querySelectorAll("[aria-label], [title], [data-tooltip]");
  for (const node of nodes) {
    const haystack = [
      node.getAttribute("aria-label") || "",
      node.getAttribute("title") || "",
      node.getAttribute("data-tooltip") || ""
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack) {
      continue;
    }
    if (PRESENTING_TOKENS.some((token) => haystack.includes(token))) {
      return true;
    }
  }
  return false;
}

function isStartPresentActionNode(node) {
  const button = node?.closest?.("button, [role='button']");
  if (!button) {
    return false;
  }

  const iconText = normalizeText(button.querySelector("i.google-symbols")?.textContent || "").toLowerCase();
  if (iconText === "computer_arrow_up") {
    return true;
  }

  const text = [
    button.getAttribute("aria-label") || "",
    button.getAttribute("title") || "",
    button.getAttribute("data-tooltip") || "",
    button.textContent || ""
  ]
    .join(" ")
    .toLowerCase();

  return START_PRESENTING_TOKENS.some((token) => text.includes(token));
}

function watchPresentButtonClicks() {
  document.addEventListener(
    "click",
    (event) => {
      if (!settings.panelVisible) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (!isStartPresentActionNode(target)) {
        return;
      }
      hidePanelPersist().catch(() => {});
      pushStatus("Panel hidden while starting screen share");
    },
    true
  );
}

function watchScreenShare() {
  if (screenShareWatchTimer) {
    clearInterval(screenShareWatchTimer);
  }

  screenShareWatchTimer = setInterval(() => {
    if (isScreenSharingActive()) {
      hidePanelPersist().catch(() => {});
    }
  }, SCREEN_SHARE_CHECK_INTERVAL_MS);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "showPanel") {
    applyPanelVisibility(true);
    updateSetting("panelVisible", true)
      .then(() => sendResponse({ ok: true, visible: true }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to show panel" }));
    return true;
  }

  if (message?.type === "hidePanel") {
    applyPanelVisibility(false);
    updateSetting("panelVisible", false)
      .then(() => sendResponse({ ok: true, visible: false }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to hide panel" }));
    return true;
  }

  if (message?.type === "panelState") {
    sendResponse({
      ok: true,
      visible: Boolean(settings.panelVisible),
      mounted: Boolean(state.isMounted),
      position: settings.panelPosition || "right"
    });
    return false;
  }

  if (message?.type === "setPanelPosition") {
    const nextPosition = String(message.position || "right");
    applyPanelPosition(nextPosition);
    updateSetting("panelPosition", nextPosition)
      .then(() => sendResponse({ ok: true, position: nextPosition }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Failed to set position" }));
    return true;
  }

  return false;
});

(async function init() {
  await loadSettings();
  mountUi();
  watchPresentButtonClicks();
  watchCaptions();
  watchScreenShare();
})();
