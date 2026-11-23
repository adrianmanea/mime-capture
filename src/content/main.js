/**
 * Main Content Script
 *
 * Injected into every page. Creates a Shadow DOM root for isolation,
 * injects the extension UI, and manages the full lifecycle:
 * - Element selection (hover highlight + click)
 * - Toolbar with mode selection
 * - Capture modal with preview and export
 * - Interaction recording
 */

import { captureElement } from '../utils/capture-orchestrator.js';
import { captureElementScreenshot } from '../utils/screenshot.js';
import { startInteractionRecording } from '../utils/interaction-recorder.js';
import { trackEvent, startSession } from '../utils/analytics.js';

// --- Configuration ---
const CONFIG = {
  DEFAULT_STRATEGY: 'optimal',
  DEBUG_MODE: false,
};

// --- State ---
let isActive = false;
let isModalOpen = false;
let isRecording = false;
let selectedElement = null;
let hoveredElement = null;
let selectionType = 'component'; // 'component' | 'section'
let extractionStrategy = CONFIG.DEFAULT_STRATEGY;
let recordingController = null;
let recordedStates = [];
let recordedStateCount = 0;
let mousePos = { x: 0, y: 0 };
let preferParent = true; // Used for Enter/Shift+Enter navigation

// DOM references
let shadowRoot = null;
let uiContainer = null;

// --- Entry Point ---
export function onExecute(perfData) {
  if (CONFIG.DEBUG_MODE) {
    console.log('[Mime] Injected in', perfData?.perf?.loadTime?.toFixed(1), 'ms');
  }
  setupExtensionRoot();
  setupMessageListener();
}

// --- Shadow DOM Setup ---
function setupExtensionRoot() {
  if (document.getElementById('mime-extension-root')) return;

  // Register custom CSS property for gradient animation
  try {
    CSS.registerProperty({
      name: '--angle',
      syntax: '<angle>',
      inherits: false,
      initialValue: '0deg',
    });
  } catch {}

  const rootDiv = document.createElement('div');
  rootDiv.id = 'mime-extension-root';
  document.body.appendChild(rootDiv);

  shadowRoot = rootDiv.attachShadow({ mode: 'open' });

  uiContainer = document.createElement('div');
  uiContainer.id = 'root';
  shadowRoot.appendChild(uiContainer);

  // Inject styles
  const styleEl = document.createElement('style');
  styleEl.textContent = getExtensionCSS();
  shadowRoot.appendChild(styleEl);

  render();
}

// --- Message Listener ---
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TOGGLE_MIME') {
      isActive = message.enabled;
      if (message.enabled && message.sessionId) {
        startSession(message.sessionId);
      }
      render();
      sendResponse({ success: true });
    }
  });
}

// --- Smart Element Selector ---
function smartSelectElement(target) {
  // Try to find a semantic parent first
  const clickable = target.closest('button, a');
  if (clickable) return clickable;

  const semantic = target.closest('li, article, tr, [role="listitem"], [role="article"], [role="row"]');
  if (semantic && semantic !== document.body) return semantic;

  // Small elements → select parent
  if (['svg', 'path', 'i', 'img'].includes(target.tagName.toLowerCase())) {
    return target.parentElement || target;
  }

  const rect = target.getBoundingClientRect();
  if ((rect.width < 20 || rect.height < 20) && target.parentElement) {
    return target.parentElement;
  }

  return target;
}

// --- Event Handlers ---
function handleMouseOver(e) {
  if (isModalOpen || isRecording) return;
  if (e.target.closest('#mime-extension-root')) return;
  e.stopPropagation();

  const smart = smartSelectElement(e.target);

  // Navigation refinement: if user navigated into children, allow more specific selection
  if (!preferParent && hoveredElement) {
    if (smart.contains(hoveredElement) || smart === hoveredElement) {
      hoveredElement = e.target;
      render();
      return;
    }
    preferParent = true;
  }

  hoveredElement = smart;
  render();
}

function handleMouseMove(e) {
  mousePos = { x: e.clientX, y: e.clientY };
  // Update cursor indicator position (lightweight, no full re-render)
  const cursor = shadowRoot?.querySelector('.mime-cursor');
  if (cursor) {
    cursor.style.left = `${e.clientX}px`;
    cursor.style.top = `${e.clientY}px`;
  }
}

async function handleClick(e) {
  if (e.target.closest('#mime-extension-root')) return;
  if (isModalOpen || isRecording || !hoveredElement) return;

  e.preventDefault();
  e.stopPropagation();

  selectedElement = hoveredElement;

  // Pre-capture screenshot before opening modal
  let screenshot = null;
  try {
    screenshot = await captureElementScreenshot(selectedElement);
  } catch (err) {
    console.warn('[Mime] Pre-capture screenshot failed:', err);
  }

  trackEvent('modal_opened', {
    source: 'component',
    has_recorded_states: false,
  });

  isModalOpen = true;
  render();

  // Store screenshot for the modal
  window.__mimePreCapture = screenshot;
}

function handleKeyDown(e) {
  if (!hoveredElement && !isRecording) return;

  // Enter = drill into first child
  if (e.key === 'Enter' && !e.shiftKey && !isRecording) {
    e.preventDefault();
    const elAtMouse = document.elementFromPoint(mousePos.x, mousePos.y);
    if (elAtMouse && elAtMouse !== hoveredElement && hoveredElement.contains(elAtMouse)) {
      hoveredElement = elAtMouse;
      preferParent = false;
    } else {
      const firstChild = hoveredElement.firstElementChild;
      if (firstChild) {
        hoveredElement = firstChild;
        preferParent = false;
      }
    }
    render();
  }

  // Shift+Enter = go to parent
  if (e.key === 'Enter' && e.shiftKey && !isRecording) {
    e.preventDefault();
    const parent = hoveredElement.parentElement;
    if (parent && parent !== document.body) {
      hoveredElement = parent;
      preferParent = true;
    }
    render();
  }
}

// --- Attach/Detach Event Listeners ---
function attachListeners() {
  document.addEventListener('mouseover', handleMouseOver, true);
  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handleClick, true);
  document.addEventListener('keydown', handleKeyDown);
}

function detachListeners() {
  document.removeEventListener('mouseover', handleMouseOver, true);
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handleClick, true);
  document.removeEventListener('keydown', handleKeyDown);
}

// --- Close Extension ---
function closeExtension() {
  isActive = false;
  isModalOpen = false;
  hoveredElement = null;
  selectedElement = null;

  if (isRecording) cancelRecording();

  detachListeners();
  chrome.runtime.sendMessage({ type: 'MIME_CLOSED' }).catch(() => {});
  render();
}

// --- Recording ---
function startRecordingMode() {
  isRecording = true;
  recordedStates = [];
  recordedStateCount = 0;
  render();
}

async function stopRecordingMode() {
  if (!recordingController) return;

  const states = recordingController.stop();
  clearInterval(recordingController.t);
  isRecording = false;
  recordedStates = states;

  trackEvent('recording_stopped', { states_captured: states?.length ?? 0 });

  // Switch to tactic strategy for state-aware capture
  extractionStrategy = 'tactic';

  // Re-open modal with recorded states
  isModalOpen = true;
  render();
}

function cancelRecording() {
  if (recordingController) {
    recordingController.stop();
    clearInterval(recordingController.t);
  }
  trackEvent('recording_cancelled', {});
  isRecording = false;
  recordedStates = [];
  recordedStateCount = 0;
  render();
}

// --- Close Modal ---
function closeModal() {
  isModalOpen = false;
  selectedElement = null;
  recordedStates = [];
  recordedStateCount = 0;
  render();
}

// --- Render ---
function render() {
  if (!uiContainer) return;

  if (!isActive) {
    uiContainer.innerHTML = '';
    detachListeners();
    return;
  }

  attachListeners();

  let html = '<div class="mime-app font-sans text-base text-gray-900">';

  // Darkening overlay (when recording)
  if (isRecording && selectedElement) {
    html += renderDarkeningOverlay(selectedElement);
  }

  // Element highlight (when hovering and not in modal/recording)
  if (!isModalOpen && hoveredElement && !isRecording) {
    html += renderHighlight(hoveredElement);
  }

  // Cursor crosshair (when not in modal)
  if (!isModalOpen && !isRecording) {
    html += `<div class="mime-cursor" style="
      position: fixed;
      left: ${mousePos.x}px;
      top: ${mousePos.y}px;
      width: 20px;
      height: 20px;
      border: 2px solid #0099ff;
      border-radius: 50%;
      pointer-events: none;
      z-index: 2147483646;
      transform: translate(-50%, -50%);
      transition: left 0.05s, top 0.05s;
    "></div>`;
  }

  // Toolbar (always visible when active)
  if (!isModalOpen) {
    html += renderToolbar();
  }

  // Modal (when element is selected)
  if (isModalOpen && selectedElement) {
    html += renderModal();
  }

  html += '</div>';
  uiContainer.innerHTML = html;

  // Attach modal/toolbar event listeners after render
  bindUIEvents();
}

// --- Render: Element Highlight ---
function renderHighlight(element) {
  const rect = element.getBoundingClientRect();
  return `
    <div class="mime-highlight" style="
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid #0099ff;
      background: rgba(0, 153, 255, 0.08);
      pointer-events: none;
      z-index: 2147483645;
      border-radius: 4px;
      transition: all 0.15s ease-out;
    ">
      <div style="
        position: absolute;
        top: -24px;
        left: 0;
        background: #0099ff;
        color: white;
        padding: 2px 8px;
        border-radius: 4px;
        font-size: 11px;
        font-family: ui-monospace, monospace;
        white-space: nowrap;
        line-height: 18px;
      ">${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? '.' + element.className.split(' ')[0] : ''} — ${Math.round(rect.width)}×${Math.round(rect.height)}</div>
    </div>
  `;
}

// --- Render: Darkening Overlay (4-box technique) ---
function renderDarkeningOverlay(element) {
  const rect = element.getBoundingClientRect();
  const { top, left, width, height } = rect;

  return `
    <div class="mime-overlay" style="position:fixed;inset:0;z-index:2147483645;pointer-events:none;">
      <div style="position:absolute;background:rgba(0,0,0,0.5);backdrop-filter:blur(1px);transition:all .3s;top:0;left:0;right:0;height:${top}px;"></div>
      <div style="position:absolute;background:rgba(0,0,0,0.5);backdrop-filter:blur(1px);transition:all .3s;top:${top + height}px;left:0;right:0;bottom:0;"></div>
      <div style="position:absolute;background:rgba(0,0,0,0.5);backdrop-filter:blur(1px);transition:all .3s;top:${top}px;left:0;width:${left}px;height:${height}px;"></div>
      <div style="position:absolute;background:rgba(0,0,0,0.5);backdrop-filter:blur(1px);transition:all .3s;top:${top}px;left:${left + width}px;right:0;height:${height}px;"></div>
    </div>
  `;
}

// --- Render: Bottom Toolbar ---
function renderToolbar() {
  return `
    <div class="mime-toolbar" style="
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05);
      padding: 8px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      font-family: ui-sans-serif, system-ui, sans-serif;
      font-size: 13px;
    ">
      <!-- Logo -->
      <div style="display:flex;align-items:center;gap:6px;font-weight:600;color:#0099ff;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
          <polyline points="14,2 14,8 20,8"/>
        </svg>
        Mime
      </div>

      <div style="width:1px;height:20px;background:#e5e7eb;"></div>

      <!-- Selection Type Toggle -->
      <div style="display:flex;gap:4px;background:#f3f4f6;border-radius:8px;padding:2px;">
        <button data-action="select-component" style="
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          background: ${selectionType === 'component' ? 'white' : 'transparent'};
          color: ${selectionType === 'component' ? '#111827' : '#6b7280'};
          box-shadow: ${selectionType === 'component' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
        ">Component</button>
        <button data-action="select-section" style="
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          background: ${selectionType === 'section' ? 'white' : 'transparent'};
          color: ${selectionType === 'section' ? '#111827' : '#6b7280'};
          box-shadow: ${selectionType === 'section' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
        ">Section</button>
      </div>

      <div style="width:1px;height:20px;background:#e5e7eb;"></div>

      <!-- Strategy Toggle -->
      <div style="display:flex;gap:4px;background:#f3f4f6;border-radius:8px;padding:2px;">
        <button data-action="strategy-optimal" style="
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          background: ${extractionStrategy === 'optimal' ? 'white' : 'transparent'};
          color: ${extractionStrategy === 'optimal' ? '#111827' : '#6b7280'};
          box-shadow: ${extractionStrategy === 'optimal' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
        ">Fast</button>
        <button data-action="strategy-tactic" style="
          padding: 4px 10px;
          border-radius: 6px;
          border: none;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          background: ${extractionStrategy === 'tactic' ? 'white' : 'transparent'};
          color: ${extractionStrategy === 'tactic' ? '#111827' : '#6b7280'};
          box-shadow: ${extractionStrategy === 'tactic' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'};
        ">Interactive</button>
      </div>

      ${isRecording ? `
        <div style="width:1px;height:20px;background:#e5e7eb;"></div>
        <div style="display:flex;align-items:center;gap:8px;">
          <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;animation:pulse 1s infinite;"></div>
          <span style="color:#ef4444;font-weight:500;">Recording (${recordedStateCount})</span>
          <button data-action="stop-recording" style="
            padding: 4px 10px;border-radius:6px;border:none;cursor:pointer;
            font-size:12px;font-weight:500;background:#ef4444;color:white;
          ">Stop</button>
          <button data-action="cancel-recording" style="
            padding:4px 10px;border-radius:6px;border:1px solid #e5e7eb;
            cursor:pointer;font-size:12px;background:white;color:#6b7280;
          ">Cancel</button>
        </div>
      ` : ''}

      <div style="width:1px;height:20px;background:#e5e7eb;"></div>

      <!-- Close button -->
      <button data-action="close" style="
        padding: 4px 8px;
        border-radius: 6px;
        border: none;
        cursor: pointer;
        font-size: 12px;
        color: #6b7280;
        background: transparent;
      " title="Close (Esc)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      <!-- Keyboard hints -->
      <div style="display:flex;gap:4px;font-size:10px;color:#9ca3af;">
        <kbd style="padding:1px 4px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:3px;">Enter</kbd> drill in
        <kbd style="padding:1px 4px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:3px;">Shift+Enter</kbd> parent
      </div>
    </div>
  `;
}

// --- Render: Capture Modal ---
function renderModal() {
  const rect = selectedElement.getBoundingClientRect();
  const screenshot = window.__mimePreCapture;

  return `
    <div class="mime-modal-backdrop" data-action="close-modal" style="
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
    ">
      <div class="mime-modal" style="
        background: white;
        border-radius: 16px;
        box-shadow: 0 25px 50px rgba(0,0,0,0.25);
        max-width: 720px;
        width: 90%;
        max-height: 85vh;
        overflow: auto;
        font-family: ui-sans-serif, system-ui, sans-serif;
      " onclick="event.stopPropagation()">

        <!-- Modal Header -->
        <div style="
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid #f3f4f6;
        ">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="
              width: 32px;height: 32px;background: #0099ff;border-radius: 8px;
              display:flex;align-items:center;justify-content:center;
            ">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              </svg>
            </div>
            <div>
              <div style="font-weight:600;font-size:15px;color:#111827;">Captured Component</div>
              <div style="font-size:12px;color:#6b7280;">
                ${selectedElement.tagName.toLowerCase()} — ${Math.round(rect.width)}×${Math.round(rect.height)}px
              </div>
            </div>
          </div>
          <button data-action="close-modal" style="
            width:32px;height:32px;border-radius:8px;border:none;cursor:pointer;
            background:#f3f4f6;display:flex;align-items:center;justify-content:center;
          ">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <!-- Screenshot Preview -->
        ${screenshot ? `
          <div style="padding: 16px 20px; background: #fafafa; border-bottom: 1px solid #f3f4f6;">
            <img src="${screenshot}" style="
              width: 100%;
              border-radius: 8px;
              border: 1px solid #e5e7eb;
              max-height: 300px;
              object-fit: contain;
              background: white;
            " alt="Element preview" />
          </div>
        ` : ''}

        <!-- Strategy Selection -->
        <div style="padding: 16px 20px; border-bottom: 1px solid #f3f4f6;">
          <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">Capture Strategy</div>
          <div style="display:flex;gap:8px;">
            <button data-action="modal-strategy-optimal" style="
              flex:1;padding:10px;border-radius:8px;border:1px solid ${extractionStrategy === 'optimal' ? '#0099ff' : '#e5e7eb'};
              cursor:pointer;background:${extractionStrategy === 'optimal' ? '#eff6ff' : 'white'};text-align:left;
            ">
              <div style="font-size:13px;font-weight:600;color:#111827;">Fast</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">Static capture, quick and lightweight</div>
            </button>
            <button data-action="modal-strategy-tactic" style="
              flex:1;padding:10px;border-radius:8px;border:1px solid ${extractionStrategy === 'tactic' ? '#0099ff' : '#e5e7eb'};
              cursor:pointer;background:${extractionStrategy === 'tactic' ? '#eff6ff' : 'white'};text-align:left;
            ">
              <div style="font-size:13px;font-weight:600;color:#111827;">Interactive</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px;">Captures hover, focus, active states</div>
            </button>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="padding: 16px 20px; display: flex; gap: 8px;">
          <button data-action="capture-and-copy" style="
            flex: 1;
            padding: 10px 16px;
            border-radius: 8px;
            border: none;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            background: #0099ff;
            color: white;
            transition: background 0.2s;
          ">
            <span style="display:flex;align-items:center;justify-content:center;gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              Copy as AI Prompt
            </span>
          </button>
          <button data-action="capture-and-download" style="
            padding: 10px 16px;
            border-radius: 8px;
            border: 1px solid #e5e7eb;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            background: white;
            color: #374151;
          ">
            <span style="display:flex;align-items:center;justify-content:center;gap:6px;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download JSON
            </span>
          </button>
        </div>

        <!-- Status -->
        <div id="mime-status" style="
          padding: 0 20px 16px;
          font-size: 12px;
          color: #6b7280;
          display: none;
        "></div>
      </div>
    </div>
  `;
}

// --- Bind UI Events (called after each render) ---
function bindUIEvents() {
  if (!shadowRoot) return;

  const actions = {
    'close': closeExtension,
    'close-modal': closeModal,
    'select-component': () => { selectionType = 'component'; render(); },
    'select-section': () => { selectionType = 'section'; render(); },
    'strategy-optimal': () => { extractionStrategy = 'optimal'; render(); },
    'strategy-tactic': () => { extractionStrategy = 'tactic'; render(); },
    'modal-strategy-optimal': () => { extractionStrategy = 'optimal'; render(); },
    'modal-strategy-tactic': () => { extractionStrategy = 'tactic'; render(); },
    'stop-recording': stopRecordingMode,
    'cancel-recording': cancelRecording,
    'capture-and-copy': handleCaptureAndCopy,
    'capture-and-download': handleCaptureAndDownload,
  };

  for (const [action, handler] of Object.entries(actions)) {
    const elements = shadowRoot.querySelectorAll(`[data-action="${action}"]`);
    for (const el of elements) {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        handler();
      });
    }
  }

  // Prevent modal content clicks from closing modal
  const modalContent = shadowRoot.querySelector('.mime-modal');
  if (modalContent) {
    modalContent.addEventListener('click', (e) => e.stopPropagation());
  }
}

// --- Capture & Copy ---
async function handleCaptureAndCopy() {
  if (!selectedElement) return;

  showStatus('Capturing element...');

  try {
    const result = await captureElement(selectedElement, extractionStrategy, recordedStates);

    // Debug: log the full capture result
    console.group('[Mime] Capture Result (Copy)');
    console.log('Strategy:', extractionStrategy);
    console.log('Element:', selectedElement.tagName.toLowerCase());
    console.log('Meta:', result.meta);
    console.log('HTML:', result.html);
    console.log('DOM tree:', result.dom);
    console.log('Styles:', result.styles);
    console.log('Global CSS rules:', result.globalRules);
    console.log('State rules (hover/focus):', result.stateRules);
    console.log('Assets:', result.assets);
    console.log('Analysis:', result.analysis);
    console.log('Interactive elements:', result.interactiveElements);
    console.log('State changes:', result.stateChanges);
    console.log('Recorded states:', result.recordedStates);
    console.log('Screenshot:', result.screenshot ? `${result.screenshot.substring(0, 80)}... (${Math.round(result.screenshot.length / 1024)}KB)` : null);
    console.log('Full result object:', result);
    console.groupEnd();

    // Build AI prompt
    const prompt = buildAIPrompt(result);

    // Copy to clipboard
    await navigator.clipboard.writeText(prompt);

    trackEvent('capture_copied', {
      strategy: extractionStrategy,
      element_tag: selectedElement.tagName.toLowerCase(),
    });

    showStatus('Copied to clipboard!', 'success');
    setTimeout(closeModal, 1500);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
}

// --- Capture & Download ---
async function handleCaptureAndDownload() {
  if (!selectedElement) return;

  showStatus('Capturing element...');

  try {
    const result = await captureElement(selectedElement, extractionStrategy, recordedStates);

    // Debug: log the full capture result
    console.group('[Mime] Capture Result (Download)');
    console.log('Strategy:', extractionStrategy);
    console.log('Meta:', result.meta);
    console.log('HTML:', result.html);
    console.log('DOM tree:', result.dom);
    console.log('Styles:', result.styles);
    console.log('Global CSS rules:', result.globalRules);
    console.log('State rules (hover/focus):', result.stateRules);
    console.log('Assets:', result.assets);
    console.log('Analysis:', result.analysis);
    console.log('Interactive elements:', result.interactiveElements);
    console.log('Screenshot:', result.screenshot ? `${result.screenshot.substring(0, 80)}... (${Math.round(result.screenshot.length / 1024)}KB)` : null);
    console.log('Full result object:', result);
    console.groupEnd();

    const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mime-capture-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    trackEvent('capture_downloaded', {
      strategy: extractionStrategy,
    });

    showStatus('Downloaded!', 'success');
    setTimeout(closeModal, 1500);
  } catch (err) {
    showStatus(`Error: ${err.message}`, 'error');
  }
}

// --- Build AI Prompt from capture result ---
function buildAIPrompt(result) {
  let prompt = `Recreate this UI component with pixel-perfect accuracy.\n\n`;
  prompt += `## Component Info\n`;
  prompt += `- Source: ${result.meta.url}\n`;
  prompt += `- Dimensions: ${Math.round(result.meta.bounds.width)}×${Math.round(result.meta.bounds.height)}px\n`;
  prompt += `- Framework: ${result.analysis.frameworks.cssFramework || 'unknown'}\n`;
  prompt += `- JS Framework: ${result.analysis.frameworks.jsFramework || 'unknown'}\n\n`;

  prompt += `## HTML Structure\n\`\`\`html\n${result.html}\n\`\`\`\n\n`;

  if (Object.keys(result.styles).length > 0) {
    prompt += `## Computed Styles (non-default only)\n\`\`\`json\n${JSON.stringify(result.styles, null, 2)}\n\`\`\`\n\n`;
  }

  if (result.stateRules.length > 0) {
    prompt += `## Interactive States (hover, focus, etc.)\n\`\`\`css\n`;
    for (const rule of result.stateRules) {
      if (rule.cssText) {
        prompt += `${rule.selector} { ${rule.cssText} }\n`;
      }
    }
    prompt += `\`\`\`\n\n`;
  }

  if (result.screenshot) {
    prompt += `## Screenshot\nA screenshot of the component is attached as a base64 JPEG image.\n\n`;
  }

  prompt += `## Instructions\n`;
  prompt += `- Use Tailwind CSS for styling\n`;
  prompt += `- Match the exact colors, spacing, typography, and border-radius\n`;
  prompt += `- Include hover/focus states if present\n`;
  prompt += `- Make it responsive\n`;
  prompt += `- Use semantic HTML elements\n`;

  return prompt;
}

// --- Status display ---
function showStatus(message, type = 'info') {
  const status = shadowRoot?.querySelector('#mime-status');
  if (status) {
    status.style.display = 'block';
    status.style.color = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : '#6b7280';
    status.textContent = message;
  }
}

// --- Extension CSS (injected into Shadow DOM) ---
function getExtensionCSS() {
  return `
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .mime-app {
      all: initial;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
    }

    .mime-app * {
      box-sizing: border-box;
    }

    .mime-modal-backdrop {
      animation: fadeIn 0.2s ease-out;
    }

    .mime-modal {
      animation: fadeIn 0.2s ease-out;
    }

    button:hover {
      filter: brightness(0.95);
    }

    ::-webkit-scrollbar {
      width: 6px;
    }

    ::-webkit-scrollbar-thumb {
      background: #d1d5db;
      border-radius: 3px;
    }

    kbd {
      font-family: ui-monospace, monospace;
    }
  `;
}
