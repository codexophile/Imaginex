(function () {
  'use strict';

  let hoverOverlay = null;
  let currentImg = null;
  let currentTrigger = null;
  let hoverTimer = null;
  let noPopupTooltip = null;
  let HOVER_DELAY = 300; // default; will be overridden by settings
  let ENABLE_ANIMATIONS = true; // default; will be overridden by settings
  let customRules = []; // Custom rules for finding higher-quality images
  let builtInRules = new Map(); // Built-in rules (id -> enabled state)

  const SETTINGS_INTERNAL_KEY = '__settings_v1';

  function applySettingsFromStorage(raw) {
    if (!raw || typeof raw !== 'object') return;
    if (typeof raw.hoverDelay === 'number') HOVER_DELAY = raw.hoverDelay;
    if (typeof raw.enableAnimations === 'boolean') {
      ENABLE_ANIMATIONS = raw.enableAnimations;
      applyAnimationSettings();
    }
    if (Array.isArray(raw.customRules)) {
      customRules = raw.customRules.filter(r => r && r.enabled);
      console.log('Loaded custom rules:', customRules.length, customRules);
    }
    if (Array.isArray(raw.builtInRules)) {
      builtInRules = new Map(raw.builtInRules.map(r => [r.id, r.enabled]));
      console.log('Loaded built-in rules:', builtInRules.size, 'rules');
      // Reapply CSS fixes when built-in rules change
      reapplyCssFixes();
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

  // Check if a built-in rule is enabled
  function isRuleEnabled(ruleId) {
    return builtInRules.get(ruleId) !== false; // default true if not found
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
            variables: variables,
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

        // If rule has API config, fetch from external API
        if (rule.api && rule.api.url) {
          try {
            // Check if extension context is still valid before making message calls
            if (!chrome?.runtime?.sendMessage) {
              console.warn('Extension context invalidated, skipping API fetch');
              continue;
            }

            // Load settings to get API keys
            const settingsData = await new Promise((resolve, reject) => {
              try {
                chrome.storage.local.get([SETTINGS_INTERNAL_KEY], result => {
                  resolve(result[SETTINGS_INTERNAL_KEY] || {});
                });
              } catch (err) {
                reject(err);
              }
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
            // Check if error is due to extension context invalidation
            if (
              err?.message?.includes('Extension context invalidated') ||
              err?.message?.includes('sendMessage') ||
              !chrome?.runtime?.sendMessage
            ) {
              console.warn('Extension context lost, skipping API fetch:', err);
              continue;
            }
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

    // Set a reasonable size immediately, position, then refine after load
    applySize(bestDimensions?.width || 0, bestDimensions?.height || 0);
    // Avoid initial flicker: render hidden and position before showing
    hoverOverlay.style.opacity = '0';
    hoverOverlay.style.display = 'block';
    positionOverlay(hoverOverlay, mouseX, mouseY);

    // Handlers must be set before src assignment (cached images can load very fast)
    overlayImg.onload = () => {
      delete overlayImg.dataset.hasFallbackAttempt;
      applySize(overlayImg.naturalWidth, overlayImg.naturalHeight);
      hoverOverlay.offsetHeight;
      positionOverlay(hoverOverlay, mouseX, mouseY);
      // Reveal after image has loaded and overlay is sized/positioned
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
    if (hoverOverlay) {
      hoverOverlay.style.display = 'none';
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

      (async () => {
        const results = await Promise.all(
          matches.map(async el => {
            let variables = {};
            let url = null;
            let unresolvedPlaceholders = false;
            let error = null;
            try {
              variables = extractVariables(el, { urlTemplate, extract });
              if (!url && urlTemplate) {
                url = applyTemplate(urlTemplate, variables);
                unresolvedPlaceholders = url ? url.includes('{') : false;
              }

              // Try Custom JavaScript if no usable URL yet
              if (
                (!url || unresolvedPlaceholders) &&
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
                  variables,
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
                    unresolvedPlaceholders = false;
                    try {
                      el.removeAttribute('data-imagus-trigger');
                    } catch (_) {}
                  } else if (!urlFromScript.includes('{')) {
                    url = urlFromScript;
                    unresolvedPlaceholders = false;
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

              // Try API if still no usable URL and API provided
              if (
                (!url || unresolvedPlaceholders) &&
                rule.api &&
                rule.api.url
              ) {
                const settingsData = await new Promise(resolve => {
                  chrome.storage.local.get([SETTINGS_INTERNAL_KEY], result => {
                    resolve(result[SETTINGS_INTERNAL_KEY] || {});
                  });
                });
                const apiKeys = settingsData.apiKeys || {};
                const substituteVars = str =>
                  String(str).replace(/\{([^}]+)\}/g, (m, key) => {
                    if (key.startsWith('settings.')) {
                      const settingKey = key.slice(9);
                      return apiKeys[settingKey] || m;
                    }
                    if (Object.prototype.hasOwnProperty.call(variables, key)) {
                      return variables[key];
                    }
                    return m;
                  });

                const apiUrl = substituteVars(rule.api.url);
                const headers = {};
                if (rule.api.headers) {
                  for (const [k, v] of Object.entries(rule.api.headers)) {
                    headers[k] = substituteVars(v);
                  }
                }
                const response = await chrome.runtime.sendMessage({
                  type: 'imagus:fetchApi',
                  url: apiUrl,
                  path: rule.api.path || null,
                  headers,
                });
                if (response && response.ok) {
                  const apiUrlResult = String(response.data);
                  if (apiUrlResult && !apiUrlResult.includes('{')) {
                    url = apiUrlResult;
                    unresolvedPlaceholders = false;
                  }
                }
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
