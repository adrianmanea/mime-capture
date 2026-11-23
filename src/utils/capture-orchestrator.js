/**
 * Capture Orchestrator
 *
 * The main entry point for capturing an element. Orchestrates:
 * 1. DOM tree walking
 * 2. Style extraction (with default-diffing optimization)
 * 3. CSS rule extraction (with CORS handling)
 * 4. Screenshot capture (DPI-aware, JPEG 85%)
 * 5. Framework detection
 * 6. Interactive state recording (tactic mode)
 *
 * Three strategies:
 * - "optimal"    : Fast static capture with full screenshot
 * - "tactic"     : Slow, simulates hover/focus/active, records mutations
 * - "precise-v2" : Lightweight, no screenshot, no interactions
 */

import { walkDOM, treeToHTML } from './dom-walker.js';
import { extractAllStyles } from './style-extractor.js';
import { extractCSSRules } from './css-rules-extractor.js';
import { captureElementScreenshot } from './screenshot.js';
import { detectFrameworks, generateStateCSSForFramework } from './framework-detector.js';
import { startInteractionRecording, freezeAnimations } from './interaction-recorder.js';

/**
 * @typedef {Object} CaptureResult
 * @property {Object} meta - Page metadata, viewport, bounds, strategy
 * @property {Object} dom - Serializable DOM tree
 * @property {Object} styles - Per-element computed styles (keyed by mime-id)
 * @property {Array} globalRules - Matching CSS rules
 * @property {Array} stateRules - Hover/focus/active CSS rules
 * @property {Object} assets - Images, SVGs, fonts
 * @property {Object} analysis - Detected frameworks & interactivity flags
 * @property {string|null} screenshot - Base64 JPEG data URL
 * @property {Array} stateChanges - (tactic only) Recorded mutations
 * @property {string} html - Clean HTML reconstruction
 */

/**
 * Capture an element with the specified strategy.
 *
 * @param {Element} element - The target DOM element
 * @param {string} strategy - "optimal" | "tactic" | "precise-v2"
 * @param {Array} recordedStates - Pre-recorded user interaction states (optional)
 * @returns {Promise<CaptureResult>}
 */
export async function captureElement(element, strategy = 'optimal', recordedStates = []) {
  const startTime = performance.now();

  // --- 1. Metadata ---
  const rect = element.getBoundingClientRect();
  const meta = {
    url: window.location.href,
    title: document.title,
    timestamp: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    bounds: {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    },
    strategy,
  };

  // --- 2. DOM Walk ---
  const assets = { images: [], svgs: [], fonts: [] };
  const dom = walkDOM(element, assets);

  // --- 3. Style Extraction ---
  const styles = extractAllStyles(element);

  // --- 4. CSS Rule Extraction ---
  const { globalRules, stateRules, fonts } = await extractCSSRules(element);
  assets.fonts.push(...fonts);

  // --- 5. Framework Detection ---
  const frameworks = detectFrameworks(element);
  const frameworkStateCSS = generateStateCSSForFramework(element, frameworks);
  stateRules.push(...frameworkStateCSS);

  // --- 6. Screenshot (skip for precise-v2) ---
  let screenshot = null;
  if (strategy !== 'precise-v2') {
    try {
      if (strategy === 'tactic') {
        // Freeze animations before screenshot in tactic mode
        const unfreeze = freezeAnimations(element);
        // Force layout recalc
        await new Promise((r) => setTimeout(r, 50));
        screenshot = await captureElementScreenshot(element);
        unfreeze();
      } else {
        screenshot = await captureElementScreenshot(element);
      }
    } catch (err) {
      console.warn('[Mime] Screenshot capture failed:', err);
    }
  }

  // --- 7. Interactive State Recording (tactic only) ---
  let stateChanges = [];
  if (strategy === 'tactic') {
    stateChanges = await new Promise((resolve) => {
      const recorder = startInteractionRecording(element, () => {});
      // Let it run for up to 3 seconds
      setTimeout(() => {
        const changes = recorder.stop();
        resolve(changes);
      }, 3000);
    });
  }

  // --- 8. Build clean HTML ---
  const html = treeToHTML(dom);

  // --- 9. Detect interactivity ---
  const interactiveElements = [];
  element.querySelectorAll('a, button, input, select, textarea, [role="button"], [onclick]')
    .forEach((el) => {
      interactiveElements.push({
        tag: el.tagName.toLowerCase(),
        mimeId: el.getAttribute('data-mime-id'),
        type: el.type || null,
        role: el.getAttribute('role'),
        text: el.textContent?.trim().substring(0, 50),
      });
    });

  const captureTime = performance.now() - startTime;

  return {
    meta: {
      ...meta,
      captureTimeMs: Math.round(captureTime),
    },
    dom,
    styles,
    globalRules,
    stateRules,
    assets,
    analysis: {
      frameworks,
      hasAnimations: element.querySelector('[style*="animation"]') !== null ||
                     element.querySelector('[class*="animate"]') !== null,
      hasInteractivity: interactiveElements.length > 0,
      interactiveElementCount: interactiveElements.length,
    },
    interactiveElements,
    screenshot,
    stateChanges,
    recordedStates,
    html,
  };
}
