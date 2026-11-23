/**
 * Style Extractor - Computed style extraction with default-style diffing
 *
 * For each element, extracts only the non-default computed styles.
 * This dramatically reduces output size (~70% reduction) by skipping
 * properties that match the browser's default for that element type.
 */

// Cache of default styles per tag name
const defaultStyleCache = {};

/**
 * Get default computed styles for a given tag name by creating
 * a temporary element in an iframe.
 */
function getDefaultStyles(tagName) {
  if (defaultStyleCache[tagName]) return defaultStyleCache[tagName];

  // Create a hidden iframe to get clean default styles
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><body><${tagName}></${tagName}></body></html>`);
  doc.close();

  const el = doc.body.firstElementChild;
  const defaults = {};

  if (el) {
    const computed = iframe.contentWindow.getComputedStyle(el);
    for (let i = 0; i < computed.length; i++) {
      const prop = computed[i];
      defaults[prop] = computed.getPropertyValue(prop);
    }
  }

  document.body.removeChild(iframe);
  defaultStyleCache[tagName] = defaults;
  return defaults;
}

// Properties we always want to capture if non-default
const IMPORTANT_PROPERTIES = [
  'display', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-radius', 'border-width', 'border-style', 'border-color',
  'background', 'background-color', 'background-image', 'background-size',
  'background-position', 'background-repeat',
  'color', 'font-family', 'font-size', 'font-weight', 'font-style',
  'line-height', 'letter-spacing', 'text-align', 'text-decoration',
  'text-transform', 'white-space', 'word-break', 'overflow',
  'opacity', 'visibility', 'z-index', 'cursor', 'pointer-events',
  'flex', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink',
  'flex-basis', 'align-items', 'align-self', 'justify-content',
  'gap', 'row-gap', 'column-gap', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
  'grid-gap', 'grid-auto-flow',
  'box-shadow', 'text-shadow', 'transform', 'transition',
  'animation', 'filter', 'backdrop-filter', 'clip-path',
  'object-fit', 'object-position', 'aspect-ratio',
  'list-style', 'list-style-type',
  'outline', 'outline-offset',
  'box-sizing', 'vertical-align',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'overflow-x', 'overflow-y',
];

/**
 * Extract non-default computed styles for an element.
 *
 * @param {Element} element - DOM element with data-mime-id
 * @returns {Object} - Map of { property: value } for non-default styles
 */
export function extractStyles(element) {
  const tagName = element.tagName.toLowerCase();
  const defaults = getDefaultStyles(tagName);
  const computed = window.getComputedStyle(element);
  const styles = {};

  for (const prop of IMPORTANT_PROPERTIES) {
    const value = computed.getPropertyValue(prop);
    if (value && value !== defaults[prop]) {
      styles[prop] = value;
    }
  }

  return styles;
}

/**
 * Extract pseudo-element styles (::before, ::after).
 *
 * @param {Element} element
 * @returns {Object} - { before: {...}, after: {...} }
 */
export function extractPseudoStyles(element) {
  const result = {};

  for (const pseudo of ['::before', '::after']) {
    const computed = window.getComputedStyle(element, pseudo);
    const content = computed.getPropertyValue('content');

    if (content && content !== 'none' && content !== 'normal' && content !== '""') {
      const styles = { content };
      for (const prop of IMPORTANT_PROPERTIES) {
        const value = computed.getPropertyValue(prop);
        if (value) styles[prop] = value;
      }
      result[pseudo.replace('::', '')] = styles;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Extract all styles for a DOM tree (keyed by data-mime-id).
 *
 * @param {Element} rootElement - The root element to extract styles from
 * @returns {Object} - Map of { mimeId: { ...styles } }
 */
export function extractAllStyles(rootElement) {
  const styleMap = {};

  const walk = (el) => {
    if (el.nodeType !== Node.ELEMENT_NODE) return;

    const mimeId = el.getAttribute('data-mime-id');
    if (mimeId) {
      const styles = extractStyles(el);
      const pseudoStyles = extractPseudoStyles(el);

      if (Object.keys(styles).length > 0 || pseudoStyles) {
        styleMap[mimeId] = {
          ...styles,
          ...(pseudoStyles ? { _pseudo: pseudoStyles } : {}),
        };
      }
    }

    for (const child of el.children) {
      walk(child);
    }
  };

  walk(rootElement);
  return styleMap;
}
