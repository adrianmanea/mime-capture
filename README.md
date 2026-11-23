# Mime Capture

Copy any UI component on the web as an AI-ready prompt.

Mime Capture is a Chrome extension that lets you hover and click any element on a webpage. It captures the element's HTML, the relevant CSS, interactive states and a screenshot, and packages them into a prompt you can paste into your AI coding tool, or a JSON file.

## Features

- **Visual selection**: hover to highlight and click to capture. Smart targeting picks the button, not the SVG path inside it
- **Keyboard refinement**: `Enter` to drill into a child, `Shift+Enter` to select the parent, `Esc` to close
- **Lean styles**: computed styles are diffed against browser defaults, so only what matters is kept
- **Real CSS rules**: pulls matching rules from every stylesheet, including cross-origin ones, plus `:hover`, `:focus` and `:active` states
- **Framework aware**: detects Tailwind, Bootstrap, Radix UI and Material UI
- **Screenshot**: a DPI-aware crop of the element
- **Three capture strategies**: fast (`optimal`), interactive (`tactic`) and text-only (`precise-v2`)
- **Isolated UI**: runs in Shadow DOM, so it never clashes with the page's styles
- **No build step**: plain JavaScript

## Install

1. Clone this repo
2. Open `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select the repo folder
4. Pin the extension and click its icon on any page

## Usage

1. Click the toolbar icon to activate it on the current tab
2. Hover over the component you want and click it
3. Pick a strategy, then **Copy as AI Prompt** or **Download JSON**

## Capture Strategies

| Strategy | Screenshot | Interactions | Speed |
|----------|-----------|-------------|-------|
| `optimal` (default) | Yes | No | 100-500ms |
| `tactic` | Yes (frozen) | Yes (hover/focus/active) | 2-5s |
| `precise-v2` | No | No | 50-200ms |

## Privacy

Everything runs locally in your browser. Nothing is sent anywhere unless you configure your own backend (`src/utils/api-client.js`) or analytics endpoint (`src/utils/analytics.js`), and both are empty by default.

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): modules, pipeline, output format
- [HOW_IT_WORKS.md](HOW_IT_WORKS.md): step-by-step walkthrough and optional backend contract

## License

[MIT](LICENSE) © Adrian Manea, [hiadrian.dev](https://hiadrian.dev)
