/**
 * CSS Rules Extractor
 *
 * Iterates all document stylesheets, extracts rules that match
 * elements in the selected subtree, handles CORS via background script,
 * and collects @font-face / @import rules.
 *
 * Also extracts state-based rules (:hover, :focus, :active, etc.)
 * and rewrites selectors to use data-mime-id attributes.
 */

const STATE_PSEUDOS = [':hover', ':focus', ':active', ':visited', ':checked', ':disabled', ':focus-within', ':focus-visible'];

/**
 * Fetch a stylesheet via the background service worker (bypasses CORS).
 */
async function fetchViaBackground(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'FETCH_RESOURCE', url }, (response) => {
      resolve(response?.data || null);
    });
  });
}

/**
 * Check if any element in the subtree matches a CSS selector.
 */
function selectorMatchesSubtree(root, selector) {
  try {
    if (root.matches(selector)) return root;
    return root.querySelector(selector);
  } catch {
    return null; // Invalid selector
  }
}

/**
 * Determine if a selector contains a state pseudo-class.
 */
function getStatePseudo(selector) {
  for (const pseudo of STATE_PSEUDOS) {
    if (selector.includes(pseudo)) return pseudo;
  }
  return null;
}

/**
 * Rewrite a selector to use data-mime-id for specificity.
 */
function rewriteSelector(selector, matchedElement) {
  const mimeId = matchedElement.getAttribute('data-mime-id');
  if (!mimeId) return selector;
  return `[data-mime-id="${mimeId}"]`;
}

/**
 * Process a single CSS rule and collect if it matches the subtree.
 */
function processRule(rule, rootElement, collected) {
  if (rule.type === CSSRule.STYLE_RULE) {
    const selector = rule.selectorText;
    const statePseudo = getStatePseudo(selector);

    // Strip pseudo for matching purposes
    const baseSelector = statePseudo
      ? selector.replace(new RegExp(statePseudo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '')
      : selector;

    const matchedEl = selectorMatchesSubtree(rootElement, baseSelector.trim() || '*');
    if (matchedEl) {
      const entry = {
        selector: rule.selectorText,
        cssText: rule.style.cssText,
        mimeId: matchedEl.getAttribute('data-mime-id'),
      };

      if (statePseudo) {
        collected.stateRules.push({ ...entry, pseudo: statePseudo });
      } else {
        collected.globalRules.push(entry);
      }
    }
  } else if (rule.type === CSSRule.MEDIA_RULE || rule.type === CSSRule.SUPPORTS_RULE) {
    // Recursively process nested rules
    const conditionText = rule.conditionText || rule.media?.mediaText || '';
    for (const innerRule of rule.cssRules) {
      const innerCollected = { globalRules: [], stateRules: [], fonts: [] };
      processRule(innerRule, rootElement, innerCollected);

      // Tag with media context
      for (const r of innerCollected.globalRules) {
        collected.globalRules.push({ ...r, mediaContext: conditionText });
      }
      for (const r of innerCollected.stateRules) {
        collected.stateRules.push({ ...r, mediaContext: conditionText });
      }
    }
  } else if (rule.type === CSSRule.FONT_FACE_RULE) {
    const fontFamily = rule.style.getPropertyValue('font-family');
    if (fontFamily) {
      collected.fonts.push({
        family: fontFamily.replace(/['"]/g, ''),
        cssText: rule.cssText,
      });
    }
  }
}

/**
 * Extract all matching CSS rules for elements within the root element.
 *
 * @param {Element} rootElement - The captured element subtree root
 * @returns {Promise<Object>} - { globalRules, stateRules, fonts }
 */
export async function extractCSSRules(rootElement) {
  const collected = {
    globalRules: [],
    stateRules: [],
    fonts: [],
  };

  for (const sheet of document.styleSheets) {
    let rules;

    try {
      rules = sheet.cssRules || sheet.rules;
    } catch {
      // CORS error - fetch via background script
      if (sheet.href) {
        const cssText = await fetchViaBackground(sheet.href);
        if (cssText) {
          // Parse the fetched CSS using a temporary style element
          const tempStyle = document.createElement('style');
          tempStyle.textContent = cssText;
          document.head.appendChild(tempStyle);

          try {
            const tempSheet = tempStyle.sheet;
            if (tempSheet) {
              for (const rule of tempSheet.cssRules) {
                processRule(rule, rootElement, collected);
              }
            }
          } finally {
            document.head.removeChild(tempStyle);
          }
        }
      }
      continue;
    }

    if (!rules) continue;

    for (const rule of rules) {
      processRule(rule, rootElement, collected);

      // Handle @import rules
      if (rule.type === CSSRule.IMPORT_RULE && rule.href) {
        const cssText = await fetchViaBackground(rule.href);
        if (cssText) {
          const tempStyle = document.createElement('style');
          tempStyle.textContent = cssText;
          document.head.appendChild(tempStyle);

          try {
            const tempSheet = tempStyle.sheet;
            if (tempSheet) {
              for (const innerRule of tempSheet.cssRules) {
                processRule(innerRule, rootElement, collected);
              }
            }
          } finally {
            document.head.removeChild(tempStyle);
          }
        }
      }
    }
  }

  return collected;
}
