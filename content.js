(function () {
  'use strict';

  let hoverOverlay = null;
  let loadingSpinner = null;
  let currentImg = null;
  let currentTrigger = null;
  let hoverTimer = null;
  let noPopupTooltip = null;
  let HOVER_DELAY = 300; // default; will be overridden by settings
  let ENABLE_ANIMATIONS = true; // default; will be overridden by settings
  let customRules = []; // Custom rules for finding higher-quality images
  let builtInRulesMap = new Map(); // Built-in rules (id -> full rule object)
  let allBuiltInRules = []; // Store all built-in rules for domain filtering

  // Locked zoom mode state
  let lockedZoomMode = false;
  let lockedZoomOffsetX = 0;
  let lockedZoomOffsetY = 0;
  let lockedZoomDragging = false;
  let lockedZoomDragStartX = 0;
  let lockedZoomDragStartY = 0;
  let lockedZoomBorder = null;

  // Shortcuts state
  let shortcutBindings = {
    zoomFullResolution: [null, null],
    zoomIn: [null, null],
    zoomOut: [null, null],
  };

  // Zoom state
  let currentZoomLevel = 1;
  const zoomStep = 0.1; // 10% zoom per action
  const minZoom = 0.5; // 50% minimum zoom
  const maxZoom = 3; // 300% maximum zoom

  const SETTINGS_INTERNAL_KEY = '__settings_v1';

  function injectLockedZoomStyles() {
    if (document.getElementById('imagus-locked-zoom-styles')) return;
    const style = document.createElement('style');
    style.id = 'imagus-locked-zoom-styles';
    style.textContent = `
      #imagus-locked-zoom-barrier {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        z-index: 999998;
        pointer-events: auto;
        background: transparent;
      }
      #image-enlarger-overlay.locked-zoom-mode {
        pointer-events: auto !important;
        cursor: grab;
        border: 2px solid rgba(100, 150, 255, 0.5);
        box-shadow: inset 0 0 0 2px rgba(100, 150, 255, 0.3), 0 4px 20px rgba(0, 0, 0, 0.5);
        z-index: 999999;
      }
      #image-enlarger-overlay.locked-zoom-mode:active {
        cursor: grabbing;
      }
      #image-enlarger-overlay.locked-zoom-mode #image-enlarger-overlay-img {
        user-select: none;
        -webkit-user-drag: none;
      }
      #imagus-locked-zoom-border {
        position: fixed;
        z-index: 999998;
        border: 2px dashed rgba(100, 150, 255, 0.4);
        pointer-events: none;
        display: none;
      }
    `;
    document.head.appendChild(style);
  }

  function createLockedZoomBorder() {
    if (!lockedZoomBorder) {
      lockedZoomBorder = document.createElement('div');
      lockedZoomBorder.id = 'imagus-locked-zoom-border';
      document.body.appendChild(lockedZoomBorder);
    }
    return lockedZoomBorder;
  }

  function updateLockedZoomBorder() {
    if (!hoverOverlay || !lockedZoomMode) return;
    const border = createLockedZoomBorder();
    const rect = hoverOverlay.getBoundingClientRect();
    border.style.left = rect.left + 'px';
    border.style.top = rect.top + 'px';
    border.style.width = rect.width + 'px';
    border.style.height = rect.height + 'px';
    border.style.display = 'block';
  }

  function hideLockedZoomBorder() {
    if (lockedZoomBorder) {
      lockedZoomBorder.style.display = 'none';
    }
  }

  // Create a pointer-events barrier to block interactions with background elements
  function createLockedZoomBarrier() {
    let barrier = document.getElementById('imagus-locked-zoom-barrier');
    if (!barrier) {
      barrier = document.createElement('div');
      barrier.id = 'imagus-locked-zoom-barrier';
      document.body.appendChild(barrier);
    }
    return barrier;
  }

  function showLockedZoomBarrier() {
    const barrier = createLockedZoomBarrier();
    barrier.style.display = 'block';
  }

  function hideLockedZoomBarrier() {
    const barrier = document.getElementById('imagus-locked-zoom-barrier');
    if (barrier) {
      barrier.style.display = 'none';
    }
  }

  function enterLockedZoomMode() {
    if (!hoverOverlay || lockedZoomMode) return;
    lockedZoomMode = true;

    injectLockedZoomStyles();
    hoverOverlay.classList.add('locked-zoom-mode');

    // Center overlay in viewport and prepare the image for panning
    const img = hoverOverlay.querySelector('img');
    if (img && img.naturalWidth && img.naturalHeight) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      // Overlay size should be large enough to show the full image, but centered in viewport
      const overlayW = Math.min(img.naturalWidth, vw - 30);
      const overlayH = Math.min(img.naturalHeight, vh - 30);

      // Position overlay centered in viewport
      hoverOverlay.style.width = overlayW + 'px';
      hoverOverlay.style.height = overlayH + 'px';
      hoverOverlay.style.left = (vw - overlayW) / 2 + 'px';
      hoverOverlay.style.top = (vh - overlayH) / 2 + 'px';
      hoverOverlay.style.position = 'fixed';
      hoverOverlay.style.overflow = 'hidden'; // Clip to viewport boundaries

      // Show the image at its natural size inside the fixed overlay
      img.style.width = img.naturalWidth + 'px';
      img.style.height = img.naturalHeight + 'px';
      // img.style.objectFit = 'none';

      // Start centered: compute initial offsets so the overlay shows the image center
      const overflowX = Math.max(0, img.naturalWidth - overlayW);
      const overflowY = Math.max(0, img.naturalHeight - overlayH);
      lockedZoomOffsetX = -overflowX / 2;
      lockedZoomOffsetY = -overflowY / 2;
      img.style.transform = `translate(${lockedZoomOffsetX}px, ${lockedZoomOffsetY}px)`;
    }

    updateLockedZoomBorder();
    showLockedZoomBarrier();
    console.log('Entered locked zoom mode');
  }

  function exitLockedZoomMode() {
    if (!lockedZoomMode) return;
    console.trace('exitLockedZoomMode called from:');
    lockedZoomMode = false;
    lockedZoomOffsetX = 0;
    lockedZoomOffsetY = 0;
    lockedZoomDragging = false;
    currentZoomLevel = 1; // Reset zoom level when exiting locked zoom mode

    hideLockedZoomBarrier();

    if (hoverOverlay) {
      hoverOverlay.classList.remove('locked-zoom-mode');
      const img = hoverOverlay.querySelector('img');
      if (img) {
        img.style.transform = '';
        img.style.width = '';
        img.style.height = '';
        img.style.objectFit = '';
      }
    }
    hideLockedZoomBorder();
    console.log('Exited locked zoom mode');
  }

  function handleLockedZoomMouseDown(e) {
    // Check for mouse zoom shortcut first
    const zoomBindings = shortcutBindings.zoomFullResolution || [];
    const isZoomShortcut = zoomBindings.some(b =>
      bindingMatchesMouseEvent(b, e)
    );

    if (isZoomShortcut) {
      if (hoverOverlay && hoverOverlay.style.display === 'block') {
        if (lockedZoomMode) {
          exitLockedZoomMode();
        } else {
          enterLockedZoomMode();
        }
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        e.stopPropagation();
        return;
      }
    }

    // Otherwise, handle drag if in locked zoom mode
    if (!lockedZoomMode || !hoverOverlay) return;
    lockedZoomDragging = true;
    lockedZoomDragStartX = e.clientX;
    lockedZoomDragStartY = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  }

  function handleLockedZoomMouseMove(e) {
    if (!lockedZoomMode || !lockedZoomDragging || !hoverOverlay) return;
    const dx = e.clientX - lockedZoomDragStartX;
    const dy = e.clientY - lockedZoomDragStartY;

    lockedZoomOffsetX += dx;
    lockedZoomOffsetY += dy;

    // Constrain offsets so the image stays fully visible within the overlay
    const img = hoverOverlay.querySelector('img');
    if (img && img.naturalWidth && img.naturalHeight) {
      const overflowX = Math.max(
        0,
        img.naturalWidth - hoverOverlay.offsetWidth
      );
      const overflowY = Math.max(
        0,
        img.naturalHeight - hoverOverlay.offsetHeight
      );
      const minX = -overflowX;
      const maxX = 0;
      const minY = -overflowY;
      const maxY = 0;
      lockedZoomOffsetX = Math.max(minX, Math.min(lockedZoomOffsetX, maxX));
      lockedZoomOffsetY = Math.max(minY, Math.min(lockedZoomOffsetY, maxY));
    }

    img.style.transform = `translate(${lockedZoomOffsetX}px, ${lockedZoomOffsetY}px)`;

    lockedZoomDragStartX = e.clientX;
    lockedZoomDragStartY = e.clientY;
    e.preventDefault();
    e.stopPropagation();
  }

  function handleLockedZoomMouseUp(e) {
    if (!lockedZoomMode) return;
    lockedZoomDragging = false;
    e.preventDefault();
    e.stopPropagation();
  }

  function zoomIn() {
    if (
      !lockedZoomMode ||
      !hoverOverlay ||
      hoverOverlay.style.display !== 'block'
    )
      return;
    const img = hoverOverlay.querySelector('img');
    if (!img) return;

    const newZoom = Math.min(currentZoomLevel + zoomStep, maxZoom);
    if (newZoom === currentZoomLevel) return; // Already at max zoom

    const scaleFactor = newZoom / currentZoomLevel;
    const currentWidth = parseFloat(img.style.width || img.offsetWidth);
    const currentHeight = parseFloat(img.style.height || img.offsetHeight);

    img.style.width = currentWidth * scaleFactor + 'px';
    img.style.height = currentHeight * scaleFactor + 'px';

    // If in locked zoom mode, apply the zoom
    if (lockedZoomMode) {
      // Adjust the transform to maintain center position while zooming
      const overlayWidth = hoverOverlay.offsetWidth;
      const overlayHeight = hoverOverlay.offsetHeight;
      const newImgWidth = currentWidth * scaleFactor;
      const newImgHeight = currentHeight * scaleFactor;
      const overflowX = Math.max(0, newImgWidth - overlayWidth);
      const overflowY = Math.max(0, newImgHeight - overlayHeight);
      // Keep the current center point in view by adjusting offsets proportionally
      const centerX = lockedZoomOffsetX + overlayWidth / 2;
      const centerY = lockedZoomOffsetY + overlayHeight / 2;
      lockedZoomOffsetX = Math.max(
        -overflowX,
        Math.min(centerX - overlayWidth / 2, 0)
      );
      lockedZoomOffsetY = Math.max(
        -overflowY,
        Math.min(centerY - overlayHeight / 2, 0)
      );
      img.style.transform = `translate(${lockedZoomOffsetX}px, ${lockedZoomOffsetY}px)`;
    }

    currentZoomLevel = newZoom;
  }

  function zoomOut() {
    if (
      !lockedZoomMode ||
      !hoverOverlay ||
      hoverOverlay.style.display !== 'block'
    )
      return;
    const img = hoverOverlay.querySelector('img');
    if (!img) return;

    const newZoom = Math.max(currentZoomLevel - zoomStep, minZoom);
    if (newZoom === currentZoomLevel) return; // Already at min zoom

    const scaleFactor = newZoom / currentZoomLevel;
    const currentWidth = parseFloat(img.style.width || img.offsetWidth);
    const currentHeight = parseFloat(img.style.height || img.offsetHeight);

    img.style.width = currentWidth * scaleFactor + 'px';
    img.style.height = currentHeight * scaleFactor + 'px';

    // If in locked zoom mode, apply the zoom
    if (lockedZoomMode) {
      // Adjust the transform to maintain center position while zooming
      const overlayWidth = hoverOverlay.offsetWidth;
      const overlayHeight = hoverOverlay.offsetHeight;
      const newImgWidth = currentWidth * scaleFactor;
      const newImgHeight = currentHeight * scaleFactor;
      const overflowX = Math.max(0, newImgWidth - overlayWidth);
      const overflowY = Math.max(0, newImgHeight - overlayHeight);
      // Keep the current center point in view by adjusting offsets proportionally
      const centerX = lockedZoomOffsetX + overlayWidth / 2;
      const centerY = lockedZoomOffsetY + overlayHeight / 2;
      lockedZoomOffsetX = Math.max(
        -overflowX,
        Math.min(centerX - overlayWidth / 2, 0)
      );
      lockedZoomOffsetY = Math.max(
        -overflowY,
        Math.min(centerY - overlayHeight / 2, 0)
      );
      img.style.transform = `translate(${lockedZoomOffsetX}px, ${lockedZoomOffsetY}px)`;
    }

    currentZoomLevel = newZoom;
  }

  function applySettingsFromStorage(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.hoverDelay === 'number') HOVER_DELAY = raw.hoverDelay;
    if (typeof raw.enableAnimations === 'boolean') {
      ENABLE_ANIMATIONS = raw.enableAnimations;
      applyAnimationSettings();
    }
    if (Array.isArray(raw.customRules)) {
      const hostname = window.location.hostname;
      // Filter custom rules: enabled AND applies to this domain
      customRules = raw.customRules.filter(
        r => r && r.enabled && shouldRunRule(r, hostname)
      );
      console.log(
        'Loaded custom rules:',
        customRules.length,
        'of',
        (raw.customRules || []).length,
        'for domain:',
        hostname
      );
    }
    if (Array.isArray(raw.builtInRules)) {
      const hostname = window.location.hostname;
      // Store full rule objects for domain filtering
      allBuiltInRules = raw.builtInRules || [];
      // Create map: id -> rule object
      builtInRulesMap = new Map(raw.builtInRules.map(r => [r.id, r]));
      console.log('Loaded built-in rules:', builtInRulesMap.size, 'rules');
      // Reapply CSS fixes when built-in rules change
      reapplyCssFixes();
    }
    // Load shortcuts from settings
    if (raw.shortcuts && typeof raw.shortcuts === 'object') {
      console.log('raw.shortcuts object found:', JSON.stringify(raw.shortcuts));
      shortcutBindings = { ...shortcutBindings };
      if (Array.isArray(raw.shortcuts.zoomFullResolution)) {
        console.log(
          'zoomFullResolution array found, length:',
          raw.shortcuts.zoomFullResolution.length
        );
        shortcutBindings.zoomFullResolution =
          raw.shortcuts.zoomFullResolution.filter(
            b => b && typeof b === 'object' && b.type && b.combo
          );
      } else {
        console.log(
          'zoomFullResolution is NOT an array:',
          raw.shortcuts.zoomFullResolution
        );
      }
      if (Array.isArray(raw.shortcuts.zoomIn)) {
        shortcutBindings.zoomIn = raw.shortcuts.zoomIn.filter(
          b => b && typeof b === 'object' && b.type && b.combo
        );
      }
      if (Array.isArray(raw.shortcuts.zoomOut)) {
        shortcutBindings.zoomOut = raw.shortcuts.zoomOut.filter(
          b => b && typeof b === 'object' && b.type && b.combo
        );
      }
      console.log('Final shortcutBindings:', JSON.stringify(shortcutBindings));
    } else {
      console.log('raw.shortcuts NOT found or not an object:', raw.shortcuts);
    }
  }

  // Apply or remove animation classes/styles based on settings
  function applyAnimationSettings() {
    if (ENABLE_ANIMATIONS) {
      document.documentElement.classList.remove('imagus-no-animations');
    } else {
      document.documentElement.classList.add('imagus-no-animations');
    }
  }

  // Check if a built-in rule is enabled AND applies to current domain
  function isRuleEnabled(ruleId) {
    const rule = builtInRulesMap.get(ruleId);
    if (!rule || rule.enabled === false) return false;

    // Check domain restrictions
    const hostname = window.location.hostname;
    return shouldRunRule(rule, hostname);
  }

  // Domain matching helper - supports wildcards (*.example.com) and exact/suffix matches
  function matchesDomain(hostname, pattern) {
    if (!pattern) return false;
    // Handle wildcards: *.example.com
    if (pattern.startsWith('*.')) {
      const domain = pattern.slice(2); // Remove "*."
      return hostname === domain || hostname.endsWith('.' + domain);
    }
    // Exact or suffix match: example.com matches example.com and sub.example.com
    return hostname === pattern || hostname.endsWith('.' + pattern);
  }

  // Check if a rule should run on the current domain
  function shouldRunRule(rule, hostname) {
    // If rule has no domain restrictions, it runs everywhere
    if (!rule.allowDomains || rule.allowDomains.length === 0) {
      // But still check excludeDomains if present
      if (
        Array.isArray(rule.excludeDomains) &&
        rule.excludeDomains.length > 0
      ) {
        const isExcluded = rule.excludeDomains.some(pattern =>
          matchesDomain(hostname, pattern)
        );
        return !isExcluded;
      }
      return true;
    }

    // Check if hostname matches any allowed domain
    const isAllowed = rule.allowDomains.some(pattern =>
      matchesDomain(hostname, pattern)
    );

    if (!isAllowed) return false;

    // Also check excludeDomains if present (exclude takes priority)
    if (Array.isArray(rule.excludeDomains) && rule.excludeDomains.length > 0) {
      const isExcluded = rule.excludeDomains.some(pattern =>
        matchesDomain(hostname, pattern)
      );
      return !isExcluded;
    }

    return true;
  }

  // Load settings directly from storage (MV3 content scripts can't reliably dynamic-import extension modules)
  chrome.storage.local.get([SETTINGS_INTERNAL_KEY], result => {
    console.log(
      'Loading settings from storage:',
      result[SETTINGS_INTERNAL_KEY]
    );
    applySettingsFromStorage(result[SETTINGS_INTERNAL_KEY]);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const change = changes[SETTINGS_INTERNAL_KEY];
    if (!change) return;
    applySettingsFromStorage(change.newValue);
  });

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
    img.id = 'image-enlarger-overlay-img';
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

  function setOverlayLoading(isLoading) {
    if (!loadingSpinner) {
      if (!isLoading) return;
      loadingSpinner = document.createElement('div');
      loadingSpinner.id = 'image-enlarger-floating-spinner';
      loadingSpinner.innerHTML =
        '<div class="image-enlarger-spinner-ring"></div>';
      document.body.appendChild(loadingSpinner);
    }
    loadingSpinner.style.display = isLoading ? 'flex' : 'none';
  }

  function positionSpinner(mouseX, mouseY) {
    if (!loadingSpinner) return;
    const offset = 12;
    loadingSpinner.style.left = mouseX + offset + 'px';
    loadingSpinner.style.top = mouseY + offset + 'px';
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

  // Custom rule matching and image URL extraction

  function closestDeep(element, selector) {
    if (!element || !selector) return null;
    let node = element;
    while (node) {
      if (node.nodeType === 1 && node.matches?.(selector)) return node;

      // Prefer DOM parent traversal
      if (node.parentElement) {
        node = node.parentElement;
        continue;
      }

      // Cross ShadowRoot boundary via its host
      const root = node.getRootNode?.();
      if (root && root.host) {
        node = root.host;
        continue;
      }

      node = null;
    }
    return null;
  }

  // Legacy extractor helpers removed (css/xpath/query attr resolution).

  function pickBestFromSrcsetString(srcset) {
    const raw = (srcset || '').toString().trim();
    if (!raw) return null;
    // If this is already a single URL, return it.
    if (!raw.includes(',')) {
      const first = raw.split(/\s+/)[0];
      return first || null;
    }

    const candidates = [];
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const pieces = trimmed.split(/\s+/);
      const url = pieces[0];
      const descriptor = pieces[1] || '';

      if (!url) continue;
      if (descriptor.endsWith('w')) {
        const width = parseInt(descriptor.slice(0, -1), 10);
        candidates.push({ url, width: Number.isFinite(width) ? width : 0 });
      } else if (descriptor.endsWith('x')) {
        const density = parseFloat(descriptor.slice(0, -1));
        candidates.push({
          url,
          density: Number.isFinite(density) ? density : 1,
        });
      } else {
        candidates.push({ url, density: 1 });
      }
    }

    if (candidates.length === 0) return null;
    const hasWidth = candidates.some(c => 'width' in c);
    if (hasWidth) {
      candidates.sort((a, b) => (b.width || 0) - (a.width || 0));
      return candidates[0].url;
    }
    candidates.sort((a, b) => (b.density || 1) - (a.density || 1));
    return candidates[0].url;
  }

  // Derive best URL from an image-related element (picture/source/img)
  function bestSrcFromElement(el) {
    if (!el) return null;
    try {
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'picture') {
        const webp = el.querySelector('source[type="image/webp"][srcset]');
        const any = webp || el.querySelector('source[srcset]');
        const srcset = any?.getAttribute('srcset') || '';
        const fromSource = pickBestFromSrcsetString(srcset);
        if (fromSource) return fromSource;
        const img = el.querySelector('img');
        if (img) return bestSrcFromElement(img);
      }
      if (tag === 'source') {
        const srcset = el.getAttribute('srcset') || '';
        const fromSet = pickBestFromSrcsetString(srcset);
        if (fromSet) return fromSet;
      }
      if (tag === 'img') {
        const pic = el.closest?.('picture');
        if (pic) {
          const webp = pic.querySelector('source[type="image/webp"][srcset]');
          const any = webp || pic.querySelector('source[srcset]');
          const srcset = any?.getAttribute('srcset') || '';
          const fromSource = pickBestFromSrcsetString(srcset);
          if (fromSource) return fromSource;
        }
        const fromSet = pickBestFromSrcsetString(
          el.getAttribute('srcset') || ''
        );
        if (fromSet) return fromSet;
        return el.currentSrc || el.src || null;
      }
      // Fallback: try common attributes
      const rawSet = el.getAttribute?.('srcset') || '';
      const fromSet = pickBestFromSrcsetString(rawSet);
      if (fromSet) return fromSet;
      const raw = el.getAttribute?.('src') || '';
      return raw || null;
    } catch (_) {
      return null;
    }
  }

  // Detect patterns where a non-image element sits alongside the real image (e.g., IMDb overlays)
  function findSiblingImageCandidate(trigger) {
    if (!isRuleEnabled('sibling-image-pattern')) return null;
    if (!trigger || !trigger.parentElement) return null;
    const siblings = Array.from(trigger.parentElement.children).filter(
      node => node !== trigger
    );

    for (const sib of siblings) {
      const img = sib.querySelector(
        ':scope > img:not(#image-enlarger-overlay-img)'
      );
      if (img) {
        console.log(
          '[Built-in Rule: Sibling Image Pattern] Found sibling image for trigger:',
          trigger
        );
        return img;
      }
    }

    return null;
  }

  // Legacy variable extraction removed.

  // Legacy template application removed.

  async function checkCustomRules(element) {
    if (!customRules || customRules.length === 0) {
      return null;
    }

    for (const rule of customRules) {
      try {
        // Check if the element or any ancestor matches the selector
        let matched = false;
        try {
          if (element.matches(rule.selector)) matched = true;
          else if (element.closest(rule.selector)) matched = true;
        } catch (_) {
          // Invalid selector, skip
          continue;
        }

        if (!matched) continue;

        console.log('Element matches custom rule:', rule.name, element);

        // Optional: execute Custom JavaScript regardless of API presence
        if (
          rule.userScript &&
          typeof rule.userScript === 'string' &&
          rule.userScript.trim()
        ) {
          const token = 'imagus-trigger-' + Math.random().toString(36).slice(2);
          try {
            element.setAttribute('data-imagus-trigger', token);
          } catch (_) {}
          const ctx = {
            selector: rule.selector,
            src:
              element.currentSrc ||
              element.src ||
              element.getAttribute?.('src') ||
              null,
            href:
              element.href ||
              element.getAttribute?.('href') ||
              closestDeep(element, 'a')?.href ||
              null,
            variables: {},
            triggerSelector: `[data-imagus-trigger="${token}"]`,
          };

          const urlFromScript = await new Promise(resolve => {
            let resolved = false;
            const onOk = e => {
              if (resolved) return;
              resolved = true;
              document.removeEventListener('imagus:userScriptURL', onOk);
              document.removeEventListener('imagus:userScriptError', onErr);
              resolve(String(e.detail || ''));
            };
            const onErr = e => {
              if (resolved) return;
              resolved = true;
              document.removeEventListener('imagus:userScriptURL', onOk);
              document.removeEventListener('imagus:userScriptError', onErr);
              resolve('');
            };
            const onEl = e => {
              if (resolved) return;
              resolved = true;
              document.removeEventListener('imagus:userScriptURL', onOk);
              document.removeEventListener('imagus:userScriptError', onErr);
              document.removeEventListener('imagus:userScriptElement', onEl);
              const sel = String(e.detail || '');
              let url = '';
              try {
                const returned = sel ? document.querySelector(sel) : null;
                if (returned) {
                  url = bestSrcFromElement(returned) || '';
                  try {
                    returned.removeAttribute('data-imagus-return');
                  } catch (_) {}
                }
              } catch (_) {}
              resolve(url);
            };
            document.addEventListener('imagus:userScriptURL', onOk, {
              once: true,
            });
            document.addEventListener('imagus:userScriptError', onErr, {
              once: true,
            });
            document.addEventListener('imagus:userScriptElement', onEl, {
              once: true,
            });
            chrome.runtime.sendMessage(
              { type: 'imagus:execUserScript', code: rule.userScript, ctx },
              res => {
                // background handles execution; result comes via DOM event
              }
            );
            // Safety timeout
            setTimeout(() => {
              if (resolved) return;
              resolved = true;
              document.removeEventListener('imagus:userScriptURL', onOk);
              document.removeEventListener('imagus:userScriptError', onErr);
              document.removeEventListener('imagus:userScriptElement', onEl);
              try {
                element.removeAttribute('data-imagus-trigger');
              } catch (_) {}
              resolve('');
            }, 3000);
          });

          if (urlFromScript && /^https?:\/\//i.test(urlFromScript)) {
            try {
              element.removeAttribute('data-imagus-trigger');
            } catch (_) {}
            return urlFromScript;
          }
          // If we received a derived URL from element return
          if (urlFromScript && !urlFromScript.includes('{')) {
            try {
              element.removeAttribute('data-imagus-trigger');
            } catch (_) {}
            return urlFromScript;
          }
          // If script didn't return usable URL, clean up attribute
          try {
            element.removeAttribute('data-imagus-trigger');
          } catch (_) {}
        }

        // Legacy API and URL template handling removed.
      } catch (error) {
        console.error('Error checking custom rule:', rule.name, error);
      }
    }

    return null;
  }

  // Position the overlay relative to the cursor
  function positionOverlay(overlay, mouseX, mouseY) {
    // In locked zoom mode, the overlay is fixed; don't follow the mouse
    if (lockedZoomMode) return;
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
  function showEnlargedImage(img, mouseX, mouseY, customUrl = null) {
    if (!hoverOverlay) {
      hoverOverlay = createOverlay();
    }

    // Reset zoom level when showing a new image
    currentZoomLevel = 1;

    const overlayImg = hoverOverlay.querySelector('img');
    const bestImageSource = customUrl || getBestImageSource(img);
    const bestDimensions = customUrl ? null : getBestImageDimensions(img);

    overlayImg.alt = img.alt || '';
    overlayImg.style.opacity = '0';
    setOverlayLoading(true);
    positionSpinner(mouseX, mouseY);

    console.log(
      'Using image source for enlargement:',
      bestImageSource,
      customUrl ? '(from custom rule)' : '',
      'from element:',
      img,
      bestDimensions
        ? 'Best dimensions: ' +
            bestDimensions.width +
            'x' +
            bestDimensions.height
        : ''
    );

    // Calculate maximum dimensions considering viewport and margins
    const margin = 30; // Total margin for sizing (15px on each side)
    const maxViewportWidth = window.innerWidth - margin;
    const maxViewportHeight = window.innerHeight - margin;

    const fallbackWidth = bestDimensions ? bestDimensions.width : 1920;
    const fallbackHeight = bestDimensions ? bestDimensions.height : 1080;

    function applySize(naturalWidth, naturalHeight) {
      const bestWidth = naturalWidth || fallbackWidth;
      const bestHeight = naturalHeight || fallbackHeight;

      let displayWidth = Math.min(bestWidth, maxViewportWidth);
      let displayHeight = Math.min(bestHeight, maxViewportHeight);

      const aspectRatio = bestWidth / bestHeight;
      if (displayWidth / displayHeight > aspectRatio) {
        displayWidth = displayHeight * aspectRatio;
      } else {
        displayHeight = displayWidth / aspectRatio;
      }

      displayWidth = Math.min(Math.max(displayWidth, 200), bestWidth);
      displayHeight = Math.min(Math.max(displayHeight, 150), bestHeight);

      hoverOverlay.style.width = displayWidth + 'px';
      hoverOverlay.style.height = displayHeight + 'px';
      overlayImg.style.width = displayWidth + 'px';
      overlayImg.style.height = displayHeight + 'px';
    }

    // Set a reasonable size immediately, position, then refine after load
    applySize(bestDimensions?.width || 0, bestDimensions?.height || 0);
    hoverOverlay.style.display = 'block';
    hoverOverlay.style.visibility = 'hidden';
    positionOverlay(hoverOverlay, mouseX, mouseY);
    hoverOverlay.style.opacity = '0';

    // Handlers must be set before src assignment (cached images can load very fast)
    overlayImg.onload = () => {
      delete overlayImg.dataset.hasFallbackAttempt;
      applySize(overlayImg.naturalWidth, overlayImg.naturalHeight);
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
      setOverlayLoading(false);
      hoverOverlay.style.visibility = 'visible';
      overlayImg.style.opacity = '1';
      hoverOverlay.style.opacity = '1';
    };

    overlayImg.onerror = () => {
      console.warn('Failed to load enlarged image:', bestImageSource);
      if (customUrl && !overlayImg.dataset.hasFallbackAttempt) {
        overlayImg.dataset.hasFallbackAttempt = 'true';
        const fallback = getBestImageSource(img);
        console.warn('Falling back to original image source:', fallback);
        if (fallback && fallback !== bestImageSource) {
          overlayImg.src = fallback;
        } else {
          console.error('No valid fallback available, hiding overlay');
          hideEnlargedImage();
        }
      } else {
        console.error('Image load failed, hiding overlay');
        hideEnlargedImage();
      }
    };

    // Assign src last
    overlayImg.src = bestImageSource;

    // If image is already loaded, size/position immediately
    if (overlayImg.complete && overlayImg.naturalWidth) {
      applySize(overlayImg.naturalWidth, overlayImg.naturalHeight);
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
      setOverlayLoading(false);
      hoverOverlay.style.visibility = 'visible';
      overlayImg.style.opacity = '1';
      hoverOverlay.style.opacity = '1';
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
    exitLockedZoomMode();
    if (hoverOverlay) {
      const overlayImg = hoverOverlay.querySelector('img');
      if (overlayImg) {
        overlayImg.onload = null;
        overlayImg.onerror = null;
        overlayImg.style.opacity = '0';
      }
      setOverlayLoading(false);
      hoverOverlay.style.display = 'none';
      hoverOverlay.style.visibility = 'hidden';
      hoverOverlay.style.opacity = '0';
    }
    // Also remove any visual indicators
    if (currentImg) {
      hideNoPopupIndicator(currentImg);
    }
    currentImg = null;
    currentTrigger = null;
    if (hoverTimer) {
      clearTimeout(hoverTimer);
      hoverTimer = null;
    }
  }

  // Handle hover when the trigger is a sibling overlay and the real image lives next door
  function handleSiblingImagePatternMouseEnter(event, siblingImg) {
    const trigger = event.target;

    // Do not start new hovers while locked zoom mode is active
    if (lockedZoomMode) return;

    if (!siblingImg || trigger === currentTrigger) {
      return;
    }

    currentImg = siblingImg;
    currentTrigger = trigger;

    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    hoverTimer = setTimeout(async () => {
      if (currentImg === siblingImg && currentTrigger === trigger) {
        const customUrl = await checkCustomRules(siblingImg);

        if (customUrl) {
          showEnlargedImage(
            siblingImg,
            event.clientX,
            event.clientY,
            customUrl
          );
          return;
        }

        // If the sibling image is wrapped by a link pointing to an image, prefer that URL
        const parentAnchor = siblingImg.closest('a');
        const href = parentAnchor?.href || null;
        if (href && isImageURL(href)) {
          const bestFromImg = getBestImageSource(siblingImg);
          if (href !== bestFromImg) {
            showEnlargedImage(siblingImg, event.clientX, event.clientY, href);
            return;
          }
        }

        if (isImageScaledDown(siblingImg)) {
          showEnlargedImage(siblingImg, event.clientX, event.clientY);
        } else {
          showNoPopupIndicator(siblingImg);
        }
      }
    }, HOVER_DELAY);
  }

  // Handle mouse enter on images
  function handleImageMouseEnter(event) {
    const img = event.target;

    // Do not start new hovers while locked zoom mode is active
    if (lockedZoomMode) return;

    // Skip if not an image or same image
    if (img.tagName !== 'IMG' || img === currentImg) {
      return;
    }

    currentImg = img;
    currentTrigger = img;

    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    // Set timer to show enlarged image after delay
    hoverTimer = setTimeout(async () => {
      if (currentImg === img) {
        // First, check if any custom rules match this element
        const customUrl = await checkCustomRules(img);

        if (customUrl) {
          // Custom rule found, show image from custom URL
          showEnlargedImage(img, event.clientX, event.clientY, customUrl);
          return;
        }

        // If the image is wrapped in a link that points to an image URL,
        // prefer the anchor's href as the high-resolution source.
        const parentAnchor = img.closest('a');
        const href = parentAnchor?.href || null;
        if (isRuleEnabled('parent-anchor-image') && href && isImageURL(href)) {
          // Avoid redundant load if href equals current src/best source
          const bestFromImg = getBestImageSource(img);
          if (href !== bestFromImg) {
            console.log(
              '[Built-in Rule: Parent Anchor Image URL] Using anchor href:',
              href
            );
            showEnlargedImage(img, event.clientX, event.clientY, href);
            return;
          }
        }

        if (isImageScaledDown(img)) {
          // No custom rule, but image is scaled down - show enlarged version
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

    // While locked zoom is active, do not hide on mouse leave
    if (lockedZoomMode) return;
    if (img === currentImg) {
      hideEnlargedImage();
    }
  }

  // Handle mouse move to update overlay position
  function handleImageMouseMove(event) {
    // In locked zoom mode, do not reposition the overlay
    if (lockedZoomMode) return;
    if (hoverOverlay && hoverOverlay.style.display === 'block') {
      positionOverlay(hoverOverlay, event.clientX, event.clientY);
    }
  }

  // Helper function to normalize keyboard events to binding format
  function normalizeKeyboardShortcut(event) {
    const modifiers = [];
    if (event.ctrlKey) modifiers.push('Ctrl');
    if (event.altKey) modifiers.push('Alt');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.metaKey) modifiers.push('Meta');

    let key = event.key.toUpperCase();
    // Map special keys
    const specialKeyMap = {
      ARROWUP: 'Up',
      ARROWDOWN: 'Down',
      ARROWLEFT: 'Left',
      ARROWRIGHT: 'Right',
      ENTER: 'Enter',
      ' ': 'Space',
    };
    key = specialKeyMap[key] || key;

    const combo = [...modifiers, key].join('+');
    return { type: 'keyboard', combo };
  }

  // Helper function to check if a binding matches the keyboard event
  function bindingMatchesKeyboardEvent(binding, event) {
    if (!binding || binding.type !== 'keyboard') return false;
    const normalized = normalizeKeyboardShortcut(event);
    return binding.combo === normalized.combo;
  }

  // Helper function to normalize mouse events to binding format
  function normalizeMouseShortcut(event) {
    const MOUSE_BUTTON_LABELS = {
      0: 'MouseLeft',
      1: 'MouseMiddle',
      2: 'MouseRight',
      3: 'MouseBack',
      4: 'MouseForward',
    };

    // Handle wheel events
    if (event.type === 'wheel') {
      const dir = event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
      return { type: 'mouse', combo: dir };
    }

    const buttonLabel =
      MOUSE_BUTTON_LABELS[event.button] || `MouseButton${event.button}`;
    return { type: 'mouse', combo: buttonLabel };
  }

  // Helper function to check if a binding matches the mouse event
  function bindingMatchesMouseEvent(binding, event) {
    if (!binding || binding.type !== 'mouse') return false;
    const normalized = normalizeMouseShortcut(event);
    return binding.combo === normalized.combo;
  }

  // Initialize the extension
  function init() {
    // Inject universal CSS fixes for overlay elements that block image interaction
    injectUniversalFixes();

    // Use event delegation for better performance
    document.addEventListener(
      'mouseenter',
      function (event) {
        const target = event.target;
        if (!(target instanceof Element)) {
          return;
        }

        // Handle IMG elements as before
        if (target.tagName === 'IMG') {
          handleImageMouseEnter(event);
          return;
        }

        // Check if any custom rule matches this element first (before generic handlers)
        if (customRules && customRules.length > 0) {
          for (const rule of customRules) {
            try {
              if (target.matches(rule.selector)) {
                console.log(
                  'Custom rule matched:',
                  rule.name,
                  'for element:',
                  target
                );
                handleCustomElementMouseEnter(event);
                return;
              }
            } catch (e) {
              console.warn('Invalid custom rule selector:', rule.selector, e);
            }
          }
        }

        // IMDb-style pattern: overlay sibling triggers should delegate to the nearby image
        const siblingImage = findSiblingImageCandidate(target);
        if (siblingImage) {
          handleSiblingImagePatternMouseEnter(event, siblingImage);
          return;
        }

        // Handle anchor elements with image URLs (only if no custom rule matched)
        if (target.tagName === 'A') {
          handleAnchorMouseEnter(event);
          return;
        }

        // Check if element has background-image CSS (built-in support)
        // Only check if it's not an IMG, A, or matched by custom rules
        if (getBackgroundImageUrl(target)) {
          handleBackgroundImageMouseEnter(event);
          return;
        }
      },
      true
    );

    document.addEventListener(
      'mouseleave',
      function (event) {
        // Do not hide overlay while locked zoom is active
        if (lockedZoomMode) return;

        if (!(event.target instanceof Element)) {
          return;
        }

        if (event.target.tagName === 'IMG') {
          handleImageMouseLeave(event);
        } else if (
          event.target.tagName === 'A' ||
          event.target === currentImg ||
          event.target === currentTrigger ||
          getBackgroundImageUrl(event.target)
        ) {
          // Handle anchor, custom element, or background-image mouse leave
          hideEnlargedImage();
        }
      },
      true
    );

    document.addEventListener(
      'mousemove',
      function (event) {
        const isActiveTrigger =
          event.target === currentImg || event.target === currentTrigger;
        if (loadingSpinner && loadingSpinner.style.display === 'flex') {
          positionSpinner(event.clientX, event.clientY);
        }
        if (hoverOverlay && hoverOverlay.style.display === 'block') {
          if (isActiveTrigger) {
            positionOverlay(hoverOverlay, event.clientX, event.clientY);
          }
        } else if (
          event.target.tagName === 'IMG' &&
          event.target === currentImg
        ) {
          handleImageMouseMove(event);
        }
      },
      true
    );

    // Hide overlay when scrolling (except in locked zoom mode)
    document.addEventListener(
      'scroll',
      () => {
        if (lockedZoomMode) return;
        hideEnlargedImage();
      },
      true
    );

    document.addEventListener(
      'click',
      event => {
        if (lockedZoomMode) {
          if (hoverOverlay && !hoverOverlay.contains(event.target)) {
            // Click outside image while in locked zoom mode: exit
            exitLockedZoomMode();
          }
          // Clicks inside overlay should not hide or exit
          return;
        }
        hideEnlargedImage();
      },
      true
    );

    document.addEventListener(
      'keydown',
      function (event) {
        const zoomBindings = shortcutBindings.zoomFullResolution || [];
        const isZoomShortcut = zoomBindings.some(b =>
          bindingMatchesKeyboardEvent(b, event)
        );
        if (isZoomShortcut) {
          if (hoverOverlay && hoverOverlay.style.display === 'block') {
            if (lockedZoomMode) {
              exitLockedZoomMode();
            } else {
              enterLockedZoomMode();
            }
            event.preventDefault();
            if (event.stopImmediatePropagation)
              event.stopImmediatePropagation();
            event.stopPropagation();
            return;
          }
        }

        const zoomInBindings = shortcutBindings.zoomIn || [];
        const isZoomInShortcut = zoomInBindings.some(b =>
          bindingMatchesKeyboardEvent(b, event)
        );
        if (isZoomInShortcut) {
          if (
            lockedZoomMode &&
            hoverOverlay &&
            hoverOverlay.style.display === 'block'
          ) {
            zoomIn();
            event.preventDefault();
            if (event.stopImmediatePropagation)
              event.stopImmediatePropagation();
            event.stopPropagation();
            return;
          }
        }

        const zoomOutBindings = shortcutBindings.zoomOut || [];
        const isZoomOutShortcut = zoomOutBindings.some(b =>
          bindingMatchesKeyboardEvent(b, event)
        );
        if (isZoomOutShortcut) {
          if (
            lockedZoomMode &&
            hoverOverlay &&
            hoverOverlay.style.display === 'block'
          ) {
            zoomOut();
            event.preventDefault();
            if (event.stopImmediatePropagation)
              event.stopImmediatePropagation();
            event.stopPropagation();
            return;
          }
        }

        if (event.key === 'Escape') {
          hideEnlargedImage();
        }
      },
      true
    );

    // Locked zoom mode: drag handlers
    document.addEventListener('mousedown', handleLockedZoomMouseDown, true);
    document.addEventListener('mousemove', handleLockedZoomMouseMove, true);
    document.addEventListener('mouseup', handleLockedZoomMouseUp, true);

    // Wheel zoom handlers
    document.addEventListener(
      'wheel',
      function (event) {
        if (
          !lockedZoomMode ||
          !hoverOverlay ||
          hoverOverlay.style.display !== 'block'
        )
          return;

        const zoomInBindings = shortcutBindings.zoomIn || [];
        const isZoomInShortcut = zoomInBindings.some(b =>
          bindingMatchesMouseEvent(b, event)
        );

        const zoomOutBindings = shortcutBindings.zoomOut || [];
        const isZoomOutShortcut = zoomOutBindings.some(b =>
          bindingMatchesMouseEvent(b, event)
        );

        if (isZoomInShortcut) {
          zoomIn();
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        if (isZoomOutShortcut) {
          zoomOut();
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        // Prevent page scrolling during locked zoom mode
        event.preventDefault();
        event.stopPropagation();
      },
      { passive: false, capture: true }
    );

    // Double-click to toggle locked zoom
    document.addEventListener(
      'dblclick',
      event => {
        if (
          lockedZoomMode &&
          hoverOverlay &&
          hoverOverlay.contains(event.target)
        ) {
          exitLockedZoomMode();
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    // Hide overlay when the window loses focus (except in locked zoom mode)
    window.addEventListener('blur', () => {
      if (lockedZoomMode) return;
      hideEnlargedImage();
    });

    // Reposition overlay on window resize to keep it in bounds
    window.addEventListener('resize', function () {
      if (
        hoverOverlay &&
        hoverOverlay.style.display === 'block' &&
        currentImg
      ) {
        if (lockedZoomMode) return;
        // Get current mouse position from the last known position or center of viewport
        const rect = currentImg.getBoundingClientRect();
        const mouseX = rect.left + rect.width / 2;
        const mouseY = rect.top + rect.height / 2;
        positionOverlay(hoverOverlay, mouseX, mouseY);
      }
    });
  }

  // Check if a URL points to an image based on file extension
  function isImageURL(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      // Remove query parameters and hash for extension check
      const urlObj = new URL(url, window.location.href);
      const pathname = urlObj.pathname.toLowerCase();
      const imageExtensions = [
        '.jpg',
        '.jpeg',
        '.png',
        '.gif',
        '.webp',
        '.bmp',
        '.svg',
        '.avif',
        '.jfif',
        '.pjpeg',
        '.pjp',
        '.apng',
      ];
      return imageExtensions.some(ext => pathname.endsWith(ext));
    } catch (e) {
      return false;
    }
  }

  // Handle mouse enter on anchor elements with image URLs
  async function handleAnchorMouseEnter(event) {
    if (!isRuleEnabled('anchor-image-links')) return;

    const anchor = event.target;
    const href = anchor.href;

    // Skip if same element or no href
    if (anchor === currentImg || !href) {
      return;
    }

    // Check if href points to an image
    if (!isImageURL(href)) {
      return;
    }

    console.log(
      '[Built-in Rule: Anchor Image Links] Detected anchor link to image:',
      href
    );

    currentImg = anchor;
    currentTrigger = anchor;

    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    // Set timer to show enlarged image after delay
    hoverTimer = setTimeout(() => {
      if (currentImg === anchor) {
        // Create a temporary img element for the overlay
        const tempImg = document.createElement('img');
        tempImg.src = href;
        showEnlargedImage(tempImg, event.clientX, event.clientY, href);
      }
    }, HOVER_DELAY);
  }

  // Extract URL from background-image CSS property
  function getBackgroundImageUrl(element) {
    if (!(element instanceof Element)) {
      console.warn('Expected an Element, but received:', element);
      return null;
    }

    const style = window.getComputedStyle(element);
    const bgImage = style.backgroundImage;

    if (!bgImage || bgImage === 'none') {
      return null;
    }

    // Extract URL from url("...") or url('...') or url(...)
    const match = bgImage.match(/url\(["']?([^"')]+)["']?\)/);
    if (match && match[1]) {
      // Resolve relative URLs
      try {
        return new URL(match[1], window.location.href).href;
      } catch (e) {
        return match[1];
      }
    }

    return null;
  }

  // Handle mouse enter on elements with background-image
  async function handleBackgroundImageMouseEnter(event) {
    if (!isRuleEnabled('background-image-css')) return;

    const element = event.target;

    // Skip if same element
    if (element === currentImg) {
      return;
    }

    const bgUrl = getBackgroundImageUrl(element);
    if (!bgUrl) {
      return;
    }

    console.log(
      '[Built-in Rule: CSS Background Images] Detected background-image:',
      bgUrl
    );

    currentImg = element;
    currentTrigger = element;

    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    // Set timer to show enlarged image after delay
    hoverTimer = setTimeout(() => {
      if (currentImg === element) {
        // Create a temporary img element for the overlay
        const tempImg = document.createElement('img');
        tempImg.src = bgUrl;
        showEnlargedImage(tempImg, event.clientX, event.clientY, bgUrl);
      }
    }, HOVER_DELAY);
  }

  // Handle mouse enter on custom elements (non-IMG)
  async function handleCustomElementMouseEnter(event) {
    const element = event.target;

    // Skip if same element
    if (element === currentImg) {
      return;
    }

    currentImg = element;

    // Clear any existing timer
    if (hoverTimer) {
      clearTimeout(hoverTimer);
    }

    // Set timer to show enlarged image after delay
    hoverTimer = setTimeout(async () => {
      if (currentImg === element) {
        // Check custom rules for this element
        const customUrl = await checkCustomRules(element);

        if (customUrl) {
          // Create a temporary img element for the overlay
          const tempImg = document.createElement('img');
          tempImg.src = customUrl;
          showEnlargedImage(tempImg, event.clientX, event.clientY, customUrl);
        }
      }
    }, HOVER_DELAY);
  }

  // Inject universal CSS fixes for blocking overlay elements
  function injectUniversalFixes() {
    const style = document.createElement('style');
    style.id = 'imagus-css-fixes';

    let cssRules = [];

    // Instagram overlays
    if (isRuleEnabled('css-fix-instagram')) {
      cssRules.push(`/* Instagram overlays */
      ._aagw {
        pointer-events: none !important;
      }`);
    }

    // Common overlay patterns
    if (isRuleEnabled('css-fix-generic-overlays')) {
      cssRules.push(`/* Common overlay patterns that block image interaction */
      [style*="position: absolute"][style*="inset: 0"]:not(img):not(video):empty {
        pointer-events: none !important;
      }

      /* Additional common patterns for empty overlays */
      div[style*="position: absolute"]:empty,
      div[style*="position: fixed"]:empty {
        pointer-events: none !important;
      }`);
    }

    // Pinterest overlays
    if (isRuleEnabled('css-fix-pinterest')) {
      cssRules.push(`/* Pinterest overlays */
      div[data-test-id*="overlay"]:empty {
        pointer-events: none !important;
      }`);
    }

    // Twitter/X overlays
    if (isRuleEnabled('css-fix-twitter')) {
      cssRules.push(`/* Twitter/X overlays */
      div[data-testid*="overlay"]:empty {
        pointer-events: none !important;
      }`);
    }

    // Facebook/Meta overlays
    if (isRuleEnabled('css-fix-facebook')) {
      cssRules.push(`/* Facebook/Meta overlays */
      div[role="presentation"]:empty {
        pointer-events: none !important;
      }`);
    }

    // Generic overlay class patterns
    if (isRuleEnabled('css-fix-generic-classes')) {
      cssRules.push(`/* Generic overlay class patterns */
      .overlay:empty,
      .image-overlay:empty,
      .hover-overlay:empty,
      .transparent-overlay:empty,
      .block-overlay:empty {
        pointer-events: none !important;
      }`);
    }

    // Tumblr image overlays
    if (isRuleEnabled('css-fix-tumblr')) {
      cssRules.push(`/* Tumblr image overlays */
      .post-content .image-wrapper > div:empty {
        pointer-events: none !important;
      }`);
    }

    // Reddit image overlays
    if (isRuleEnabled('css-fix-reddit')) {
      cssRules.push(`/* Reddit image overlays */
      ._1JmnMJclrTwTPpAip5U_Hm:empty {
        pointer-events: none !important;
      }`);
    }

    // YouTube overlays
    if (isRuleEnabled('css-fix-youtube')) {
      cssRules.push(`/* YouTube overlays that often intercept hover */
      ytd-thumbnail [class*="overlay"],
      ytd-thumbnail-overlay-time-status-renderer,
      ytd-thumbnail-overlay-toggle-button-renderer,
      ytd-thumbnail-overlay-now-playing-renderer {
        pointer-events: none !important;
      }`);
    }

    style.textContent = cssRules.join('\n\n');

    // Insert at the beginning of head to ensure lower specificity doesn't override
    document.head.insertBefore(style, document.head.firstChild);
  }

  // Reapply CSS fixes when settings change
  function reapplyCssFixes() {
    const existing = document.getElementById('imagus-css-fixes');
    if (existing) {
      existing.remove();
    }
    injectUniversalFixes();
  }

  // Message handler for rule testing from options page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'imagus:testRule') return;
    try {
      const rule = msg.rule || {};
      const selector = rule.selector;
      const matches = selector
        ? Array.from(document.querySelectorAll(selector))
        : [];

      function summarize(el) {
        try {
          const tag = el.tagName.toLowerCase();
          const cls = (el.className || '').toString().trim();
          const id = el.id || '';
          const src = el.src || '';
          const href = el.href || '';
          return `${tag}${id ? '#' + id : ''}${
            cls ? '.' + cls.replace(/\s+/g, '.') : ''
          } ${src || href}`.trim();
        } catch (_) {
          return 'element';
        }
      }

      (async () => {
        const results = await Promise.all(
          matches.map(async el => {
            let url = null;
            let error = null;
            try {
              // Execute Custom JavaScript for testing
              if (
                rule.userScript &&
                typeof rule.userScript === 'string' &&
                rule.userScript.trim()
              ) {
                const token =
                  'imagus-trigger-' + Math.random().toString(36).slice(2);
                try {
                  el.setAttribute('data-imagus-trigger', token);
                } catch (_) {}
                const ctx = {
                  selector,
                  src:
                    el.currentSrc || el.src || el.getAttribute?.('src') || null,
                  href:
                    el.href ||
                    el.getAttribute?.('href') ||
                    closestDeep(el, 'a')?.href ||
                    null,
                  variables: {},
                  triggerSelector: `[data-imagus-trigger="${token}"]`,
                };

                const urlFromScript = await new Promise(resolve => {
                  let resolved = false;
                  const onOk = e => {
                    if (resolved) return;
                    resolved = true;
                    document.removeEventListener('imagus:userScriptURL', onOk);
                    document.removeEventListener(
                      'imagus:userScriptError',
                      onErr
                    );
                    resolve(String(e.detail || ''));
                  };
                  const onErr = e => {
                    if (resolved) return;
                    resolved = true;
                    document.removeEventListener('imagus:userScriptURL', onOk);
                    document.removeEventListener(
                      'imagus:userScriptError',
                      onErr
                    );
                    document.removeEventListener(
                      'imagus:userScriptElement',
                      onEl
                    );
                    resolve('');
                  };
                  const onEl = e => {
                    if (resolved) return;
                    resolved = true;
                    document.removeEventListener('imagus:userScriptURL', onOk);
                    document.removeEventListener(
                      'imagus:userScriptError',
                      onErr
                    );
                    document.removeEventListener(
                      'imagus:userScriptElement',
                      onEl
                    );
                    const sel = String(e.detail || '');
                    let derived = '';
                    try {
                      const returned = sel ? document.querySelector(sel) : null;
                      if (returned) {
                        derived = bestSrcFromElement(returned) || '';
                        try {
                          returned.removeAttribute('data-imagus-return');
                        } catch (_) {}
                      }
                    } catch (_) {}
                    resolve(derived);
                  };
                  document.addEventListener('imagus:userScriptURL', onOk, {
                    once: true,
                  });
                  document.addEventListener('imagus:userScriptError', onErr, {
                    once: true,
                  });
                  document.addEventListener('imagus:userScriptElement', onEl, {
                    once: true,
                  });
                  chrome.runtime.sendMessage({
                    type: 'imagus:execUserScript',
                    code: rule.userScript,
                    ctx,
                  });
                  setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    document.removeEventListener('imagus:userScriptURL', onOk);
                    document.removeEventListener(
                      'imagus:userScriptError',
                      onErr
                    );
                    document.removeEventListener(
                      'imagus:userScriptElement',
                      onEl
                    );
                    try {
                      el.removeAttribute('data-imagus-trigger');
                    } catch (_) {}
                    resolve('');
                  }, 3000);
                });

                if (urlFromScript) {
                  if (/^https?:\/\//i.test(urlFromScript)) {
                    url = urlFromScript;
                    try {
                      el.removeAttribute('data-imagus-trigger');
                    } catch (_) {}
                  } else if (!urlFromScript.includes('{')) {
                    url = urlFromScript;
                    try {
                      el.removeAttribute('data-imagus-trigger');
                    } catch (_) {}
                  }
                }
                // Clean up attribute if script didn't yield usable URL
                try {
                  el.removeAttribute('data-imagus-trigger');
                } catch (_) {}
              }
            } catch (e) {
              error = e.message || String(e);
            }
            return {
              url,
              variables: {},
              error,
              elementSummary: summarize(el),
            };
          })
        );
        sendResponse({ ok: true, count: matches.length, results });
      })().catch(e => {
        sendResponse({ ok: false, error: e.message || String(e) });
      });
    } catch (e) {
      sendResponse({ ok: false, error: e.message || String(e) });
    }
    return true; // async
  });

  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
