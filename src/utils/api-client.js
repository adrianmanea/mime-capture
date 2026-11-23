/**
 * API Client
 *
 * Handles all server communication:
 * - Auth (login, token refresh, sign out)
 * - Capture submission (POST captured data)
 * - Code generation (AI-powered)
 * - Usage/quota tracking
 *
 * All requests are proxied through the background service worker
 * to bypass CORS restrictions.
 */

const API_BASE = 'https://your-api-domain.com'; // Replace with your API

// --- Background fetch proxy ---
function bgFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: 'API_FETCH',
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(`bgFetch failed: ${chrome.runtime.lastError.message}`));
        }
        if (response?.error) {
          return reject(new Error(`bgFetch network error: ${response.error}`));
        }

        const result = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText || '',
          json: () => {
            try {
              return Promise.resolve(
                typeof response.body === 'string' ? JSON.parse(response.body) : response.body
              );
            } catch (e) {
              return Promise.reject(new Error('Failed to parse JSON response'));
            }
          },
          text: () =>
            Promise.resolve(
              typeof response.body === 'string' ? response.body : JSON.stringify(response.body)
            ),
        };
        resolve(result);
      }
    );
  });
}

// --- Auth helpers ---

async function getAuthSession() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_AUTH_SESSION' }, (response) => {
      resolve(response?.session || null);
    });
  });
}

function getAuthHeaders(session) {
  if (!session?.access_token) return { 'Content-Type': 'application/json' };
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

async function refreshToken(session) {
  if (!session?.refresh_token) return null;

  try {
    const res = await bgFetch(`${API_BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });

    if (res.ok) {
      const newSession = await res.json();
      // Store the refreshed session
      await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'MIME_AUTH_CALLBACK', session: newSession },
          resolve
        );
      });
      return newSession;
    }
  } catch (err) {
    console.warn('[Mime] Token refresh failed:', err);
  }
  return null;
}

/**
 * Make an authenticated API request with automatic token refresh.
 */
async function authenticatedFetch(url, options = {}) {
  let session = await getAuthSession();

  const makeRequest = async (sess) => {
    const headers = { ...getAuthHeaders(sess), ...(options.headers || {}) };
    return bgFetch(url, { ...options, headers });
  };

  let res = await makeRequest(session);

  // If 401, try to refresh token and retry once
  if (res.status === 401 && session) {
    const newSession = await refreshToken(session);
    if (newSession) {
      res = await makeRequest(newSession);
    }
  }

  return res;
}

// --- API Methods ---

/**
 * Submit a captured capture to the server.
 *
 * @param {Object} captureResult - Output from captureElement()
 * @returns {Promise<Object>} - Server response with capture ID
 */
export async function submitCapture(captureResult) {
  const res = await authenticatedFetch(`${API_BASE}/api/captures`, {
    method: 'POST',
    body: JSON.stringify({
      html: captureResult.html,
      dom: captureResult.dom,
      styles: captureResult.styles,
      globalRules: captureResult.globalRules,
      stateRules: captureResult.stateRules,
      assets: captureResult.assets,
      meta: captureResult.meta,
      screenshot: captureResult.screenshot,
      analysis: captureResult.analysis,
      interactiveElements: captureResult.interactiveElements,
      stateChanges: captureResult.stateChanges,
      recordedStates: captureResult.recordedStates,
    }),
  });

  if (!res.ok) {
    throw new Error(`Submit failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Request AI code generation for a captured capture.
 *
 * @param {string} captureId - ID returned from submitCapture
 * @param {Object} options - { format: "react"|"vue"|"html", framework: "tailwind"|"css" }
 * @returns {Promise<Object>} - Generated code
 */
export async function generateCode(captureId, options = {}) {
  const res = await authenticatedFetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    body: JSON.stringify({
      captureId,
      format: options.format || 'react',
      cssFramework: options.cssFramework || 'tailwind',
    }),
  });

  if (!res.ok) {
    throw new Error(`Generate failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Get current usage/quota information.
 */
export async function getUsage() {
  // Check local cache first
  return new Promise((resolve) => {
    chrome.storage.local.get('mimeUsage', async (result) => {
      if (result.mimeUsage) {
        resolve(result.mimeUsage);
        return;
      }

      try {
        const res = await authenticatedFetch(`${API_BASE}/api/usage`);
        if (res.ok) {
          const usage = await res.json();
          chrome.storage.local.set({ mimeUsage: usage });
          resolve(usage);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });
  });
}

/**
 * Update locally cached usage data and dispatch event.
 */
export function updateLocalUsage(usage) {
  chrome.storage.local.set({ mimeUsage: usage });
  // Dispatch custom event for UI components to react
  window.dispatchEvent(
    new CustomEvent('mime-usage-updated', { detail: usage })
  );
}

/**
 * Initiate sign-in flow.
 */
export function signIn(authUrl) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SIGN_IN', authUrl }, resolve);
  });
}

/**
 * Sign out and clear all stored data.
 */
export function signOut() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'SIGN_OUT' }, resolve);
  });
}

/**
 * Create a checkout session for subscription.
 */
export async function createCheckout(priceId) {
  const res = await authenticatedFetch(`${API_BASE}/api/checkout`, {
    method: 'POST',
    body: JSON.stringify({
      price_id: priceId,
      success_url: `${API_BASE}/billing/success`,
      cancel_url: `${API_BASE}/billing/cancel`,
    }),
  });

  if (!res.ok) {
    throw new Error(`Checkout failed: ${res.status}`);
  }

  return res.json();
}

export { getAuthSession, bgFetch };
