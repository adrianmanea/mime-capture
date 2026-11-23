/**
 * Screenshot Capture
 *
 * Captures a screenshot of a specific element by:
 * 1. Hiding the extension UI
 * 2. Requesting full-page screenshot via background script
 * 3. Cropping to element bounds using canvas
 * 4. DPI-aware scaling (capped at 1.5x to prevent huge files)
 * 5. Exporting as JPEG at 85% quality
 */

/**
 * Capture a cropped screenshot of a specific element.
 *
 * @param {Element} element - The DOM element to capture
 * @returns {Promise<string>} - Base64 data URL (JPEG)
 */
export async function captureElementScreenshot(element) {
  // 1. Hide extension UI temporarily
  const extensionRoot = document.getElementById('mime-extension-root');
  let previousDisplay = '';
  if (extensionRoot) {
    previousDisplay = extensionRoot.style.display;
    extensionRoot.style.display = 'none';
  }

  // Small delay for the browser to repaint
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  try {
    // 2. Get element bounds
    const rect = element.getBoundingClientRect();

    // 3. Capture the visible tab
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, resolve);
    });

    if (!response?.dataUrl) {
      throw new Error('Failed to capture tab screenshot');
    }

    // 4. Load the full screenshot into an image
    const img = await loadImage(response.dataUrl);

    // 5. Calculate DPI-aware dimensions (cap at 1.5x)
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

    const cropX = rect.left * dpr;
    const cropY = rect.top * dpr;
    const cropWidth = rect.width * dpr;
    const cropHeight = rect.height * dpr;

    // 6. Create canvas and crop
    const canvas = document.createElement('canvas');
    canvas.width = cropWidth;
    canvas.height = cropHeight;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(
      img,
      cropX, cropY, cropWidth, cropHeight, // source rect
      0, 0, cropWidth, cropHeight            // dest rect
    );

    // 7. Export as JPEG 85% quality
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    // Restore extension UI
    if (extensionRoot) {
      extensionRoot.style.display = previousDisplay;
    }
  }
}

/**
 * Load an image from a data URL.
 */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
