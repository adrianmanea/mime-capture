/**
 * DOM Walker - Recursive DOM tree extraction
 *
 * Walks the entire DOM subtree of a selected element and produces
 * a serializable tree structure with:
 * - Unique data-mime-id on every element
 * - Tag names, attributes, text content
 * - Shadow DOM handling
 * - Image/SVG asset collection
 */

// Tags to skip during DOM walking
const SKIP_TAGS = new Set([
  'script', 'style', 'iframe', 'meta', 'link', 'noscript',
]);

// Attributes worth preserving
const PRESERVED_ATTRS = [
  'class', 'id', 'href', 'src', 'alt', 'title', 'type', 'name',
  'placeholder', 'value', 'for', 'action', 'method', 'target',
  'rel', 'role', 'tabindex', 'disabled', 'checked', 'selected',
  'readonly', 'required', 'autocomplete', 'autofocus', 'multiple',
  'min', 'max', 'step', 'pattern', 'width', 'height',
  'viewBox', 'fill', 'stroke', 'stroke-width', 'd', 'cx', 'cy',
  'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'transform', 'opacity', 'xmlns',
];

// Generate UUID
function generateId() {
  return crypto.randomUUID?.() ||
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
}

/**
 * Recursively walk the DOM tree and build a serializable representation.
 *
 * @param {Node} node - The DOM node to process
 * @param {Object} assets - Accumulator for images/SVGs/fonts found
 * @returns {Object|null} - Serializable node representation
 */
export function walkDOM(node, assets = { images: [], svgs: [], fonts: [] }) {
  // Text nodes
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent.trim();
    if (!text) return null;
    return { type: 'text', content: text };
  }

  // Only process element nodes
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const tagName = node.tagName.toLowerCase();

  // Skip unwanted tags
  if (SKIP_TAGS.has(tagName)) return null;

  // Skip the extension's own UI
  if (node.id === 'mime-extension-root') return null;

  // Assign unique tracking ID
  const mimeId = generateId();
  node.setAttribute('data-mime-id', mimeId);

  // Extract attributes
  const attributes = {};
  for (const attr of PRESERVED_ATTRS) {
    if (node.hasAttribute(attr)) {
      attributes[attr] = node.getAttribute(attr);
    }
  }

  // Also grab data-* and aria-* attributes
  for (const attr of node.attributes) {
    if (attr.name.startsWith('data-') || attr.name.startsWith('aria-')) {
      attributes[attr.name] = attr.value;
    }
  }

  // Collect image assets
  if (tagName === 'img' && node.src) {
    assets.images.push({ id: mimeId, src: node.src, alt: node.alt || '' });
  }

  // Collect inline SVGs
  if (tagName === 'svg') {
    assets.svgs.push({ id: mimeId, content: node.outerHTML });
  }

  // Check for background images
  const bgImage = getComputedStyle(node).backgroundImage;
  if (bgImage && bgImage !== 'none') {
    const urlMatch = bgImage.match(/url\(["']?(.*?)["']?\)/);
    if (urlMatch) {
      assets.images.push({ id: mimeId, src: urlMatch[1], type: 'background' });
    }
  }

  // Process children recursively
  const children = [];

  // Handle Shadow DOM
  if (node.shadowRoot) {
    for (const child of node.shadowRoot.childNodes) {
      const result = walkDOM(child, assets);
      if (result) children.push(result);
    }
    return {
      type: 'shadow-host',
      tagName,
      id: mimeId,
      attributes,
      children,
    };
  }

  // Regular children
  for (const child of node.childNodes) {
    const result = walkDOM(child, assets);
    if (result) children.push(result);
  }

  return {
    type: 'element',
    tagName,
    id: mimeId,
    attributes,
    children,
  };
}

/**
 * Serialize DOM tree back to clean HTML string.
 */
export function treeToHTML(node, indent = 0) {
  if (!node) return '';

  if (node.type === 'text') {
    return '  '.repeat(indent) + node.content;
  }

  const pad = '  '.repeat(indent);
  const attrs = Object.entries(node.attributes || {})
    .filter(([key]) => key !== 'data-mime-id')
    .map(([key, val]) => ` ${key}="${val}"`)
    .join('');

  const selfClosing = ['img', 'br', 'hr', 'input', 'meta', 'link'].includes(node.tagName);

  if (selfClosing) {
    return `${pad}<${node.tagName}${attrs} />`;
  }

  if (!node.children || node.children.length === 0) {
    return `${pad}<${node.tagName}${attrs}></${node.tagName}>`;
  }

  // If only a text child, inline it
  if (node.children.length === 1 && node.children[0].type === 'text') {
    return `${pad}<${node.tagName}${attrs}>${node.children[0].content}</${node.tagName}>`;
  }

  const childrenHTML = node.children
    .map((child) => treeToHTML(child, indent + 1))
    .filter(Boolean)
    .join('\n');

  return `${pad}<${node.tagName}${attrs}>\n${childrenHTML}\n${pad}</${node.tagName}>`;
}
