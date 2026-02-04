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
      allowDomains: ['instagram.com', '*.instagram.com'],
      excludeDomains: [],
      description:
        'Disable pointer-events on Instagram overlay elements that block image interaction',
    },
    {
      id: 'css-fix-youtube',
      name: 'YouTube Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: ['youtube.com', '*.youtube.com', 'youtu.be'],
      excludeDomains: [],
      description:
        'Disable pointer-events on YouTube thumbnail overlays that intercept hover',
    },
    {
      id: 'css-fix-pinterest',
      name: 'Pinterest Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: ['pinterest.com', '*.pinterest.com'],
      excludeDomains: [],
      description: 'Disable pointer-events on Pinterest overlay elements',
    },
    {
      id: 'css-fix-twitter',
      name: 'Twitter/X Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: ['twitter.com', '*.twitter.com', 'x.com', '*.x.com'],
      excludeDomains: [],
      description: 'Disable pointer-events on Twitter/X overlay elements',
    },
    {
      id: 'css-fix-facebook',
      name: 'Facebook/Meta Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: [
        'facebook.com',
        '*.facebook.com',
        'meta.com',
        '*.meta.com',
      ],
      excludeDomains: [],
      description:
        'Disable pointer-events on Facebook/Meta presentation overlays',
    },
    {
      id: 'css-fix-reddit',
      name: 'Reddit Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: ['reddit.com', '*.reddit.com'],
      excludeDomains: [],
      description: 'Disable pointer-events on Reddit image overlays',
    },
    {
      id: 'css-fix-tumblr',
      name: 'Tumblr Overlay Fix',
      enabled: true,
      category: 'css-fixes',
      allowDomains: ['tumblr.com', '*.tumblr.com'],
      excludeDomains: [],
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
      selector:
        ':is(yt-thumbnail-view-model, ytd-notification-renderer, ytd-rich-grid-media) img',
      allowDomains: ['youtube.com', '*.youtube.com', 'youtu.be'],
      excludeDomains: [],
      userScript: `/* globals ctx, trigger, returnURL */\n(() => {\n  const src = ctx.src || '';// image src\n  const href = ctx.href || trigger?.closest?.('a')?.href || '';// parent anchor\n  const findId = s => {\n    if (!s) return '';\n    const m =\n      s.match(/\\/(?:vi|vi_webp)\\/([A-Za-z0-9_-]{11})/) ||\n      s.match(/[?&]v=([A-Za-z0-9_-]{11})/) ||\n      s.match(/\\/(?:shorts|embed)\\/([A-Za-z0-9_-]{11})/);\n    return m ? m[1] : '';\n  };\n  const videoId = findId(src) || findId(href);\n  if (!videoId) return;\n  returnURL('https://i.ytimg.com/vi/' + videoId + '/maxresdefault.jpg');\n})();`,
    },
  ],
});

const META_DEFAULTS = Object.freeze({
  fields: {}, // per-field updatedAt
  apiKeys: {}, // per key name updatedAt
  customRules: {}, // per rule id updatedAt
  builtInRules: {}, // per rule id updatedAt
  shortcuts: 0, // timestamp for shortcuts object
});

const INTERNAL_KEY = '__settings_v1';
const DELETION_MARKER = 0; // Mark deleted items in meta so they don't get re-added from cloud
let inMemory = null;
let subscribers = new Set();
let loadPromise = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function nowTs() {
  return Date.now();
}

function pickNewer({ localValue, cloudValue, localTs, cloudTs }) {
  // If deleted locally (marker = 0), keep it deleted regardless of cloud
  if (localTs === DELETION_MARKER) return undefined;
  if (cloudTs && (!localTs || cloudTs > localTs)) return cloudValue;
  if (localTs && (!cloudTs || localTs > cloudTs)) return localValue;
  if (typeof localValue === 'undefined' && typeof cloudValue !== 'undefined')
    return cloudValue;
  return localValue;
}

function mergeKeyed({
  localMap,
  cloudMap,
  localMeta = {},
  cloudMeta = {},
  valuePicker,
}) {
  const result = { ...(localMap || {}) };
  const meta = { ...(localMeta || {}) };
  const keys = new Set([
    ...Object.keys(localMap || {}),
    ...Object.keys(cloudMap || {}),
  ]);
  keys.forEach(key => {
    const localValue = localMap?.[key];
    const cloudValue = cloudMap?.[key];
    const localTs = localMeta?.[key];
    const cloudTs = cloudMeta?.[key];
    const picked = valuePicker({
      localValue,
      cloudValue,
      localTs,
      cloudTs,
      key,
    });
    if (typeof picked === 'undefined') {
      delete result[key];
      delete meta[key];
      return;
    }
    result[key] = picked;
    if (cloudTs && (!localTs || cloudTs > localTs)) {
      meta[key] = cloudTs;
    } else if (localTs) {
      meta[key] = localTs;
    } else {
      meta[key] = nowTs();
    }
  });
  return { result, meta };
}

function ensureDefaults(data) {
  if (!data || typeof data !== 'object') {
    const defaults = deepClone(SETTINGS_DEFAULTS);
    defaults.meta = deepClone(META_DEFAULTS);
    return defaults;
  }
  const merged = { ...SETTINGS_DEFAULTS, ...data };
  merged.meta = deepClone({ ...META_DEFAULTS, ...(data.meta || {}) });
  // Preserve schemaVersion from defaults if missing
  if (!merged.schemaVersion)
    merged.schemaVersion = SETTINGS_DEFAULTS.schemaVersion;
  merged.shortcuts = mergeShortcuts(merged.shortcuts);
  // Ensure builtInRules array exists and merge with user preferences
  if (!Array.isArray(merged.builtInRules)) {
    merged.builtInRules = deepClone(SETTINGS_DEFAULTS.builtInRules);
  } else {
    // Merge user preferences with defaults while preserving user-edited fields
    // (e.g., allowDomains/excludeDomains) and the enabled state.
    const userRuleMap = new Map(merged.builtInRules.map(r => [r.id, r]));
    merged.builtInRules = SETTINGS_DEFAULTS.builtInRules.map(defaultRule => {
      const userRule = userRuleMap.get(defaultRule.id);
      if (userRule) {
        const mergedRule = { ...defaultRule, ...userRule };
        // Ensure canonical metadata from defaults remains intact
        mergedRule.id = defaultRule.id;
        mergedRule.name = defaultRule.name;
        mergedRule.category = defaultRule.category;
        mergedRule.description = defaultRule.description;
        if (typeof userRule.enabled === 'undefined') {
          mergedRule.enabled = defaultRule.enabled;
        }
        return mergedRule;
      }
      return { ...defaultRule };
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
  inMemory.meta = inMemory.meta || deepClone(META_DEFAULTS);
  const meta = inMemory.meta;
  meta.fields = meta.fields || {};
  meta.apiKeys = meta.apiKeys || {};
  meta.customRules = meta.customRules || {};
  meta.builtInRules = meta.builtInRules || {};
  let changed = false;
  const fieldKeys = new Set([
    'theme',
    'zoom',
    'enablePrefetch',
    'enableAnimations',
    'hoverDelay',
    'schemaVersion',
  ]);
  for (const [k, v] of Object.entries(patch)) {
    if (fieldKeys.has(k)) {
      if (inMemory[k] !== v) {
        inMemory[k] = v;
        meta.fields[k] = nowTs();
        changed = true;
      }
      continue;
    }

    if (k === 'apiKeys' && v && typeof v === 'object') {
      const prev = inMemory.apiKeys || {};
      const next = { ...v };
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      let localChange = false;
      keys.forEach(key => {
        if (prev[key] !== next[key]) {
          meta.apiKeys[key] = nowTs();
          localChange = true;
        }
        if (!next.hasOwnProperty(key) && prev.hasOwnProperty(key)) {
          // Mark deletions so cloud won't re-add
          meta.apiKeys[key] = DELETION_MARKER;
        }
      });
      if (localChange) {
        inMemory.apiKeys = next;
        changed = true;
      }
      continue;
    }

    if (k === 'customRules' && Array.isArray(v)) {
      const prevMap = new Map((inMemory.customRules || []).map(r => [r.id, r]));
      const nextMap = new Map(v.map(r => [r.id, r]));
      let localChange = false;
      // Detect additions/updates
      for (const [id, rule] of nextMap.entries()) {
        const prevRule = prevMap.get(id);
        if (!prevRule || JSON.stringify(prevRule) !== JSON.stringify(rule)) {
          meta.customRules[id] = nowTs();
          localChange = true;
        }
      }
      // Detect removals - mark as deleted so cloud sync won't re-add them
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) {
          meta.customRules[id] = DELETION_MARKER;
          localChange = true;
        }
      }
      if (localChange) {
        inMemory.customRules = v;
        changed = true;
      }
      continue;
    }

    if (k === 'builtInRules' && Array.isArray(v)) {
      const prevMap = new Map(
        (inMemory.builtInRules || []).map(r => [r.id, r])
      );
      const nextMap = new Map(v.map(r => [r.id, r]));
      let localChange = false;
      for (const [id, rule] of nextMap.entries()) {
        const prevRule = prevMap.get(id);
        if (!prevRule || JSON.stringify(prevRule) !== JSON.stringify(rule)) {
          meta.builtInRules[id] = nowTs();
          localChange = true;
        }
      }
      for (const id of prevMap.keys()) {
        if (!nextMap.has(id)) {
          meta.builtInRules[id] = DELETION_MARKER;
          localChange = true;
        }
      }
      if (localChange) {
        inMemory.builtInRules = v;
        changed = true;
      }
      continue;
    }

    if (k === 'shortcuts' && v && typeof v === 'object') {
      const normalized = mergeShortcuts(v);
      if (JSON.stringify(inMemory.shortcuts) !== JSON.stringify(normalized)) {
        inMemory.shortcuts = normalized;
        meta.shortcuts = nowTs();
        changed = true;
      }
      continue;
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

// Merge cloud settings into local without full replacement
export async function mergeCloudSettings(cloudSettings) {
  await loadInternal();
  const local = deepClone(inMemory);
  const cloud = cloudSettings || {};
  const localMeta = local.meta || deepClone(META_DEFAULTS);
  const cloudMeta = cloud.meta || deepClone(META_DEFAULTS);
  const mergedMeta = deepClone(META_DEFAULTS);

  // Merge primitive fields with last-write-wins
  const fieldKeys = [
    'theme',
    'zoom',
    'enablePrefetch',
    'enableAnimations',
    'hoverDelay',
    'schemaVersion',
  ];
  mergedMeta.fields = {};
  fieldKeys.forEach(key => {
    const chosen = pickNewer({
      localValue: local[key],
      cloudValue: cloud[key],
      localTs: localMeta.fields?.[key],
      cloudTs: cloudMeta.fields?.[key],
    });
    local[key] = chosen;
    mergedMeta.fields[key] =
      chosen === cloud[key]
        ? cloudMeta.fields?.[key] || nowTs()
        : localMeta.fields?.[key] || nowTs();
  });

  // Merge API keys per key with timestamps
  const { result: mergedApiKeys, meta: mergedApiMeta } = mergeKeyed({
    localMap: local.apiKeys || {},
    cloudMap: cloud.apiKeys || {},
    localMeta: localMeta.apiKeys || {},
    cloudMeta: cloudMeta.apiKeys || {},
    valuePicker: pickNewer,
  });
  local.apiKeys = mergedApiKeys;
  mergedMeta.apiKeys = mergedApiMeta;

  // Merge shortcuts by object-level timestamp
  const chosenShortcuts = pickNewer({
    localValue: local.shortcuts,
    cloudValue: cloud.shortcuts,
    localTs: localMeta.shortcuts,
    cloudTs: cloudMeta.shortcuts,
  });
  local.shortcuts = mergeShortcuts(chosenShortcuts || local.shortcuts);
  mergedMeta.shortcuts =
    chosenShortcuts === cloud.shortcuts
      ? cloudMeta.shortcuts || nowTs()
      : localMeta.shortcuts || nowTs();

  // Merge customRules per id with timestamps
  const localCustomMap = Object.fromEntries(
    (local.customRules || []).map(rule => [rule.id, rule])
  );
  const cloudCustomMap = Object.fromEntries(
    (cloud.customRules || []).map(rule => [rule.id, rule])
  );
  const { result: mergedCustomMap, meta: mergedCustomMeta } = mergeKeyed({
    localMap: localCustomMap,
    cloudMap: cloudCustomMap,
    localMeta: localMeta.customRules || {},
    cloudMeta: cloudMeta.customRules || {},
    valuePicker: pickNewer,
  });
  local.customRules = Object.values(mergedCustomMap);
  mergedMeta.customRules = mergedCustomMeta;

  // Merge builtInRules per id with timestamps
  const localBuiltMap = Object.fromEntries(
    (local.builtInRules || []).map(rule => [rule.id, rule])
  );
  const cloudBuiltMap = Object.fromEntries(
    (cloud.builtInRules || []).map(rule => [rule.id, rule])
  );
  const { result: mergedBuiltMap, meta: mergedBuiltMeta } = mergeKeyed({
    localMap: localBuiltMap,
    cloudMap: cloudBuiltMap,
    localMeta: localMeta.builtInRules || {},
    cloudMeta: cloudMeta.builtInRules || {},
    valuePicker: pickNewer,
  });
  local.builtInRules = Object.values(mergedBuiltMap);
  mergedMeta.builtInRules = mergedBuiltMeta;

  // Persist merged meta
  local.meta = mergedMeta;

  // Update in-memory and persist
  inMemory = local;
  await persist(inMemory);
  notify();
  return deepClone(inMemory);
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
