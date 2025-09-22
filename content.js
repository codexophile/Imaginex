(function () {
  'use strict';

  let hoverOverlay = null;
  let currentImg = null;
  let hoverTimer = null;
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
            max-width: 90vw;
            max-height: 90vh;
            border-radius: 4px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            overflow: hidden;
        `;

    const img = document.createElement('img');
    img.style.cssText = `
            display: block;
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
        `;

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    return overlay;
  }

  // Check if an image is scaled down from its natural size
  function isImageScaledDown(img) {
    if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
      return false;
    }

    const rect = img.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    // Check if the image is displayed significantly smaller than its natural size
    const widthRatio = img.naturalWidth / displayWidth;
    const heightRatio = img.naturalHeight / displayHeight;

    // Only show if the image is scaled down by at least 20% in either dimension
    return widthRatio > 1.2 || heightRatio > 1.2;
  }

  // Position the overlay relative to the cursor
  function positionOverlay(overlay, mouseX, mouseY) {
    const overlayRect = overlay.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let left = mouseX + 15; // Default: 15px to the right of cursor
    let top = mouseY - overlayRect.height / 2; // Center vertically on cursor

    // Adjust horizontal position if overlay would go off-screen
    if (left + overlayRect.width > viewportWidth - 10) {
      left = mouseX - overlayRect.width - 15; // Show to the left of cursor
    }

    // Adjust vertical position if overlay would go off-screen
    if (top < 10) {
      top = 10;
    } else if (top + overlayRect.height > viewportHeight - 10) {
      top = viewportHeight - overlayRect.height - 10;
    }

    overlay.style.left = left + 'px';
    overlay.style.top = top + 'px';
  }

  // Show the enlarged image
  function showEnlargedImage(img, mouseX, mouseY) {
    if (!hoverOverlay) {
      hoverOverlay = createOverlay();
    }

    const overlayImg = hoverOverlay.querySelector('img');
    overlayImg.src = img.src;
    overlayImg.alt = img.alt || '';

    // Set natural dimensions or reasonable max size
    const maxWidth = Math.min(img.naturalWidth, window.innerWidth * 0.9);
    const maxHeight = Math.min(img.naturalHeight, window.innerHeight * 0.9);

    overlayImg.style.maxWidth = maxWidth + 'px';
    overlayImg.style.maxHeight = maxHeight + 'px';

    hoverOverlay.style.display = 'block';

    // Wait for image to load and get dimensions, then position
    overlayImg.onload = () => {
      positionOverlay(hoverOverlay, mouseX, mouseY);
    };

    // If image is already loaded, position immediately
    if (overlayImg.complete) {
      positionOverlay(hoverOverlay, mouseX, mouseY);
    }
  }

  // Hide the enlarged image
  function hideEnlargedImage() {
    if (hoverOverlay) {
      hoverOverlay.style.display = 'none';
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
      if (currentImg === img && isImageScaledDown(img)) {
        showEnlargedImage(img, event.clientX, event.clientY);
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
    // Use event delegation for better performance
    document.addEventListener(
      'mouseenter',
      function (event) {
        console.log(event.target);
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
  }

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
