// settings.js
// Central settings module with local cache and hooks for future cloud sync

const SETTINGS_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  theme: 'light', // UI theme for future options page styling
  zoom: 1.0, // Placeholder for potential scaling of enlarged image
  enablePrefetch: true, // Future optimization: prefetch high-res images on hover intent
  hoverDelay: 300, // Delay before showing enlarged image (ms)
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
