const DEFAULT_SETTINGS = {
  enabled: true,
  targetLang: "uk",
  model: "gpt-4o-mini",
  coachEnabled: true,
  apiKey: ""
};

const CACHE_TTL_MS = 45_000;
const MAX_CACHE_SIZE = 300;
const translationCache = new Map();

async function getSettings() {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getCoachResumeContext() {
  const data = await chrome.storage.local.get({ coachResumeContext: "" });
  const value = String(data.coachResumeContext || "").trim();
  return value.slice(0, 6000);
}

function detectQuestionLanguage(text) {
  const value = String(text || "").toLowerCase();
  const hasCyr = /[а-яёіїєґ]/i.test(value);
  if (!hasCyr) {
    return "en";
  }

  const hasUkLetters = /[іїєґ]/i.test(value);
  const hasRuLetters = /[ыэёъ]/i.test(value);
  const ukHits = (value.match(/\b(як|чому|де|коли|який|яка|які|можете|можеш|будь ласка|приклад)\b/g) || [])
    .length;
  const ruHits = (value.match(/\b(как|почему|где|когда|какой|какая|какие|можете|можешь|пожалуйста|пример)\b/g) || [])
    .length;

  if (hasUkLetters && !hasRuLetters) {
    return "uk";
  }
  if (hasRuLetters && !hasUkLetters) {
    return "ru";
  }
  if (ukHits > ruHits) {
    return "uk";
  }
  if (ruHits > ukHits) {
    return "ru";
  }

  return "ru";
}

function cleanCache() {
  const now = Date.now();
  for (const [key, value] of translationCache.entries()) {
    if (now - value.ts > CACHE_TTL_MS) {
      translationCache.delete(key);
    }
  }

  if (translationCache.size <= MAX_CACHE_SIZE) {
    return;
  }

  const entries = [...translationCache.entries()].sort((a, b) => a[1].ts - b[1].ts);
  const toRemove = entries.slice(0, translationCache.size - MAX_CACHE_SIZE);
  for (const [key] of toRemove) {
    translationCache.delete(key);
  }
}

function buildCacheKey(text, targetLang, model) {
  return `${targetLang}|${model}|${text.trim().toLowerCase()}`;
}

function buildCoachCacheKey(question, model, coachLanguage) {
  return `coach|${coachLanguage}|${model}|${question.trim().toLowerCase()}`;
}

async function translateWithOpenAI({ apiKey, model, sourceText, targetLang }) {
  const targetLabel = targetLang === "uk" ? "Ukrainian" : "Russian";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You translate live interview captions with high fidelity. Keep technical terms and product names unchanged when appropriate (e.g., React, TypeScript, DataDog). Return only translated text, no notes."
        },
        {
          role: "user",
          content: `Translate from English to ${targetLabel}:\n\n${sourceText}`
        }
      ]
    })
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    const errorType = payload?.error?.type || "";
    const errorMessage = payload?.error?.message || "";

    if (response.status === 429 && errorType === "insufficient_quota") {
      throw new Error(
        "OpenAI API quota exceeded. Add billing/credits in platform.openai.com, then retry."
      );
    }

    if (response.status === 401 || errorType === "invalid_api_key") {
      throw new Error("Invalid OpenAI API key. Check key in Settings.");
    }

    if (response.status === 404 || errorType === "model_not_found") {
      throw new Error(`Model not available: ${model}`);
    }

    const fallback = errorMessage || "Unknown API error";
    throw new Error(`OpenAI API error ${response.status}: ${fallback.slice(0, 220)}`);
  }

  const data = await response.json();
  const translated = data?.choices?.[0]?.message?.content?.trim();
  if (!translated) {
    throw new Error("Empty translation response");
  }

  return translated;
}

async function coachWithOpenAI({ apiKey, model, questionText, coachLanguage }) {
  let languageRule = "Reply only in Russian.";
  if (coachLanguage === "uk") {
    languageRule = "Reply only in Ukrainian.";
  } else if (coachLanguage === "en") {
    languageRule = "Reply only in English.";
  } else if (coachLanguage === "ru") {
    languageRule = "Reply only in Russian.";
  } else {
    const detected = detectQuestionLanguage(questionText);
    if (detected === "en") {
      languageRule = "Reply only in English.";
    } else if (detected === "uk") {
      languageRule = "Reply only in Ukrainian.";
    } else {
      languageRule = "Reply only in Russian.";
    }
  }

  const resumeContext = await getCoachResumeContext();
  const profileBlock = resumeContext
    ? `Candidate profile/resume context (facts to align with):\n${resumeContext}`
    : "Candidate profile/resume context is not provided.";

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            `You are an interview response coach. Help candidate answer honestly and clearly. ${languageRule}
Use a simple, natural speaking style (not formal/corporate).
Output format must be exactly 3 short lines:
1) "Keywords: ..." with 4-7 key words/phrases that represent the answer strategy, not just words copied from the question.
Keywords should emphasize depth and execution quality (for example when relevant: architecture approach, async/events, idempotency, retries, error handling, monitoring, race conditions, rate limits, data consistency, security, observability, rollback).
Keywords must be extracted from the best-practice solution you are giving in the answer, not from the interviewer wording.
Prefer senior-level engineering terms when relevant: versioning strategy, backward compatibility, deprecation policy, migration plan, contract testing, canary rollout, feature flags, SLO/SLA, alerting, incident rollback.
Do not include generic filler words in Keywords.
2) "Answer: ..." short direct answer in plain language (2-4 sentences max).
3) "Example: ..." one concrete example from candidate profile if available, otherwise a safe generic example.
When useful, structure the answer in a lightweight STAR style (Situation/Task/Action/Result) but keep it brief and natural.
Do not ask any follow-up question. No markdown.
Strictly align with candidate profile facts; do not invent roles, years, companies, or technologies that conflict with profile.`
        },
        {
          role: "system",
          content: profileBlock
        },
        {
          role: "user",
          content: `Interviewer question:\n${questionText}`
        }
      ]
    })
  });

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const errorMessage = payload?.error?.message || "Unknown API error";
    throw new Error(`Coach API error ${response.status}: ${errorMessage.slice(0, 220)}`);
  }

  const data = await response.json();
  const coachTextRaw = data?.choices?.[0]?.message?.content?.trim();
  const coachText = (coachTextRaw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n");
  if (!coachText) {
    throw new Error("Empty coach response");
  }
  return coachText;
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  await chrome.storage.sync.set({ ...DEFAULT_SETTINGS, ...current });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "openOptions") {
    chrome.runtime.openOptionsPage(() => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message?.type !== "translate" && message?.type !== "coach") {
    return false;
  }

  (async () => {
    try {
      const settings = await getSettings();
      if (message.type === "translate" && !settings.enabled) {
        sendResponse({ ok: false, error: "Translation is disabled" });
        return;
      }

      if (!settings.apiKey) {
        sendResponse({ ok: false, error: "API key is not configured" });
        return;
      }

      const sourceText = String(message.text || "").trim();
      if (!sourceText) {
        sendResponse({ ok: false, error: "Empty source text" });
        return;
      }

      cleanCache();

      if (message.type === "translate") {
        const cacheKey = buildCacheKey(sourceText, settings.targetLang, settings.model);
        const cached = translationCache.get(cacheKey);
        if (cached) {
          sendResponse({ ok: true, translatedText: cached.value, cached: true });
          return;
        }

        const translatedText = await translateWithOpenAI({
          apiKey: settings.apiKey,
          model: settings.model,
          sourceText,
          targetLang: settings.targetLang
        });

        translationCache.set(cacheKey, { value: translatedText, ts: Date.now() });
        sendResponse({ ok: true, translatedText, cached: false });
        return;
      }

      if (!settings.coachEnabled) {
        sendResponse({ ok: false, error: "Coach is disabled in settings" });
        return;
      }

      const coachLanguage = String(message.coachLanguage || "same");
      const coachCacheKey = buildCoachCacheKey(sourceText, settings.model, coachLanguage);
      const coachCached = translationCache.get(coachCacheKey);
      if (coachCached) {
        sendResponse({ ok: true, coachText: coachCached.value, cached: true });
        return;
      }

      const coachText = await coachWithOpenAI({
        apiKey: settings.apiKey,
        model: settings.model,
        questionText: sourceText,
        coachLanguage
      });

      translationCache.set(coachCacheKey, { value: coachText, ts: Date.now() });
      sendResponse({ ok: true, coachText, cached: false });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Unknown translation error" });
    }
  })();

  return true;
});
