(function () {
  'use strict';

  let hoverOverlay = null;
  let currentImg = null;
  let hoverTimer = null;
  let noPopupTooltip = null;
  let HOVER_DELAY = 300; // default; will be overridden by settings
  let customRules = []; // Custom rules for finding higher-quality images

  const SETTINGS_INTERNAL_KEY = '__settings_v1';

  function applySettingsFromStorage(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.hoverDelay === 'number') HOVER_DELAY = raw.hoverDelay;
    if (Array.isArray(raw.customRules)) {
      customRules = raw.customRules.filter(r => r && r.enabled);
    }
  }

  // Load settings directly from storage (MV3 content scripts can't reliably dynamic-import extension modules)
  chrome.storage.local.get([SETTINGS_INTERNAL_KEY], result => {
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

  function getSourceValue(element, source) {
    if (!source || !source.type) return null;
    try {
      switch (source.type) {
        case 'src':
          return (
            element.currentSrc ||
            element.src ||
            element.getAttribute?.('src') ||
            null
          );
        case 'href': {
          return (
            element.href ||
            element.getAttribute?.('href') ||
            closestDeep(element, 'a')?.href ||
            null
          );
        }
        case 'attr':
          return source.name
            ? element.getAttribute?.(source.name) || null
            : null;
        case 'closestAttr': {
          if (!source.selector || !source.name) return null;
          const closest = closestDeep(element, source.selector);
          if (!closest) return null;
          return (
            closest.getAttribute?.(source.name) || closest[source.name] || null
          );
        }
        case 'closestQueryAttr': {
          // Find closest ancestor, then querySelector within it, then read attribute/property.
          // Useful for extracting from sibling structures like: <a ...></a> next to <picture>...</picture>
          if (!source.closest || !source.selector || !source.name) return null;
          const root = closestDeep(element, source.closest);
          if (!root) return null;
          const target = root.querySelector?.(source.selector);
          if (!target) return null;
          return (
            target.getAttribute?.(source.name) || target[source.name] || null
          );
        }
        case 'cssQueryAttr': {
          // Query within the matched element, then read attribute/property.
          if (!source.selector || !source.name) return null;
          const root = source.closest
            ? closestDeep(element, source.closest)
            : element;
          const target = root?.querySelector?.(source.selector);
          if (!target) return null;
          return (
            target.getAttribute?.(source.name) || target[source.name] || null
          );
        }
        case 'xpath': {
          if (!source.expr) return null;
          if (typeof document === 'undefined' || !document.evaluate)
            return null;
          const expr = String(source.expr);
          // Evaluate relative to the matched element.
          const result = document.evaluate(
            expr,
            element,
            null,
            XPathResult.STRING_TYPE,
            null
          );
          return result ? result.stringValue || null : null;
        }
        default:
          return null;
      }
    } catch (_) {
      return null;
    }
  }

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

  function extractVariables(element, rule) {
    const variables = {};

    // Built-in placeholders
    variables.src =
      element.currentSrc || element.src || element.getAttribute?.('src') || '';
    variables.href =
      element.closest?.('a')?.href ||
      element.href ||
      element.getAttribute?.('href') ||
      '';

    // CSP-safe extraction rules
    const extract = rule && rule.extract;
    if (Array.isArray(extract)) {
      for (const ex of extract) {
        if (!ex || !ex.var || !ex.regex) continue;
        const sources =
          Array.isArray(ex.sources) && ex.sources.length
            ? ex.sources
            : [{ type: 'src' }, { type: 'href' }];
        let re;
        try {
          re = new RegExp(ex.regex, ex.flags || undefined);
        } catch (_) {
          continue;
        }
        for (const source of sources) {
          const value = getSourceValue(element, source);
          if (!value) continue;
          const m = String(value).match(re);
          if (m) {
            let v = m[1] ?? m[0];
            if (ex.mode === 'srcsetBest') {
              v = pickBestFromSrcsetString(v) ?? v;
            }
            variables[ex.var] = v;
            break;
          }
        }
      }
    }

    // Back-compat: if no extractor provided and this looks like YouTube, try to extract videoId
    if (!variables.videoId && typeof rule?.urlTemplate === 'string') {
      const t = rule.urlTemplate;
      const looksYouTube =
        t.includes('i.ytimg.com') &&
        (t.includes('{videoId}') || t.includes('{videoid}'));
      if (looksYouTube) {
        const src = variables.src || '';
        const href = variables.href || '';
        const m =
          src.match(/\/vi(?:_webp)?\/([^\/]+)/) ||
          href.match(/[?&]v=([^&]+)/) ||
          href.match(/\/shorts\/([^?\/]+)/);
        if (m) variables.videoId = m[1];
      }
    }

    return variables;
  }

  function applyTemplate(template, variables) {
    if (!template) return null;
    const url = String(template).replace(/\{([^}]+)\}/g, (m, key) => {
      if (Object.prototype.hasOwnProperty.call(variables, key)) {
        return variables[key];
      }
      return m;
    });
    return url;
  }

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

        if (rule.customJS) {
          console.warn(
            'Custom JS is not supported in MV3 (CSP blocks unsafe-eval). Use rule.extract instead.',
            rule.name
          );
        }

        const variables = extractVariables(element, rule);

        // If rule has API config, fetch from external API
        if (rule.api && rule.api.url) {
          try {
            // Load settings to get API keys
            const settingsData = await new Promise(resolve => {
              chrome.storage.local.get([SETTINGS_INTERNAL_KEY], result => {
                resolve(result[SETTINGS_INTERNAL_KEY] || {});
              });
            });
            const apiKeys = settingsData.apiKeys || {};

            // Substitute variables and settings in API URL and headers
            const substituteVars = str => {
              return String(str).replace(/\{([^}]+)\}/g, (m, key) => {
                if (key.startsWith('settings.')) {
                  const settingKey = key.slice(9);
                  return apiKeys[settingKey] || m;
                }
                if (Object.prototype.hasOwnProperty.call(variables, key)) {
                  return variables[key];
                }
                return m;
              });
            };

            const apiUrl = substituteVars(rule.api.url);
            if (apiUrl.includes('{')) {
              console.warn('Unresolved placeholders in API URL:', apiUrl);
              continue;
            }

            const headers = {};
            if (rule.api.headers) {
              for (const [k, v] of Object.entries(rule.api.headers)) {
                headers[k] = substituteVars(v);
              }
            }

            console.log('Fetching from API:', apiUrl);
            const response = await chrome.runtime.sendMessage({
              type: 'imagus:fetchApi',
              url: apiUrl,
              path: rule.api.path || null,
              headers,
            });

            if (response && response.ok) {
              const url = String(response.data);
              if (url && !url.includes('{')) {
                console.log('API returned URL:', url);
                return url;
              }
            } else {
              console.warn(
                'API fetch failed:',
                response?.error || 'Unknown error'
              );
            }
          } catch (err) {
            console.error('Error fetching from API:', err);
          }
        }

        if (rule.urlTemplate) {
          const url = applyTemplate(rule.urlTemplate, variables);

          if (url && url.includes('{')) {
            console.warn('Not all placeholders replaced in URL template:', url);
            continue;
          }

          if (url) {
            console.log('Custom rule generated URL:', url);
            return url;
          }
        }
      } catch (error) {
        console.error('Error checking custom rule:', rule.name, error);
      }
    }

    return null;
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
  function showEnlargedImage(img, mouseX, mouseY, customUrl = null) {
    if (!hoverOverlay) {
      hoverOverlay = createOverlay();
    }

    const overlayImg = hoverOverlay.querySelector('img');
    const bestImageSource = customUrl || getBestImageSource(img);
    const bestDimensions = customUrl ? null : getBestImageDimensions(img);

    overlayImg.alt = img.alt || '';

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

    // Set a reasonable size immediately, then refine after load
    applySize(bestDimensions?.width || 0, bestDimensions?.height || 0);
    hoverOverlay.style.display = 'block';

    // Handlers must be set before src assignment (cached images can load very fast)
    overlayImg.onload = () => {
      delete overlayImg.dataset.hasFallbackAttempt;
      applySize(overlayImg.naturalWidth, overlayImg.naturalHeight);
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
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
    hoverTimer = setTimeout(async () => {
      if (currentImg === img) {
        // First, check if any custom rules match this element
        const customUrl = await checkCustomRules(img);

        if (customUrl) {
          // Custom rule found, show image from custom URL
          showEnlargedImage(img, event.clientX, event.clientY, customUrl);
        } else if (isImageScaledDown(img)) {
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
        const target = event.target;

        // Handle IMG elements as before
        if (target.tagName === 'IMG') {
          handleImageMouseEnter(event);
          return;
        }

        // Handle anchor elements with image URLs
        if (target.tagName === 'A') {
          handleAnchorMouseEnter(event);
          return;
        }

        // Check if any custom rule matches this element (for non-IMG elements)
        if (customRules && customRules.length > 0) {
          for (const rule of customRules) {
            try {
              if (target.matches(rule.selector)) {
                handleCustomElementMouseEnter(event);
                break;
              }
            } catch (e) {
              // Invalid selector, ignore
            }
          }
        }
      },
      true
    );

    document.addEventListener(
      'mouseleave',
      function (event) {
        if (event.target.tagName === 'IMG') {
          handleImageMouseLeave(event);
        } else if (
          event.target.tagName === 'A' ||
          event.target === currentImg
        ) {
          // Handle anchor or custom element mouse leave
          hideEnlargedImage();
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

    currentImg = anchor;

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

      /* YouTube overlays that often intercept hover */
      ytd-thumbnail [class*="overlay"],
      ytd-thumbnail-overlay-time-status-renderer,
      ytd-thumbnail-overlay-toggle-button-renderer,
      ytd-thumbnail-overlay-now-playing-renderer {
        pointer-events: none !important;
      }
    `;

    // Insert at the beginning of head to ensure lower specificity doesn't override
    document.head.insertBefore(style, document.head.firstChild);
  }

  // Message handler for rule testing from options page
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== 'imagus:testRule') return;
    try {
      const rule = msg.rule || {};
      const selector = rule.selector;
      const urlTemplate = rule.urlTemplate || '';
      const extract = rule.extract;
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

      const results = matches.map(el => {
        let variables = {};
        let url = null;
        let unresolvedPlaceholders = false;
        let error = null;
        try {
          variables = extractVariables(el, { urlTemplate, extract });
          if (!url && urlTemplate) {
            url = applyTemplate(urlTemplate, variables);
            unresolvedPlaceholders = /\{[^}]+\}/.test(url);
          }
        } catch (e) {
          error = e.message || String(e);
        }
        return {
          url,
          variables,
          unresolvedPlaceholders,
          error,
          elementSummary: summarize(el),
        };
      });

      sendResponse({ ok: true, count: matches.length, results });
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
