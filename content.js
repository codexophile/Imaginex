(function () {
  'use strict';

  let hoverOverlay = null;
  let currentImg = null;
  let hoverTimer = null;
  let noPopupTooltip = null;
  const HOVER_DELAY = 300; // milliseconds to wait before showing enlarged image

  // Create the hover overlay element
  function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'image-enlarger-overlay';
    overlay.style.cssText = `
            position: fixed;
            z-index: 999999;
            pointer-events: none;
            display: none;
            border-radius: 4px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        `;

    const img = document.createElement('img');
    img.style.cssText = `
            display: block;
            width: 100%;
            height: 100%;
            object-fit: contain;
        `;

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    return overlay;
  }

  // Parse srcset attribute and return the best image source
  function getBestImageSource(img) {
    const srcset = img.getAttribute('srcset');

    if (!srcset) {
      return img.src;
    }

    const candidates = [];
    const sources = srcset.split(',');

    for (const source of sources) {
      const trimmed = source.trim();
      const parts = trimmed.split(/\s+/);

      if (parts.length >= 2) {
        const url = parts[0];
        const descriptor = parts[1];

        if (descriptor.endsWith('x')) {
          // Pixel density descriptor (e.g., "2x", "3x")
          const density = parseFloat(descriptor.slice(0, -1));
          candidates.push({ url, density, type: 'density' });
        } else if (descriptor.endsWith('w')) {
          // Width descriptor (e.g., "800w", "1200w")
          const width = parseInt(descriptor.slice(0, -1));
          candidates.push({ url, width, type: 'width' });
        }
      } else if (parts.length === 1) {
        // No descriptor, assume 1x density
        candidates.push({ url: parts[0], density: 1, type: 'density' });
      }
    }

    if (candidates.length === 0) {
      return img.src;
    }

    // Sort candidates to find the best one
    if (candidates[0].type === 'density') {
      // For density descriptors, get the highest density
      candidates.sort((a, b) => (b.density || 1) - (a.density || 1));
      return candidates[0].url;
    } else {
      // For width descriptors, get the largest width
      candidates.sort((a, b) => (b.width || 0) - (a.width || 0));
      return candidates[0].url;
    }
  }

  // Get dimensions information for the best image source (including srcset)
  function getBestImageDimensions(img) {
    const bestSource = getBestImageSource(img);
    const srcset = img.getAttribute('srcset');

    // If no srcset or best source is the same as current src, use current dimensions
    if (!srcset || bestSource === img.src) {
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        source: bestSource,
      };
    }

    // Try to extract dimensions from srcset width descriptors
    const sources = srcset.split(',');
    for (const source of sources) {
      const trimmed = source.trim();
      const parts = trimmed.split(/\s+/);

      if (
        parts.length >= 2 &&
        parts[0] === bestSource &&
        parts[1].endsWith('w')
      ) {
        const width = parseInt(parts[1].slice(0, -1));
        // Estimate height based on current image's aspect ratio
        const currentAspectRatio = img.naturalWidth / img.naturalHeight;
        const estimatedHeight = Math.round(width / currentAspectRatio);

        return {
          width: width,
          height: estimatedHeight,
          source: bestSource,
          estimated: true,
        };
      }
    }

    // For density descriptors or when we can't determine from srcset,
    // we'll need to load the image to get exact dimensions
    // For now, return current dimensions as fallback
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      source: bestSource,
    };
  }

  // Check if an image is scaled down from its natural size
  function isImageScaledDown(img) {
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      return false;
    }

    const rect = img.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Get the best available image dimensions (considering srcset)
    const bestDimensions = getBestImageDimensions(img);
    const naturalWidth = bestDimensions.width;
    const naturalHeight = bestDimensions.height;

    // Check if the image is displayed significantly smaller than its best available size
    const widthRatio = naturalWidth / displayWidth;
    const heightRatio = naturalHeight / displayHeight;

    console.log(
      'Image scale check:',
      'Current src:',
      img.src,
      'Best source:',
      bestDimensions.source,
      'Best dimensions:',
      naturalWidth +
        'x' +
        naturalHeight +
        (bestDimensions.estimated ? ' (estimated)' : ''),
      'Display:',
      displayWidth + 'x' + displayHeight,
      'Width ratio:',
      widthRatio.toFixed(2),
      'Height ratio:',
      heightRatio.toFixed(2),
      'Will enlarge:',
      widthRatio > 1.2 || heightRatio > 1.2
    );

    // Only show if the image is scaled down by at least 20% in either dimension
    return widthRatio > 1.2 || heightRatio > 1.2;
  }

  // Position the overlay relative to the cursor
  function positionOverlay(overlay, mouseX, mouseY) {
    const overlayRect = overlay.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    const margin = 15; // Distance from cursor and screen edges
    const overlayWidth = overlayRect.width;
    const overlayHeight = overlayRect.height;

    // Calculate initial position (15px to the right of cursor, centered vertically)
    let left = mouseX + margin;
    let top = mouseY - overlayHeight / 2;

    // Horizontal positioning with fallback options
    if (left + overlayWidth > viewportWidth - margin) {
      // Try positioning to the left of cursor
      const leftPosition = mouseX - overlayWidth - margin;
      if (leftPosition >= margin) {
        left = leftPosition;
      } else {
        // If neither side works, center horizontally and ensure it fits
        left = Math.max(
          margin,
          Math.min(
            viewportWidth - overlayWidth - margin,
            (viewportWidth - overlayWidth) / 2
          )
        );
      }
    }

    // Ensure left position is not negative
    left = Math.max(margin, left);

    // Vertical positioning with fallback options
    if (top < margin) {
      // Too high, position below cursor
      top = mouseY + margin;
      if (top + overlayHeight > viewportHeight - margin) {
        // If below cursor also doesn't fit, center vertically
        top = Math.max(
          margin,
          Math.min(
            viewportHeight - overlayHeight - margin,
            (viewportHeight - overlayHeight) / 2
          )
        );
      }
    } else if (top + overlayHeight > viewportHeight - margin) {
      // Too low, position above cursor
      top = mouseY - overlayHeight - margin;
      if (top < margin) {
        // If above cursor also doesn't fit, center vertically
        top = Math.max(
          margin,
          Math.min(
            viewportHeight - overlayHeight - margin,
            (viewportHeight - overlayHeight) / 2
          )
        );
      }
    }

    // Final bounds check to ensure overlay stays within viewport
    left = Math.max(
      margin,
      Math.min(left, viewportWidth - overlayWidth - margin)
    );
    top = Math.max(
      margin,
      Math.min(top, viewportHeight - overlayHeight - margin)
    );

    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  }

  // Show the enlarged image
  function showEnlargedImage(img, mouseX, mouseY) {
    if (!hoverOverlay) {
      hoverOverlay = createOverlay();
    }

    const overlayImg = hoverOverlay.querySelector('img');
    const bestImageSource = getBestImageSource(img);
    const bestDimensions = getBestImageDimensions(img);

    overlayImg.src = bestImageSource;
    overlayImg.alt = img.alt || '';

    console.log(
      'Using image source for enlargement:',
      bestImageSource,
      'from element:',
      img,
      'Best dimensions:',
      bestDimensions.width + 'x' + bestDimensions.height,
      bestDimensions.estimated ? '(estimated)' : '(exact)'
    );

    // Calculate maximum dimensions considering viewport and margins
    // Calculate maximum available space (leaving margin for positioning)
    const margin = 30; // Total margin for sizing (15px on each side)
    const maxViewportWidth = window.innerWidth - margin;
    const maxViewportHeight = window.innerHeight - margin;

    // Use the best available image dimensions instead of img.naturalWidth/Height
    const bestWidth = bestDimensions.width;
    const bestHeight = bestDimensions.height;

    // Determine optimal size while preserving aspect ratio
    let displayWidth = Math.min(bestWidth, maxViewportWidth);
    let displayHeight = Math.min(bestHeight, maxViewportHeight);

    // If image is too large, scale it down proportionally
    const aspectRatio = bestWidth / bestHeight;

    if (displayWidth / displayHeight > aspectRatio) {
      // Width is the limiting factor
      displayWidth = displayHeight * aspectRatio;
    } else {
      // Height is the limiting factor
      displayHeight = displayWidth / aspectRatio;
    }

    // Ensure minimum readable size but not larger than natural size
    displayWidth = Math.min(Math.max(displayWidth, 200), bestWidth);
    displayHeight = Math.min(Math.max(displayHeight, 150), bestHeight);

    // Set both the overlay container and image dimensions to prevent overflow cropping
    hoverOverlay.style.width = displayWidth + 'px';
    hoverOverlay.style.height = displayHeight + 'px';

    overlayImg.style.width = displayWidth + 'px';
    overlayImg.style.height = displayHeight + 'px';

    hoverOverlay.style.display = 'block';

    // Wait for image to load and get dimensions, then position
    overlayImg.onload = () => {
      // Force a reflow to ensure dimensions are calculated correctly
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
    };

    // If image is already loaded, position immediately
    if (overlayImg.complete) {
      // Force a reflow to ensure dimensions are calculated correctly
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
    }
  }

  // Create tooltip for no-popup indication
  function createNoPopupTooltip() {
    const tooltip = document.createElement('div');
    tooltip.id = 'image-enlarger-no-popup-tooltip';
    tooltip.style.cssText = `
        position: fixed;
        z-index: 1000000;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 6px 12px;
        border-radius: 4px;
        font-size: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        pointer-events: none;
        display: none;
        white-space: nowrap;
    `;
    tooltip.textContent = 'Image already at optimal size';
    document.body.appendChild(tooltip);
    return tooltip;
  }

  // Show visual indicator for images that won't be enlarged
  function showNoPopupIndicator(img) {
    console.log(
      'Showing no-popup indicator for image:',
      img.src,
      'Natural:',
      img.naturalWidth + 'x' + img.naturalHeight,
      'Display:',
      img.getBoundingClientRect().width +
        'x' +
        img.getBoundingClientRect().height
    );
    img.classList.add('image-enlarger-no-popup');

    // Show tooltip
    if (!noPopupTooltip) {
      noPopupTooltip = createNoPopupTooltip();
    }

    const rect = img.getBoundingClientRect();
    const scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    const scrollY = window.pageYOffset || document.documentElement.scrollTop;

    noPopupTooltip.style.left =
      rect.left + scrollX + rect.width / 2 - 80 + 'px';
    noPopupTooltip.style.top = rect.top + scrollY - 30 + 'px';
    noPopupTooltip.style.display = 'block';
  }

  // Hide visual indicator
  function hideNoPopupIndicator(img) {
    if (img) {
      img.classList.remove('image-enlarger-no-popup');
    }
    if (noPopupTooltip) {
      noPopupTooltip.style.display = 'none';
    }
  }

  // Hide the enlarged image
  function hideEnlargedImage() {
    if (hoverOverlay) {
      hoverOverlay.style.display = 'none';
    }
    // Also remove any visual indicators
    if (currentImg) {
      hideNoPopupIndicator(currentImg);
    }
    currentImg = null;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  // Handle mouse enter on images
  function handleImageMouseEnter(event) {
    const img = event.target;

    // Skip if not an image or same image
    if (img.tagName !== 'IMG' || img === currentImg) {
      return;
    }

    currentImg = img;

    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    // Set timer to show enlarged image after delay
    hoverTimer = setTimeout(() => {
      if (currentImg === img) {
        if (isImageScaledDown(img)) {
          showEnlargedImage(img, event.clientX, event.clientY);
        } else {
          // Show visual indicator that image won't be enlarged
          showNoPopupIndicator(img);
        }
      }
    }, HOVER_DELAY);
  }

  // Handle mouse leave on images
  function handleImageMouseLeave(event) {
    const img = event.target;

    if (img === currentImg) {
      hideEnlargedImage();
    }
  }

  // Handle mouse move to update overlay position
  function handleImageMouseMove(event) {
    if (hoverOverlay && hoverOverlay.style.display === 'block') {
      positionOverlay(hoverOverlay, event.clientX, event.clientY);
    }
  }

  // Initialize the extension
  function init() {
    // Inject universal CSS fixes for overlay elements that block image interaction
    injectUniversalFixes();

    // Use event delegation for better performance
    document.addEventListener(
      'mouseenter',
      function (event) {
        if (event.target.tagName === 'IMG') {
          handleImageMouseEnter(event);
        }
      },
      true
    );

    document.addEventListener(
      'mouseleave',
      function (event) {
        if (event.target.tagName === 'IMG') {
          handleImageMouseLeave(event);
        }
      },
      true
    );

    document.addEventListener(
      'mousemove',
      function (event) {
        if (event.target.tagName === 'IMG' && event.target === currentImg) {
          handleImageMouseMove(event);
        }
      },
      true
    );

    // Hide overlay when scrolling or clicking
    document.addEventListener('scroll', hideEnlargedImage, true);
    document.addEventListener('click', hideEnlargedImage, true);
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        hideEnlargedImage();
      }
    });

    // Hide overlay when the window loses focus
    window.addEventListener('blur', hideEnlargedImage);

    // Reposition overlay on window resize to keep it in bounds
    window.addEventListener('resize', function () {
      if (
        hoverOverlay &&
        hoverOverlay.style.display === 'block' &&
        currentImg
      ) {
        // Get current mouse position from the last known position or center of viewport
        const rect = currentImg.getBoundingClientRect();
        const mouseX = rect.left + rect.width / 2;
        const mouseY = rect.top + rect.height / 2;
        positionOverlay(hoverOverlay, mouseX, mouseY);
      }
    });
  }

  // Inject universal CSS fixes for blocking overlay elements
  function injectUniversalFixes() {
    const style = document.createElement('style');
    style.textContent = `
      /* Universal fixes for elements that block image mouse events */
      /* Instagram overlays */
      ._aagw {
        pointer-events: none !important;
      }

      /* Common overlay patterns that block image interaction */
      [style*="position: absolute"][style*="inset: 0"]:not(img):not(video):empty {
        pointer-events: none !important;
      }

      /* Additional common patterns for empty overlays */
      div[style*="position: absolute"]:empty,
      div[style*="position: fixed"]:empty {
        pointer-events: none !important;
      }

      /* Pinterest overlays */
      div[data-test-id*="overlay"]:empty {
        pointer-events: none !important;
      }

      /* Twitter/X overlays */
      div[data-testid*="overlay"]:empty {
        pointer-events: none !important;
      }

      /* Facebook/Meta overlays */
      div[role="presentation"]:empty {
        pointer-events: none !important;
      }

      /* Generic overlay class patterns */
      .overlay:empty,
      .image-overlay:empty,
      .hover-overlay:empty,
      .transparent-overlay:empty,
      .block-overlay:empty {
        pointer-events: none !important;
      }

      /* Site-specific fixes */
      /* Tumblr image overlays */
      .post-content .image-wrapper > div:empty {
        pointer-events: none !important;
      }

      /* Reddit image overlays */
      ._1JmnMJclrTwTPpAip5U_Hm:empty {
        pointer-events: none !important;
      }
    `;

    // Insert at the beginning of head to ensure lower specificity doesn't override
    document.head.insertBefore(style, document.head.firstChild);
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
