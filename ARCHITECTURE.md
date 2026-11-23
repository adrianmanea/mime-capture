# Architecture

Mime Capture is a Chrome Manifest V3 extension that lets you visually select any UI component on a webpage, captures its HTML, CSS and a screenshot, and exports it as an AI-ready prompt or JSON. Optionally, captures can be sent to your own backend for AI code generation.

Vanilla JavaScript, no build step.

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Chrome Extension                      │
│                                                             │
│  ┌───────────────┐   ┌──────────────────────────────────┐   │
│  │ Service Worker│   │         Content Script           │   │
│  │ (Background)  │   │    (Injected into every page)    │   │
│  │               │   │                                  │   │
│  │ • Tab toggle  │◄──┤  ┌────────────────────────────┐  │   │
│  │ • Screenshot  │   │  │      Shadow DOM Root       │  │   │
│  │ • CORS proxy  │──►│  │  • Highlight overlay       │  │   │
│  │ • API proxy   │   │  │  • Toolbar                 │  │   │
│  │ • Auth mgmt   │   │  │  • Capture modal           │  │   │
│  └───────────────┘   │  └────────────────────────────┘  │   │
│                      │                                  │   │
│                      │  ┌────────────────────────────┐  │   │
│                      │  │      Capture Pipeline      │  │   │
│                      │  │  1. DOM Walker             │  │   │
│                      │  │  2. Style Extractor        │  │   │
│                      │  │  3. CSS Rules Extractor    │  │   │
│                      │  │  4. Screenshot Capture     │  │   │
│                      │  │  5. Framework Detector     │  │   │
│                      │  │  6. Interaction Recorder   │  │   │
│                      │  └────────────────────────────┘  │   │
│                      └──────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼  (optional)
                 ┌──────────────────────────┐
                 │    Your backend API      │
                 │  • POST /api/captures    │
                 │  • POST /api/generate    │
                 │  • GET  /api/usage       │
                 │  • POST /api/checkout    │
                 └──────────────────────────┘
```

---

## File Structure

| File | Purpose |
|------|---------|
| `manifest.json` | Manifest V3 config |
| `src/background/service-worker.js` | Tab toggle, screenshot, CORS proxy, API proxy, auth session |
| `src/content/loader.js` | Content script entry, dynamically imports `main.js` |
| `src/content/main.js` | Shadow DOM UI, element selection, toolbar, modal, export |
| `src/popup/popup.html` | Minimal popup |
| `src/utils/capture-orchestrator.js` | Runs the capture pipeline |
| `src/utils/dom-walker.js` | DOM serialization + asset collection |
| `src/utils/style-extractor.js` | Computed styles with default-diffing |
| `src/utils/css-rules-extractor.js` | Matching stylesheet rules, state rules, fonts |
| `src/utils/screenshot.js` | DPI-aware element screenshot |
| `src/utils/framework-detector.js` | Tailwind / Bootstrap / Radix / MUI detection |
| `src/utils/interaction-recorder.js` | Hover/focus simulation + style diffs |
| `src/utils/api-client.js` | Optional backend client with token refresh |
| `src/utils/analytics.js` | Optional PostHog-compatible analytics (off by default) |

---

## Capture Pipeline

### Three Strategies

| Strategy | Speed | Screenshot | Interactions | Use Case |
|----------|-------|-----------|--------------|----------|
| `optimal` | 100-500ms | Yes | No | Default fast capture |
| `tactic` | 2-5 seconds | Yes (frozen) | Yes (hover/focus/active) | Interactive components |
| `precise-v2` | 50-200ms | No | No | Lightweight, text-only |

### Step 1: DOM Walking (`dom-walker.js`)
- Recursively walks the selected subtree
- Assigns a `data-mime-id` UUID to every element (mutates the DOM in place)
- Skips `<script>`, `<style>`, `<iframe>`, `<meta>`, `<link>`, `<noscript>`
- Extracts class, id, `data-*`, `aria-*`, form and SVG attributes
- Collects `<img>` sources, inline SVGs, background-image URLs
- Records Shadow DOM hosts as a `shadow-host` node type
- Returns a nested tree `{ type, tagName, id, attributes, children }`

### Step 2: Style Extraction (`style-extractor.js`)
- `getComputedStyle()` per element
- Compares against cached default styles per tag (computed in a hidden iframe)
- Keeps only non-default values (~70% size reduction)
- Also extracts `::before` / `::after` styles

### Step 3: CSS Rule Extraction (`css-rules-extractor.js`)
- Iterates `document.styleSheets`
- CORS-blocked sheets are fetched via the service worker (`FETCH_RESOURCE`)
- Keeps rules whose selector matches an element in the subtree
- Handles `@media`, `@supports` (recursive), `@font-face`, `@import`
- State pseudo-classes (`:hover`, `:focus`, `:active`, `:visited`, `:checked`) stored separately
- Selectors rewritten to `[data-mime-id="..."]` for portability

### Step 4: Screenshot (`screenshot.js`)
1. Hide the extension UI (`#mime-extension-root`)
2. Service worker calls `chrome.tabs.captureVisibleTab()`
3. Load the PNG into a `<canvas>`, crop to the element rect
4. DPI scale capped at 1.5x `devicePixelRatio`
5. Export as JPEG, 85% quality
6. Restore the extension UI

### Step 5: Framework Detection (`framework-detector.js`)

| Framework | Detection | State CSS Generation |
|-----------|-----------|---------------------|
| **Tailwind** | `hover:` class prefixes | `hover:bg-blue-500` → `background-color: #3b82f6` |
| **Bootstrap** | `.btn`, `.dropdown`, `.modal` | `.dropdown:hover .dropdown-menu { display: block }` |
| **Radix UI** | `data-state`, `data-radix-*` | `[data-state="open"]` tracking |
| **Material UI** | `Mui*` class prefixes | Disabled/hover/selected state CSS |

### Step 6: Interaction Recording (`tactic` only)
1. Snapshot initial computed styles
2. `MutationObserver` on `{ attributes: true, subtree: true }`
3. Per interactive element: `mouseover` → wait → `focus`/`blur` → `mouseout`
4. Record before/after style diffs
5. Freeze animations (`animation: none !important; transition: none !important;`)
6. Screenshot the frozen state
7. Return `[{ mimeId, state, styleDiff }]`

### Output Structure

```javascript
{
  meta: { url, title, timestamp, viewport, bounds, strategy, captureTimeMs, screenshot },
  dom: { type, tagName, id, attributes, children },
  styles: { [mimeId]: { display, color, ... } },
  globalRules: [{ selector, cssText, mimeId, mediaContext? }],
  stateRules: [{ selector, cssText, mimeId, pseudo }],
  assets: { images: [...], svgs: [...], fonts: [...] },
  analysis: { frameworks, hasAnimations, hasInteractivity },
  interactiveElements: [{ tag, mimeId, type, role, text }],
  stateChanges: [{ mimeId, state, styleDiff }],  // tactic only
  recordedStates: [],
  html: "..."
}
```

---

## UI

### Shadow DOM Isolation
- UI lives in `#mime-extension-root` with `attachShadow({ mode: 'open' })`
- Z-index: Overlay `2147483645` → Modal `2147483646` → Toolbar `2147483647`

### Element Selection
```
Hover element
  ↓
Smart selector: button/a > semantic container > SVG/icon parent > small element parent > element
  ↓
Blue highlight (2px border + 8% tint) + label "div.className — 320×240"
  ↓ click
Screenshot → modal with preview
```

### Keyboard
- `Enter` — drill into child
- `Shift+Enter` — select parent
- `Escape` — close

### 4-Box Darkening Overlay
Four absolutely positioned boxes darken everything except the selected element:
```
┌────────────────────────────┐
│          TOP (dark)        │
├──────┬─────────┬───────────┤
│ LEFT │ ELEMENT │   RIGHT   │
├──────┴─────────┴───────────┤
│        BOTTOM (dark)       │
└────────────────────────────┘
```

---

## Optional Backend

The extension works fully offline (copy prompt / download JSON). `api-client.js` contains an optional client for a backend you host yourself. Set `API_BASE` in `src/utils/api-client.js`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/captures` | POST | Store a capture |
| `/api/generate` | POST | AI code generation from a capture |
| `/api/usage` | GET | Quota / usage |
| `/api/auth/refresh` | POST | Refresh access token |
| `/api/checkout` | POST | Billing checkout session |

Auth: your website sends `MIME_AUTH_CALLBACK` with `{ access_token, refresh_token }` to the extension (requires an `externally_connectable` entry in `manifest.json`). Tokens are stored in `chrome.storage.local` under `mimeAuth`. On 401 the client refreshes once and retries.

All content-script requests are proxied through the service worker (`API_FETCH`), which follows up to 5 redirects manually.

## Analytics

Disabled by default. `src/utils/analytics.js` speaks the PostHog event format; set `ANALYTICS_ENDPOINT` and `ANALYTICS_API_KEY` to enable. Properties like `url`, `hostname`, `html`, `css`, `email`, `name`, `content` are stripped before sending.

## Storage Keys

| Key | Purpose |
|-----|---------|
| `mimeAuth` | `{ access_token, refresh_token }` |
| `mimeUsage` | Cached usage data |
| `analytics_distinct_id` | Anonymous analytics ID |
