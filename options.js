import { loadSettings, updateSettings, subscribe } from './settings.js';
import {
  saveSettingsToCloud,
  loadSettingsFromCloud,
  signIn,
  getCurrentUser,
} from './cloudSync.js';

const els = {};
let initial = null;
let dirty = false;
let saveTimer = null;
const AUTO_SAVE_DEBOUNCE = 400;

function $(id) {
  return document.getElementById(id);
}

function setDirty(isDirty) {
  dirty = isDirty;
  const btn = els.saveBtn;
  if (isDirty) {
    btn.textContent = 'Save';
    btn.disabled = false;
  } else {
    btn.textContent = 'Saved';
    btn.disabled = true;
  }
}

function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

async function init() {
  els.theme = $('theme');
  els.hoverDelay = $('hoverDelay');
  els.zoom = $('zoom');
  els.enablePrefetch = $('enablePrefetch');
  els.saveBtn = $('saveBtn');
  els.resetBtn = $('resetBtn');
  els.status = $('status');
  els.cloudSaveBtn = $('cloudSaveBtn');
  els.cloudLoadBtn = $('cloudLoadBtn');
  els.cloudStatus = $('cloudStatus');

  const s = await loadSettings();
  initial = s;
  bindValues(s);
  applyTheme(s.theme);
  wireEvents();
  subscribe(onExternalChange);
  // Disable cloud actions if not configured
  try {
    await signIn(false);
  } catch (e) {
    if (els.cloudSaveBtn) els.cloudSaveBtn.disabled = true;
    if (els.cloudLoadBtn) els.cloudLoadBtn.disabled = true;
    if (els.cloudStatus)
      els.cloudStatus.textContent = 'Cloud sync not configured (see README).';
  }
}

function bindValues(s) {
  els.theme.value = s.theme;
  els.hoverDelay.value = s.hoverDelay;
  els.zoom.value = s.zoom;
  els.enablePrefetch.checked = !!s.enablePrefetch;
  setDirty(false);
}

function gatherPatch() {
  return {
    theme: els.theme.value,
    hoverDelay: Number(els.hoverDelay.value),
    zoom: Number(els.zoom.value),
    enablePrefetch: !!els.enablePrefetch.checked,
  };
}

function scheduleAutoSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => doSave(true), AUTO_SAVE_DEBOUNCE);
}

async function doSave(isAuto = false) {
  if (!dirty) return;
  const patch = gatherPatch();
  await updateSettings(patch);
  initial = { ...initial, ...patch };
  setDirty(false);
  els.status.textContent = isAuto ? 'Auto-saved' : 'Saved';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
  applyTheme(patch.theme);
}

function onChange() {
  const patch = gatherPatch();
  const isDirtyNow = Object.keys(patch).some(k => patch[k] !== initial[k]);
  setDirty(isDirtyNow);
  if (isDirtyNow) scheduleAutoSave();
}

function wireEvents() {
  ['theme', 'hoverDelay', 'zoom', 'enablePrefetch'].forEach(id => {
    const el = els[id];
    const evt = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(evt, onChange);
  });
  els.saveBtn.addEventListener('click', () => doSave(false));
  els.resetBtn.addEventListener('click', resetDefaults);
  if (els.cloudSaveBtn) {
    els.cloudSaveBtn.addEventListener('click', async () => {
      if (els.cloudSaveBtn.disabled) return;
      els.cloudStatus.textContent = 'Saving to cloud...';
      try {
        await signIn(true);
        const settings = await loadSettings();
        await saveSettingsToCloud(settings);
        els.cloudStatus.textContent = 'Saved to cloud.';
      } catch (e) {
        els.cloudStatus.textContent = 'Cloud save failed: ' + (e?.message || e);
      }
      setTimeout(() => {
        els.cloudStatus.textContent = '';
      }, 2000);
    });
  }
  if (els.cloudLoadBtn) {
    els.cloudLoadBtn.addEventListener('click', async () => {
      if (els.cloudLoadBtn.disabled) return;
      els.cloudStatus.textContent = 'Loading from cloud...';
      try {
        await signIn(true);
        const cloudSettings = await loadSettingsFromCloud();
        await updateSettings(cloudSettings);
        initial = { ...initial, ...cloudSettings };
        bindValues(initial);
        els.cloudStatus.textContent = 'Loaded from cloud.';
      } catch (e) {
        els.cloudStatus.textContent = 'Cloud load failed: ' + (e?.message || e);
      }
      setTimeout(() => {
        els.cloudStatus.textContent = '';
      }, 2000);
    });
  }
}

async function resetDefaults() {
  await updateSettings({
    theme: 'light',
    hoverDelay: 300,
    zoom: 1.0,
    enablePrefetch: true,
  });
  const latest = await loadSettings();
  initial = latest;
  bindValues(latest);
  els.status.textContent = 'Defaults restored';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1600);
}

function onExternalChange(newSettings) {
  // Merge external changes if different from our initial
  if (!initial) return;
  let changed = false;
  for (const k of ['theme', 'hoverDelay', 'zoom', 'enablePrefetch']) {
    if (newSettings[k] !== initial[k]) {
      initial[k] = newSettings[k];
      changed = true;
    }
  }
  if (changed && !dirty) {
    bindValues(initial);
  }
}

init().catch(err => {
  console.error('Failed to init options', err);
  if (els.status) els.status.textContent = 'Error loading settings';
});
