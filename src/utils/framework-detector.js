/**
 * Framework Detector
 *
 * Auto-detects which CSS framework(s) and JS frameworks are in use
 * on the current page. Generates framework-specific hover/state CSS
 * for Tailwind, Bootstrap, Radix UI, and Material UI.
 */

/**
 * Detect frameworks used on the page.
 */
export function detectFrameworks(rootElement) {
  const detected = {
    cssFramework: null,
    jsFramework: null,
    uiLibraries: [],
    details: {},
  };

  // --- JS Framework Detection ---
  if (window.React || document.querySelector('[data-reactroot]') || document.querySelector('[data-react-helmet]')) {
    detected.jsFramework = 'react';
  } else if (window.next || document.getElementById('__next')) {
    detected.jsFramework = 'nextjs';
  } else if (window.__VUE__) {
    detected.jsFramework = 'vue';
  } else if (document.querySelector('[data-svelte-h]')) {
    detected.jsFramework = 'svelte';
  }

  // --- CSS Framework Detection ---
  const allClasses = getAllClasses(rootElement);

  // Tailwind detection
  const tailwindPatterns = /^(flex|grid|gap-|p-|px-|py-|m-|mx-|my-|w-|h-|text-|bg-|border-|rounded|shadow|hover:|focus:|dark:)/;
  const tailwindMatches = allClasses.filter((c) => tailwindPatterns.test(c));
  if (tailwindMatches.length > 3) {
    detected.cssFramework = 'tailwind';
    detected.details.tailwindClasses = tailwindMatches;
  }

  // Bootstrap detection
  const bootstrapPatterns = /^(btn|btn-|col-|row|container|navbar|card|modal|dropdown|form-|alert|badge)/;
  const bootstrapMatches = allClasses.filter((c) => bootstrapPatterns.test(c));
  if (bootstrapMatches.length > 2) {
    detected.cssFramework = 'bootstrap';
    detected.details.bootstrapClasses = bootstrapMatches;
  }

  // --- UI Library Detection ---
  // Radix UI
  if (rootElement.querySelector('[data-radix-collection-item]') ||
      rootElement.querySelector('[data-state]') ||
      allClasses.some((c) => c.includes('radix'))) {
    detected.uiLibraries.push('radix-ui');
  }

  // shadcn/ui (uses Radix under the hood)
  if (allClasses.some((c) => /^(inline-flex|items-center|justify-center|rounded-md|transition-colors|focus-visible:)/.test(c))) {
    detected.uiLibraries.push('shadcn-ui');
  }

  // Material UI
  if (rootElement.querySelector('[class*="Mui"]') ||
      rootElement.querySelector('[class*="MuiButton"]') ||
      allClasses.some((c) => c.startsWith('Mui') || c.startsWith('css-'))) {
    detected.uiLibraries.push('material-ui');
  }

  // Framer Motion
  if (rootElement.querySelector('[data-framer-component-type]') ||
      rootElement.querySelector('[style*="--framer"]')) {
    detected.uiLibraries.push('framer-motion');
  }

  return detected;
}

/**
 * Generate state CSS (hover/focus/active) based on detected framework.
 */
export function generateStateCSSForFramework(rootElement, frameworks) {
  const stateCSS = [];

  if (frameworks.cssFramework === 'tailwind') {
    stateCSS.push(...extractTailwindStateCSS(rootElement));
  }

  if (frameworks.cssFramework === 'bootstrap') {
    stateCSS.push(...extractBootstrapStateCSS(rootElement));
  }

  if (frameworks.uiLibraries.includes('radix-ui')) {
    stateCSS.push(...extractRadixStateCSS(rootElement));
  }

  if (frameworks.uiLibraries.includes('material-ui')) {
    stateCSS.push(...extractMUIStateCSS(rootElement));
  }

  return stateCSS;
}

// --- Tailwind hover: class extraction ---
function extractTailwindStateCSS(rootElement) {
  const rules = [];
  const elements = rootElement.querySelectorAll('*');

  for (const el of elements) {
    const classes = Array.from(el.classList);
    const hoverClasses = classes.filter((c) => c.startsWith('hover:'));
    const focusClasses = classes.filter((c) => c.startsWith('focus:'));

    const mimeId = el.getAttribute('data-mime-id');
    if (!mimeId) continue;

    if (hoverClasses.length > 0) {
      const styles = tailwindClassesToCSS(hoverClasses.map((c) => c.replace('hover:', '')));
      if (styles) {
        rules.push({
          selector: `[data-mime-id="${mimeId}"]:hover`,
          cssText: styles,
          pseudo: ':hover',
        });
      }
    }

    if (focusClasses.length > 0) {
      const styles = tailwindClassesToCSS(focusClasses.map((c) => c.replace('focus:', '')));
      if (styles) {
        rules.push({
          selector: `[data-mime-id="${mimeId}"]:focus`,
          cssText: styles,
          pseudo: ':focus',
        });
      }
    }
  }

  return rules;
}

// --- Bootstrap component state CSS ---
function extractBootstrapStateCSS(rootElement) {
  const rules = [];
  const dropdowns = rootElement.querySelectorAll('.dropdown');

  for (const dropdown of dropdowns) {
    const menu = dropdown.querySelector('.dropdown-menu');
    if (menu) {
      const parentId = dropdown.getAttribute('data-mime-id');
      const menuId = menu.getAttribute('data-mime-id');
      if (parentId && menuId) {
        rules.push({
          selector: `[data-mime-id="${parentId}"]:hover [data-mime-id="${menuId}"]`,
          cssText: 'display: block;',
          pseudo: ':hover',
        });
      }
    }
  }

  return rules;
}

// --- Radix UI data-state CSS ---
function extractRadixStateCSS(rootElement) {
  const rules = [];
  const stateElements = rootElement.querySelectorAll('[data-state]');

  for (const el of stateElements) {
    const mimeId = el.getAttribute('data-mime-id');
    const state = el.getAttribute('data-state');
    if (mimeId && state) {
      rules.push({
        selector: `[data-mime-id="${mimeId}"][data-state="${state}"]`,
        cssText: '', // Styles come from the extracted CSS rules
        pseudo: `:data-state-${state}`,
        note: `Radix UI state: ${state}`,
      });
    }
  }

  return rules;
}

// --- Material UI state CSS ---
function extractMUIStateCSS(rootElement) {
  const rules = [];
  const muiElements = rootElement.querySelectorAll('[class*="Mui"]');

  for (const el of muiElements) {
    const mimeId = el.getAttribute('data-mime-id');
    if (!mimeId) continue;

    const classes = Array.from(el.classList);
    if (classes.some((c) => c.includes('disabled') || c.includes('Disabled'))) {
      rules.push({
        selector: `[data-mime-id="${mimeId}"]:disabled`,
        cssText: 'opacity: 0.38; pointer-events: none;',
        pseudo: ':disabled',
        note: 'Material UI disabled state',
      });
    }
  }

  return rules;
}

// --- Helpers ---

function getAllClasses(rootElement) {
  const classes = new Set();
  const elements = rootElement.querySelectorAll('*');
  for (const el of elements) {
    for (const cls of el.classList) {
      classes.add(cls);
    }
  }
  return Array.from(classes);
}

// Basic Tailwind class to CSS mapping (common utilities)
const TAILWIND_MAP = {
  'bg-blue-500': 'background-color: #3b82f6',
  'bg-blue-600': 'background-color: #2563eb',
  'bg-blue-700': 'background-color: #1d4ed8',
  'bg-gray-100': 'background-color: #f3f4f6',
  'bg-gray-200': 'background-color: #e5e7eb',
  'bg-white': 'background-color: #ffffff',
  'bg-transparent': 'background-color: transparent',
  'text-white': 'color: #ffffff',
  'text-gray-500': 'color: #6b7280',
  'text-gray-700': 'color: #374151',
  'text-blue-600': 'color: #2563eb',
  'opacity-50': 'opacity: 0.5',
  'opacity-80': 'opacity: 0.8',
  'opacity-100': 'opacity: 1',
  'scale-105': 'transform: scale(1.05)',
  'scale-95': 'transform: scale(0.95)',
  'shadow-lg': 'box-shadow: 0 10px 15px -3px rgb(0 0 0 / 0.1)',
  'shadow-md': 'box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1)',
  'underline': 'text-decoration: underline',
  'no-underline': 'text-decoration: none',
  'ring-2': 'box-shadow: 0 0 0 2px',
  'outline-none': 'outline: none',
};

function tailwindClassesToCSS(classes) {
  const declarations = [];

  for (const cls of classes) {
    if (TAILWIND_MAP[cls]) {
      declarations.push(TAILWIND_MAP[cls]);
    }
    // Handle arbitrary values like bg-[#FF0066]
    const arbMatch = cls.match(/^(\w+)-\[(.+)\]$/);
    if (arbMatch) {
      const [, prefix, value] = arbMatch;
      const propMap = {
        bg: 'background-color',
        text: 'color',
        border: 'border-color',
        w: 'width',
        h: 'height',
        p: 'padding',
        m: 'margin',
        rounded: 'border-radius',
        opacity: 'opacity',
      };
      if (propMap[prefix]) {
        declarations.push(`${propMap[prefix]}: ${value}`);
      }
    }
  }

  return declarations.length > 0 ? declarations.join('; ') + ';' : null;
}
