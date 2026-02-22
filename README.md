# feelcalm (Chrome Extension)

Browser extension for Google Meet that reads live captions and translates English speech to Ukrainian (or Russian) in real time.

## What is implemented

- Manifest V3 extension scaffold.
- Content script for Meet pages (`https://meet.google.com/*`).
- Overlay UI inside Meet page:
  - on/off translation toggle,
  - target language selector (`UKR` / `RUS`),
  - translated message feed.
- Background service worker translation pipeline using OpenAI API.
- In-memory translation cache to reduce cost and latency.
- Options page to configure:
  - OpenAI API key,
  - model name,
  - default target language,
  - enabled state.

## Quick start (development)

1. Install dependencies:
   - `npm install`
2. Build extension:
   - `npm run build`
3. Open Chrome: `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select:
   - `/Users/macbook_13_1278/feelcalm/dist`
6. Open extension options and paste your OpenAI API key.
7. Join a Google Meet call and enable captions.

## Project structure

- Static extension files: `public/`
  - `public/manifest.json`
  - `public/popup.html`
  - `public/options.html`
  - `public/content.css`
  - `public/icons/*`
- React UI source:
  - `src/popup/App.jsx` + `src/popup/main.jsx`
  - `src/options/App.jsx` + `src/options/main.jsx`
- Shared reusable UI components:
  - `src/shared/components/*`
- Build output:
  - `dist/` (bundled scripts + copied static files from `public/`)

## Build for release

1. Install dependencies:
   - `npm install`
2. Build minified extension:
   - `npm run build`
3. Build minified + obfuscated extension:
   - `npm run build:protected`
4. In Chrome load unpacked extension from:
   - `/Users/macbook_13_1278/feelcalm/dist`

## CI/CD

- Any `push` to repository runs CI build (`npm install` + `npm run build:protected`).
- GitHub Release is created automatically only when `version` in `package.json` changes and commit is pushed to default branch.
- Release artifacts include zip archive:
  - `feelcalm-<version>.zip`

## Notes / limitations (current MVP)

- It relies on Meet captions being enabled.
- Caption extraction uses DOM + `aria-live` heuristics, so it may require selector tuning if Google updates Meet UI.
- API key is stored in `chrome.storage.sync` (plain storage for now; harden before production).
- No speaker diarization yet.
- No batching or rate-limiting queue yet.

## Next improvements

- Add stronger Meet-specific selectors and fallback strategies.
- Add translation queue/debounce for very fast speech.
- Add speaker label mapping.
- Add optional local/offline translation mode.
- Add glossary and interview-domain prompt tuning.
