/**
 * Interaction Recorder
 *
 * The "tactic" strategy: simulates user interactions (hover, focus, click)
 * on every element in the subtree, uses MutationObserver to track
 * attribute/style changes, then captures the resulting states.
 */

/**
 * Record interaction states for all interactive elements in a subtree.
 *
 * @param {Element} rootElement - The root element to record
 * @param {Function} onStateChange - Callback when a new state is captured
 * @returns {{ stop: Function, t: number }} - Controller with stop() and timer ID
 */
export function startInteractionRecording(rootElement, onStateChange) {
  const recordedChanges = [];
  let isRunning = true;

  // Build initial style snapshot
  const initialStyles = {};
  const elements = rootElement.querySelectorAll('*');
  for (const el of elements) {
    const mimeId = el.getAttribute('data-mime-id');
    if (mimeId) {
      const computed = window.getComputedStyle(el);
      initialStyles[mimeId] = {
        backgroundColor: computed.backgroundColor,
        color: computed.color,
        opacity: computed.opacity,
        transform: computed.transform,
        boxShadow: computed.boxShadow,
        borderColor: computed.borderColor,
        outline: computed.outline,
        textDecoration: computed.textDecoration,
        display: computed.display,
        visibility: computed.visibility,
      };
    }
  }

  // Set up MutationObserver to watch for attribute changes
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target.getAttribute) {
        const mimeId = mutation.target.getAttribute('data-mime-id');
        if (mimeId) {
          recordedChanges.push({
            mimeId,
            attribute: mutation.attributeName,
            oldValue: mutation.oldValue,
            newValue: mutation.target.getAttribute(mutation.attributeName),
            timestamp: Date.now(),
          });
        }
      }
    }
  });

  observer.observe(rootElement, {
    attributes: true,
    subtree: true,
    attributeOldValue: true,
  });

  // Simulate interactions on each element
  let simulationTimer;
  const simulateInteractions = async () => {
    const interactiveElements = rootElement.querySelectorAll(
      'a, button, input, select, textarea, [role="button"], [tabindex], [onclick]'
    );

    for (const el of interactiveElements) {
      if (!isRunning) break;

      const mimeId = el.getAttribute('data-mime-id');

      // Simulate hover
      el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(50);

      // Capture hover state
      const hoverStyles = captureStyleDiff(el, initialStyles[mimeId]);
      if (hoverStyles && Object.keys(hoverStyles).length > 0) {
        recordedChanges.push({
          mimeId,
          state: 'hover',
          styleDiff: hoverStyles,
          timestamp: Date.now(),
        });
        onStateChange?.(recordedChanges.length);
      }

      // Simulate focus if focusable
      const focusable = ['INPUT', 'BUTTON', 'A', 'SELECT', 'TEXTAREA'];
      if (focusable.includes(el.tagName) || el.getAttribute('tabindex') !== null) {
        el.focus();
        await sleep(50);

        const focusStyles = captureStyleDiff(el, initialStyles[mimeId]);
        if (focusStyles && Object.keys(focusStyles).length > 0) {
          recordedChanges.push({
            mimeId,
            state: 'focus',
            styleDiff: focusStyles,
            timestamp: Date.now(),
          });
          onStateChange?.(recordedChanges.length);
        }

        el.blur();
      }

      // Reset hover
      el.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      await sleep(30);
    }
  };

  simulationTimer = setTimeout(simulateInteractions, 100);

  return {
    stop() {
      isRunning = false;
      observer.disconnect();
      clearTimeout(simulationTimer);
      return recordedChanges;
    },
    t: simulationTimer,
  };
}

/**
 * Capture the diff between current computed styles and initial snapshot.
 */
function captureStyleDiff(element, initialSnapshot) {
  if (!initialSnapshot) return null;

  const computed = window.getComputedStyle(element);
  const diff = {};

  for (const [prop, initialValue] of Object.entries(initialSnapshot)) {
    const currentValue = computed[prop];
    if (currentValue !== initialValue) {
      diff[prop] = { from: initialValue, to: currentValue };
    }
  }

  return Object.keys(diff).length > 0 ? diff : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Freeze all animations on an element subtree.
 * Returns a cleanup function to restore them.
 */
export function freezeAnimations(rootElement) {
  const style = document.createElement('style');
  const mimeId = rootElement.getAttribute('data-mime-id');
  style.textContent = `
    [data-mime-id="${mimeId}"],
    [data-mime-id="${mimeId}"] * {
      animation: none !important;
      transition: none !important;
    }
  `;
  document.head.appendChild(style);

  // Force layout recalc
  void rootElement.offsetHeight;

  return () => {
    document.head.removeChild(style);
  };
}
