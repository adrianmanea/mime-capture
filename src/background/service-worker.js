/**
 * Service Worker - Background Script
 *
 * Handles:
 * - Extension toggle (activate/deactivate per tab)
 * - Tab screenshot capture via chrome.tabs.captureVisibleTab
 * - CORS resource fetching (proxy for content script)
 * - API request proxying with redirect following
 * - Auth session management (store/retrieve/clear)
 * - Sign-in popup window management
 */

// Track which tabs have the mime active
const activeTabs = new Set();

// --- Badge UI ---
function updateBadge(isActive, tabId) {
  const text = { text: isActive ? 'ON' : 'OFF' };
  const color = { color: isActive ? '#0099ff' : '#666666' };
  if (tabId) {
    text.tabId = tabId;
    color.tabId = tabId;
  }
  chrome.action.setBadgeText(text);
  chrome.action.setBadgeBackgroundColor(color);
}

// --- Generate session IDs ---
function generateSessionId() {
  return crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

// --- Extension Install ---
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove('mimeEnabled');
});

// --- Toggle on toolbar icon click ---
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  const isActivating = !activeTabs.has(tab.id);

  if (isActivating) {
    activeTabs.add(tab.id);
    const sessionId = generateSessionId();
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_MIME',
        enabled: true,
        sessionId,
      });
    } catch {
      activeTabs.delete(tab.id);
    }
  } else {
    activeTabs.delete(tab.id);
    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'TOGGLE_MIME',
        enabled: false,
      });
    } catch {
      // Tab might be closed
    }
  }

  updateBadge(isActivating, tab.id);
});

// --- Clean up on tab close ---
chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// --- Message Router ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    // Content script signals it closed
    case 'MIME_CLOSED':
      if (tabId) {
        activeTabs.delete(tabId);
        updateBadge(false, tabId);
      }
      sendResponse({ success: true });
      return;

    // Capture visible tab as PNG screenshot
    case 'CAPTURE_TAB':
      chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
        sendResponse({ dataUrl });
      });
      return true; // async

    // Fetch a resource (bypasses CORS for content script)
    case 'FETCH_RESOURCE':
      fetch(message.url)
        .then((res) => res.text())
        .then((data) => sendResponse({ data }))
        .catch((err) => sendResponse({ error: err.toString() }));
      return true; // async

    // Proxy API fetch with redirect following
    case 'API_FETCH': {
      const { url, method, headers, body } = message;

      const followRedirects = async (targetUrl, depth = 1) => {
        const res = await fetch(targetUrl, {
          method: method || 'GET',
          headers: headers || {},
          body: body || undefined,
          redirect: 'manual',
        });

        if (
          (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) &&
          depth < 5
        ) {
          const location = res.headers.get('location');
          if (location) {
            const absoluteUrl = new URL(location, targetUrl).href;
            return followRedirects(absoluteUrl, depth + 1);
          }
        }
        return res;
      };

      followRedirects(url)
        .then(async (res) => {
          const responseBody = await res.text();
          sendResponse({
            ok: res.ok,
            status: res.status,
            statusText: res.statusText,
            body: responseBody,
          });
        })
        .catch((err) => {
          sendResponse({ error: err.toString() });
        });
      return true; // async
    }

    // Auth: store session from callback
    case 'MIME_AUTH_CALLBACK':
      if (message.session) {
        chrome.storage.local.set({ mimeAuth: message.session }, () => {
          sendResponse({ success: true });
        });
        return true;
      }
      break;

    // Auth: get stored session
    case 'GET_AUTH_SESSION':
      chrome.storage.local.get('mimeAuth', (result) => {
        sendResponse({ session: result.mimeAuth || null });
      });
      return true;

    // Auth: sign out
    case 'SIGN_OUT':
      chrome.storage.local.remove(['mimeAuth', 'mimeUsage'], () => {
        sendResponse({ success: true });
      });
      return true;

    // Auth: open sign-in popup
    case 'SIGN_IN': {
      const authUrl = message.authUrl;
      chrome.windows.create(
        { url: authUrl, type: 'popup', width: 500, height: 700, focused: true },
        (win) => {
          if (chrome.runtime.lastError) {
            sendResponse({ error: chrome.runtime.lastError.message });
            return;
          }
          const windowId = win.id;
          const onClosed = (closedId) => {
            if (closedId === windowId) {
              chrome.windows.onRemoved.removeListener(onClosed);
              chrome.storage.local.get('mimeAuth', (result) => {
                // Session may or may not be stored at this point
              });
            }
          };
          chrome.windows.onRemoved.addListener(onClosed);
          sendResponse({ success: true, windowId });
        }
      );
      return true;
    }

    // Open a new tab
    case 'OPEN_TAB':
      chrome.tabs.create({ url: message.url }, () => {
        sendResponse({ success: true });
      });
      return true;
  }
});

// Handle external messages (from your auth website, see externally_connectable)
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (message.type === 'MIME_AUTH_CALLBACK' && message.session) {
    chrome.storage.local.set({ mimeAuth: message.session }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});
