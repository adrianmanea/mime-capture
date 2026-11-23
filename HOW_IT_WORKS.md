# How It Works

A step-by-step walkthrough of what happens from clicking the toolbar icon to copying a prompt. See [ARCHITECTURE.md](ARCHITECTURE.md) for the module reference.

---

## 1. Activation

Manifest V3 with three entry points:

- **Service worker** (`src/background/service-worker.js`): background state
- **Content script** (`src/content/loader.js` → `main.js`): injected on `<all_urls>`
- **Popup** (`src/popup/popup.html`): minimal status popup

Clicking the toolbar icon toggles a per-tab state:

```
activeTabs Set tracks enabled tabs
→ sends { type: "TOGGLE_MIME", enabled: true, sessionId }
→ content script activates the UI
→ badge shows "ON" (#0099ff)
```

## 2. Shadow DOM Injection

1. Create `<div id="mime-extension-root">`
2. `attachShadow({ mode: 'open' })`
3. Render toolbar, overlay and modal inside the shadow root

Shadow DOM keeps the extension's styles and the host page's styles from leaking into each other. Max z-index values keep the UI on top.

## 3. Element Selection

```
Raw mouse target
↓
Inside <button> or <a>?                     → select it
↓ no
Inside <li>, <article>, <tr>, [role=listitem]? → select it
↓ no
<svg>, <path>, <i>, <img>?                  → select parent
↓ no
Smaller than 20×20px?                       → select parent
↓ no
Select the element itself
```

This stops you from accidentally grabbing a tiny `<path>` when you meant the button around it. `Enter` drills in and `Shift+Enter` goes up to the parent.

## 4. Click → Screenshot

On click the screenshot is taken *before* the modal opens:

1. Hide `#mime-extension-root`, wait 2 animation frames
2. `CAPTURE_TAB` → service worker → `chrome.tabs.captureVisibleTab()`
3. Draw on `<canvas>`, crop to `getBoundingClientRect()`
4. Scale `Math.min(devicePixelRatio, 1.5)`
5. `canvas.toDataURL('image/jpeg', 0.85)`
6. Restore the UI

## 5. Modal

Shows the screenshot preview, a strategy choice (Fast / Interactive), and two actions: **Copy as AI Prompt** and **Download JSON**. The 4-box overlay darkens the rest of the page.

## 6. Capture Pipeline

`capture-orchestrator.js` runs:

- **DOM walk**: tree with `data-mime-id` on every node, plus assets
- **Style extraction**: computed styles diffed against per-tag defaults from a hidden iframe
- **CSS rules**: matching rules from every stylesheet. CORS-blocked sheets are fetched via the service worker (`FETCH_RESOURCE`). State rules (`:hover`, etc.) are kept separately. `@media`, `@supports`, `@font-face` and `@import` are handled
- **Framework detection**: Tailwind, Bootstrap, Radix, MUI → generated state CSS
- **Interaction recording** (`tactic` only): simulated hover/focus, style diffs captured with a `MutationObserver`, animations frozen before the screenshot

`precise-v2` runs only the DOM walk and style extraction.

## 7. Export

The capture becomes a prompt containing:

- Source URL, dimensions, detected frameworks
- HTML in a code block
- Computed styles as JSON
- Interactive state CSS
- Instructions for the AI (match colors, be responsive, etc.)

It is copied with `navigator.clipboard.writeText()`, or you can download the full JSON.

---

## Optional: Running Your Own Backend

The extension is fully functional without a server. To enable capture storage and AI generation, host a backend that implements:

| Service | Endpoint(s) | Notes |
|---------|-------------|-------|
| Auth | `POST /api/auth/refresh`, login page | Login page calls `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'MIME_AUTH_CALLBACK', session })`. Add your domain to `externally_connectable` in `manifest.json` |
| Captures | `POST /api/captures` | Stores the payload. Screenshots are base64 JPEG, so put them in blob storage |
| Generation | `POST /api/generate` | `{ captureId, format: "react"\|"vue"\|"html", cssFramework: "tailwind"\|"css" }` → feeds the capture to an LLM |
| Usage | `GET /api/usage` | Returns current usage and limits. Cached as `mimeUsage` |
| Billing | `POST /api/checkout` | `{ price_id, success_url, cancel_url }` → checkout session URL |
| Analytics | any PostHog-compatible endpoint | `{ api_key, event, distinct_id, properties }`. PII is stripped client-side |

Values to configure:

1. `src/utils/api-client.js`: `API_BASE`
2. `src/utils/analytics.js`: `ANALYTICS_ENDPOINT`, `ANALYTICS_API_KEY`
3. `manifest.json`: `externally_connectable` for your auth domain
