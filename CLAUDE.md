# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working with this repo.

## What This Is

Mime Capture — Chrome Manifest V3 extension. Lets users visually select UI components on any webpage, captures HTML/CSS/screenshot, exports as AI-ready prompts or JSON. Vanilla JS, no build step — load directly in Chrome via `chrome://extensions` with Developer Mode.

## Loading the Extension

1. Open `chrome://extensions`, enable Developer Mode
2. Click "Load unpacked", select repo root
3. Extension injects into all pages via `src/content/loader.js`

## Architecture

**Two execution contexts communicate via `chrome.runtime.sendMessage()`:**

- **Service Worker** (`src/background/service-worker.js`) — Tab toggle, screenshot proxy (`captureVisibleTab`), CORS bypass for external stylesheets, API request proxying, auth session management. All network requests from content scripts route here.

- **Content Script** (`src/content/loader.js` → `src/content/main.js`) — Renders UI in Shadow DOM (`#mime-extension-root`) to avoid CSS conflicts. Handles hover/selection, highlight overlay, toolbar, capture modal. Hand-rolled reactive render loop (no React).

**Capture Pipeline** (`src/utils/capture-orchestrator.js` orchestrates all modules):

1. `dom-walker.js` — Recursive DOM serialization, assigns `data-mime-id` UUIDs, collects image/SVG/font assets
2. `style-extractor.js` — Computed style extraction with default-diffing via hidden iframe (keeps only non-default values, ~70% size reduction)
3. `css-rules-extractor.js` — Iterates `document.styleSheets`, CORS-blocked sheets fetched via service worker, separates state pseudo-classes (`:hover`, `:focus`, etc.) from global rules, rewrites selectors to use `data-mime-id`
4. `screenshot.js` — DPI-aware element screenshot (capped at 1.5x devicePixelRatio), JPEG 85% quality
5. `framework-detector.js` — Auto-detects Tailwind/Bootstrap/Radix/MUI, generates framework-specific state CSS
6. `interaction-recorder.js` — Simulates hover/focus events, records style diffs via MutationObserver (tactic strategy only)

**Supporting modules:**
- `api-client.js` — Server comms with auth token refresh. API base URL placeholder (`https://your-api-domain.com`)
- `analytics.js` — PostHog-compatible event tracking with PII stripping. Endpoint unconfigured by default

## Three Capture Strategies

| Strategy | Screenshot | Interactions | Speed |
|----------|-----------|-------------|-------|
| `optimal` (default) | Yes | No | 100-500ms |
| `tactic` | Yes (frozen) | Yes (hover/focus/active) | 2-5s |
| `precise-v2` | No | No | 50-200ms |

## Key Patterns

- **Message types** between content script and service worker: `TOGGLE_MIME`, `CAPTURE_TAB`, `FETCH_RESOURCE`, `API_FETCH`, `MIME_AUTH_CALLBACK`, `GET_AUTH_SESSION`, `SIGN_OUT`, `SIGN_IN`, `OPEN_TAB`
- **Shadow DOM z-index hierarchy**: Overlay `2147483645` → Modal `2147483646` → Toolbar `2147483647`
- **4-box darkening overlay**: Four absolutely-positioned dark boxes surround selected element during recording
- **Smart element selection**: Prefers semantic containers (button, a) over raw targets; navigable with Enter (drill in) / Shift+Enter (parent)
- **Selector rewriting**: CSS selectors rewritten to use `[data-mime-id="..."]` for portability in exported output