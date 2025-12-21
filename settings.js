// settings.js
// Central settings module with local cache and hooks for future cloud sync

const SHORTCUT_DEFAULTS = Object.freeze({
  zoomFullResolution: [null, null],
});

const SETTINGS_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  theme: 'light', // UI theme for future options page styling
  zoom: 1.0, // Placeholder for potential scaling of enlarged image
  enablePrefetch: true, // Future optimization: prefetch high-res images on hover intent
  enableAnimations: true, // Enable/disable image animations and transitions
  hoverDelay: 300, // Delay before showing enlarged image (ms)
  shortcuts: SHORTCUT_DEFAULTS,
  apiKeys: {}, // User-defined API keys for rules that fetch from external APIs
  builtInRules: [
    // Element Detection Patterns
    {
      id: 'sibling-image-pattern',
      name: 'Sibling Image Pattern',
      enabled: true,
      category: 'detection',
      description:
        'Detects overlay elements (like IMDb posters) and finds the adjacent image to display',
    },
    {
      id: 'parent-anchor-image',
      name: 'Parent Anchor Image URL',
      enabled: true,
      category: 'detection',
      description:
        'When an image is wrapped in a link pointing to an image, prefer the link target',
    },
    {
      id: 'anchor-image-links',
      name: 'Anchor Image Links',
      enabled: true,
      category: 'detection',
      description:
        'Show images when hovering over links that point directly to image files',
    },
    {
      id: 'background-image-css',
      name: 'CSS Background Images',
      enabled: true,
      category: 'detection',
      description:
        'Display background-image CSS properties as enlargeable images',
    },

    // CSS Pointer-Events Fixes (Site-Specific)
    {
      id: 'css-fix-instagram',
      name: 'Instagram Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description:
        'Disable pointer-events on Instagram overlay elements that block image interaction',
    },
    {
      id: 'css-fix-youtube',
      name: 'YouTube Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description:
        'Disable pointer-events on YouTube thumbnail overlays that intercept hover',
    },
    {
      id: 'css-fix-pinterest',
      name: 'Pinterest Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description: 'Disable pointer-events on Pinterest overlay elements',
    },
    {
      id: 'css-fix-twitter',
      name: 'Twitter/X Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description: 'Disable pointer-events on Twitter/X overlay elements',
    },
    {
      id: 'css-fix-facebook',
      name: 'Facebook/Meta Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description:
        'Disable pointer-events on Facebook/Meta presentation overlays',
    },
    {
      id: 'css-fix-reddit',
      name: 'Reddit Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description: 'Disable pointer-events on Reddit image overlays',
    },
    {
      id: 'css-fix-tumblr',
      name: 'Tumblr Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      description: 'Disable pointer-events on Tumblr image wrapper overlays',
    },
    {
      id: 'css-fix-generic-overlays',
      name: 'Generic Overlay Patterns',
      enabled: true,
      category: 'css-fixes',
      description:
        'Disable pointer-events on common overlay patterns (empty positioned elements)',
    },
    {
      id: 'css-fix-generic-classes',
      name: 'Generic Overlay Classes',
      enabled: true,
      category: 'css-fixes',
      description:
        'Disable pointer-events on elements with common overlay class names',
    },
  ],
  customRules: [
    // Custom rules for finding higher-quality images
    {
      id: 'youtube-thumbnails',
      name: 'YouTube Video Thumbnails',
      enabled: true,
      selector: 'a#thumbnail img[src*="i.ytimg.com"]',
      urlTemplate: 'https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp',
      extract: [
        {
          var: 'videoId',
          regex: '\\/vi(?:_webp)?\\/([^\\/]+)',
          sources: [{ type: 'src' }],
        },
        {
          var: 'videoId',
          regex: '[?&]v=([^&]+)',
          sources: [{ type: 'href' }],
        },
        {
          var: 'videoId',
          regex: '\\/(?:shorts|embed)\\/([^?\\/]+)',
          sources: [{ type: 'href' }],
        },
      ],
    },
  ],
});

const INTERNAL_KEY = '__settings_v1';
let inMemory = null;
let subscribers = new Set();
let loadPromise = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function ensureDefaults(data) {
  if (!data || typeof data !== 'object') return deepClone(SETTINGS_DEFAULTS);
  const merged = { ...SETTINGS_DEFAULTS, ...data };
  // Preserve schemaVersion from defaults if missing
  if (!merged.schemaVersion)
    merged.schemaVersion = SETTINGS_DEFAULTS.schemaVersion;
  merged.shortcuts = mergeShortcuts(merged.shortcuts);
  // Ensure builtInRules array exists and merge with user preferences
  if (!Array.isArray(merged.builtInRules)) {
    merged.builtInRules = deepClone(SETTINGS_DEFAULTS.builtInRules);
  } else {
    // Merge user preferences with defaults (keep user enabled/disabled state)
    const userPrefs = new Map(merged.builtInRules.map(r => [r.id, r.enabled]));
    merged.builtInRules = SETTINGS_DEFAULTS.builtInRules.map(defaultRule => {
      const enabled = userPrefs.has(defaultRule.id)
        ? userPrefs.get(defaultRule.id)
        : defaultRule.enabled;
      return { ...defaultRule, enabled };
    });
  }
  return merged;
}

function persist(settings) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [INTERNAL_KEY]: settings }, () => resolve());
  });
}

async function loadInternal() {
  if (loadPromise) return loadPromise;
  loadPromise = new Promise(resolve => {
    chrome.storage.local.get([INTERNAL_KEY], result => {
      const raw = result[INTERNAL_KEY];
      inMemory = ensureDefaults(raw);
      resolve(inMemory);
    });
  });
  return loadPromise;
}

export async function loadSettings() {
  await loadInternal();
  return deepClone(inMemory);
}

export async function getSetting(key) {
  await loadInternal();
  return inMemory[key];
}

export async function updateSettings(patch) {
  await loadInternal();
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (inMemory[k] !== v) {
      inMemory[k] = v;
      changed = true;
    }
  }
  if (changed) {
    await persist(inMemory);
    notify();
  }
  return deepClone(inMemory);
}

export function subscribe(callback) {
  subscribers.add(callback);
  if (inMemory) callback(deepClone(inMemory));
  return () => subscribers.delete(callback);
}

function notify() {
  const snapshot = deepClone(inMemory);
  subscribers.forEach(cb => {
    try {
      cb(snapshot);
    } catch (e) {
      console.warn('Settings subscriber error', e);
    }
  });
}

function normalizeBinding(binding) {
  if (!binding || typeof binding !== 'object') return null;
  const type = binding.type === 'mouse' ? 'mouse' : 'keyboard';
  const combo = typeof binding.combo === 'string' && binding.combo.trim();
  if (!combo) return null;
  return { type, combo };
}

function mergeShortcuts(raw) {
  const base = deepClone(SHORTCUT_DEFAULTS);
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value)) {
        base[key] = [
          normalizeBinding(value[0]) || null,
          normalizeBinding(value[1]) || null,
        ];
      }
    }
  }
  return base;
}

// Listen for external changes (e.g., another extension page updating settings)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[INTERNAL_KEY]) {
    inMemory = ensureDefaults(changes[INTERNAL_KEY].newValue);
    notify();
  }
});

// Future Cloud Sync Hook (placeholder)
// export async function syncToCloud() { /* implement Firestore push */ }
// export async function syncFromCloud() { /* implement Firestore pull */ }
