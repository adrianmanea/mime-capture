/**
 * Analytics Module
 *
 * Lightweight event tracking with PII stripping.
 * Uses PostHog-compatible event format.
 */

const ANALYTICS_ENDPOINT = ''; // Set your analytics endpoint
const ANALYTICS_API_KEY = '';  // Set your analytics API key
const STORAGE_KEY = 'analytics_distinct_id';

// Fields to strip from event properties (PII protection)
const SENSITIVE_FIELDS = [
  'url', 'page_url', 'hostname',
  'capture_content', 'html', 'css',
  'email', 'name', 'content',
];

let currentSessionId = null;

function generateUUID() {
  return crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

async function getDistinctId() {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    if (result[STORAGE_KEY]) return result[STORAGE_KEY];

    const id = generateUUID();
    await chrome.storage.local.set({ [STORAGE_KEY]: id });
    return id;
  } catch {
    return generateUUID();
  }
}

/**
 * Start a new analytics session.
 */
export function startSession(sessionId) {
  currentSessionId = sessionId || generateUUID();
  return currentSessionId;
}

/**
 * Set the session ID (e.g., from background script).
 */
export function setSessionId(id) {
  currentSessionId = id;
}

/**
 * Strip sensitive fields from event properties.
 */
function sanitizeProperties(properties) {
  if (!properties || typeof properties !== 'object') return {};

  const clean = {};
  for (const [key, value] of Object.entries(properties)) {
    const lower = key.toLowerCase();
    const isSensitive = SENSITIVE_FIELDS.some((f) => lower.includes(f.toLowerCase()));
    if (!isSensitive && value != null) {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Track an analytics event.
 *
 * @param {string} eventName - Event name (e.g., "extension_activated")
 * @param {Object} properties - Event properties (sensitive fields auto-stripped)
 */
export async function trackEvent(eventName, properties = {}) {
  if (!ANALYTICS_ENDPOINT || !ANALYTICS_API_KEY) return;

  try {
    const payload = {
      api_key: ANALYTICS_API_KEY,
      event: eventName,
      distinct_id: await getDistinctId(),
      properties: {
        ...sanitizeProperties(properties),
        extension_version: chrome.runtime?.getManifest?.()?.version || '1.0.0',
        ...(currentSessionId ? { $session_id: currentSessionId } : {}),
      },
    };

    // Use bgFetch in content script context, regular fetch in service worker
    const fetchFn = typeof document !== 'undefined'
      ? (url, opts) => new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { type: 'API_FETCH', url, method: opts.method, headers: opts.headers, body: opts.body },
            (res) => res?.error ? reject(new Error(res.error)) : resolve(res)
          );
        })
      : fetch;

    await fetchFn(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Analytics should never throw
  }
}

/**
 * Identify a user (link anonymous ID to real user).
 */
export async function identifyUser(userId) {
  if (!ANALYTICS_ENDPOINT || !ANALYTICS_API_KEY) return;

  try {
    const anonId = await getDistinctId();
    const payload = {
      api_key: ANALYTICS_API_KEY,
      event: '$identify',
      distinct_id: userId,
      properties: {
        $anon_distinct_id: anonId,
        extension_version: chrome.runtime?.getManifest?.()?.version || '1.0.0',
      },
    };

    await fetch(ANALYTICS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // Update stored ID to real user ID
    await chrome.storage.local.set({ [STORAGE_KEY]: userId });
  } catch {
    // Analytics should never throw
  }
}

/**
 * Reset analytics identity (on sign out).
 */
export async function resetIdentity() {
  try {
    const newId = generateUUID();
    await chrome.storage.local.set({ [STORAGE_KEY]: newId });
  } catch {
    // Silent fail
  }
}
