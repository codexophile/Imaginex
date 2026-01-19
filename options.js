import {
  loadSettings,
  updateSettings,
  subscribe,
  mergeCloudSettings,
} from './settings.js';
import {
  saveSettingsToCloud,
  loadSettingsFromCloud,
  signIn,
  getCurrentUser,
  isCloudConfigured,
  getOAuthDebugInfo,
} from './cloudSync.js';

const SHORTCUT_FUNCTIONS = [
  {
    id: 'zoomFullResolution',
    name: 'Zoom to full resolution',
    description: 'Expand the hovered media to its original resolution.',
  },
  {
    id: 'zoomIn',
    name: 'Zoom in',
    description: 'Zoom in on the hovered media.',
  },
  {
    id: 'zoomOut',
    name: 'Zoom out',
    description: 'Zoom out on the hovered media.',
  },
];

const MOUSE_BUTTON_LABELS = {
  0: 'MouseLeft',
  1: 'MouseMiddle',
  2: 'MouseRight',
  3: 'MouseBack',
  4: 'MouseForward',
};

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Meta'];

const els = {};
let initial = null;
let dirty = false;
let saveTimer = null;
const AUTO_SAVE_DEBOUNCE = 400;
let editingRuleId = null;
let activeCapture = null;

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

function normalizeBinding(binding) {
  if (!binding || typeof binding !== 'object') return null;
  const type = binding.type === 'mouse' ? 'mouse' : 'keyboard';
  const combo = typeof binding.combo === 'string' && binding.combo.trim();
  if (!combo) return null;
  return { type, combo };
}

function normalizeShortcutState(raw) {
  const state = {};
  SHORTCUT_FUNCTIONS.forEach(fn => {
    state[fn.id] = [null, null];
  });
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw)) {
      if (Array.isArray(value)) {
        state[key] = [
          normalizeBinding(value[0]) || null,
          normalizeBinding(value[1]) || null,
        ];
      }
    }
  }
  return state;
}

function formatShortcut(binding) {
  if (!binding) return 'Not set';
  return `${binding.type === 'mouse' ? 'Mouse' : 'Key'}: ${binding.combo}`;
}

function renderShortcuts(shortcuts) {
  if (!els.shortcutsList) return;
  const normalized = normalizeShortcutState(shortcuts);
  els.shortcutsList.innerHTML = SHORTCUT_FUNCTIONS.map(fn => {
    const slots = normalized[fn.id] || [null, null];
    const slotHtml = slots
      .map((binding, index) => {
        const hasValue = !!binding;
        return `
          <div class="shortcut-slot" data-func-id="${
            fn.id
          }" data-slot-index="${index}">
            <button class="secondary capture-shortcut" data-func-id="${
              fn.id
            }" data-slot-index="${index}">Set</button>
            <span class="shortcut-value" data-shortcut-value="${
              fn.id
            }-${index}">${formatShortcut(binding)}</span>
            <button class="secondary clear-shortcut" data-func-id="${
              fn.id
            }" data-slot-index="${index}" ${
              hasValue ? '' : 'disabled'
            }>Clear</button>
          </div>
        `;
      })
      .join('');

    return `
      <div class="shortcut-item" data-func-id="${fn.id}">
        <div class="shortcut-heading">
          <div class="shortcut-title">${escapeHtml(fn.name)}</div>
          <div class="shortcut-desc">${escapeHtml(fn.description)}</div>
        </div>
        <div class="shortcut-slots">${slotHtml}</div>
      </div>
    `;
  }).join('');

  wireShortcutButtons();
}

function wireShortcutButtons() {
  if (!els.shortcutsList) return;
  els.shortcutsList.querySelectorAll('.capture-shortcut').forEach(btn => {
    btn.addEventListener('click', handleStartShortcutCapture);
  });
  els.shortcutsList.querySelectorAll('.clear-shortcut').forEach(btn => {
    btn.addEventListener('click', handleClearShortcut);
  });
}

function handleStartShortcutCapture(e) {
  const funcId = e.currentTarget.dataset.funcId;
  const slotIndex = Number(e.currentTarget.dataset.slotIndex || 0);
  beginShortcutCapture(funcId, slotIndex);
}

function beginShortcutCapture(funcId, slotIndex) {
  stopShortcutCapture();
  activeCapture = { funcId, slotIndex };
  setCaptureStatus('Press keys or mouse...', true);
}

function stopShortcutCapture(message) {
  if (!activeCapture) return;
  const { funcId, slotIndex } = activeCapture;
  const current = normalizeShortcutState(initial?.shortcuts || {})[funcId]?.[
    slotIndex
  ];
  const label = message || formatShortcut(current);
  const el = document.querySelector(
    `[data-shortcut-value="${funcId}-${slotIndex}"]`,
  );
  if (el) {
    el.classList.remove('active');
    el.textContent = label;
  }
  activeCapture = null;
}

function setCaptureStatus(text, isActive = false) {
  if (!activeCapture) return;
  const { funcId, slotIndex } = activeCapture;
  const el = document.querySelector(
    `[data-shortcut-value="${funcId}-${slotIndex}"]`,
  );
  if (el) {
    if (isActive) el.classList.add('active');
    el.textContent = text;
  }
}

async function handleClearShortcut(e) {
  const funcId = e.currentTarget.dataset.funcId;
  const slotIndex = Number(e.currentTarget.dataset.slotIndex || 0);
  const shortcuts = normalizeShortcutState(initial?.shortcuts || {});
  if (!shortcuts[funcId]) shortcuts[funcId] = [null, null];
  shortcuts[funcId][slotIndex] = null;
  await updateSettings({ shortcuts });
  initial = await loadSettings();
  renderShortcuts(initial.shortcuts || {});
  if (els.status) {
    els.status.textContent = 'Shortcut cleared';
    setTimeout(() => (els.status.textContent = ''), 1200);
  }
}

function normalizeKeyName(key) {
  if (!key) return null;
  if (key.length === 1) return key.toUpperCase();
  if (key === ' ') return 'Space';
  const map = {
    Escape: 'Esc',
    Esc: 'Esc',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
  };
  return map[key] || key;
}

function normalizeKeyboardShortcut(e) {
  const parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Meta');
  const keyName = normalizeKeyName(e.key);
  if (!keyName) return null;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key) && parts.length === 0)
    return null;
  if (!['Ctrl', 'Alt', 'Shift', 'Meta'].includes(keyName)) {
    parts.push(keyName);
  } else if (parts.length === 0) {
    return null;
  }
  const ordered = MODIFIER_ORDER.filter(m => parts.includes(m));
  const nonMods = parts.filter(p => !MODIFIER_ORDER.includes(p));
  const combo = [...ordered, ...nonMods].join('+');
  return { type: 'keyboard', combo };
}

function normalizeMouseShortcut(e) {
  if (e.type === 'wheel') {
    const dir = e.deltaY < 0 ? 'WheelUp' : 'WheelDown';
    return { type: 'mouse', combo: dir };
  }
  const label = MOUSE_BUTTON_LABELS[e.button];
  if (!label) return null;
  return { type: 'mouse', combo: label };
}

function handleCaptureKey(e) {
  if (!activeCapture) return;
  e.preventDefault();
  e.stopPropagation();
  const isEscapeOnly =
    e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
  if (isEscapeOnly) {
    stopShortcutCapture('Cancelled');
    return;
  }
  const binding = normalizeKeyboardShortcut(e);
  if (!binding) {
    setCaptureStatus('Press a non-modifier key', true);
    return;
  }
  commitCapturedShortcut(binding);
}

function handleCaptureMouse(e) {
  if (!activeCapture) return;
  e.preventDefault();
  e.stopPropagation();
  const binding = normalizeMouseShortcut(e);
  if (!binding) {
    setCaptureStatus('Unsupported mouse input', true);
    return;
  }
  commitCapturedShortcut(binding);
}

function handleCaptureWheel(e) {
  if (!activeCapture) return;
  e.preventDefault();
  e.stopPropagation();
  const binding = normalizeMouseShortcut(e);
  if (binding) commitCapturedShortcut(binding);
}

async function commitCapturedShortcut(binding) {
  if (!activeCapture) return;
  const { funcId, slotIndex } = activeCapture;
  activeCapture = null;
  await saveShortcut(funcId, slotIndex, binding);
}

async function saveShortcut(funcId, slotIndex, binding) {
  const shortcuts = normalizeShortcutState(initial?.shortcuts || {});
  if (!shortcuts[funcId]) shortcuts[funcId] = [null, null];
  shortcuts[funcId][slotIndex] = binding;
  await updateSettings({ shortcuts });
  initial = await loadSettings();
  renderShortcuts(initial.shortcuts || {});
  if (els.status) {
    els.status.textContent = 'Shortcut saved';
    setTimeout(() => (els.status.textContent = ''), 1200);
  }
}

async function init() {
  els.theme = $('theme');
  els.hoverDelay = $('hoverDelay');
  els.zoom = $('zoom');
  els.enablePrefetch = $('enablePrefetch');
  els.enableAnimations = $('enableAnimations');
  els.shortcutsList = $('shortcutsList');
  els.saveBtn = $('saveBtn');
  els.resetBtn = $('resetBtn');
  els.status = $('status');
  els.cloudSyncBtn = $('cloudSyncBtn');
  els.cloudStatus = $('cloudStatus');

  // API Keys elements
  els.apiKeysList = $('apiKeysList');
  els.apiKeyName = $('apiKeyName');
  els.apiKeyValue = $('apiKeyValue');
  els.addApiKeyBtn = $('addApiKeyBtn');

  // Built-in rules elements
  els.builtInRulesDetection = $('builtInRulesDetection');
  els.builtInRulesCssFixes = $('builtInRulesCssFixes');

  // Custom rules elements
  els.customRulesList = $('customRulesList');
  els.addRuleBtn = $('addRuleBtn');
  els.ruleForm = $('ruleForm');
  els.formTitle = $('formTitle');
  els.ruleName = $('ruleName');
  els.ruleSelector = $('ruleSelector');
  els.ruleUserScript = $('ruleUserScript');
  els.ruleBlockMode = $('ruleBlockMode');
  els.ruleTargetUrlTemplate = $('ruleTargetUrlTemplate');
  els.ruleTargetSelectors = $('ruleTargetSelectors');
  els.ruleTargetMaxResults = $('ruleTargetMaxResults');
  els.ruleAllowDomains = $('ruleAllowDomains');
  els.ruleExcludeDomains = $('ruleExcludeDomains');
  els.saveRuleBtn = $('saveRuleBtn');
  els.saveAndCloseRuleBtn = $('saveAndCloseRuleBtn');
  els.cancelRuleBtn = $('cancelRuleBtn');
  els.testRuleBtn = $('testRuleBtn');
  els.ruleTestResults = $('ruleTestResults');
  els.ruleTestDetails = $('ruleTestDetails');

  const s = await loadSettings();
  initial = s;
  bindValues(s);
  renderBuiltInRules(s.builtInRules || []);
  renderCustomRules(s.customRules || []);
  renderApiKeys(s.apiKeys || {});
  applyTheme(s.theme);
  wireEvents();
  subscribe(onExternalChange);
  // Disable cloud actions only when manifest lacks OAuth config
  const configured =
    typeof isCloudConfigured === 'function' && isCloudConfigured();
  if (!configured) {
    if (els.cloudSyncBtn) els.cloudSyncBtn.disabled = true;
    if (els.cloudStatus)
      els.cloudStatus.textContent =
        'Cloud sync not configured (set oauth2.client_id).';
  }
  // OAuth flow will only trigger when user clicks Sync button
}

function bindValues(s) {
  els.theme.value = s.theme;
  els.hoverDelay.value = s.hoverDelay;
  els.zoom.value = s.zoom;
  els.enablePrefetch.checked = !!s.enablePrefetch;
  els.enableAnimations.checked = !!s.enableAnimations;
  renderShortcuts(s.shortcuts || {});
  setDirty(false);
}

function gatherPatch() {
  return {
    theme: els.theme.value,
    hoverDelay: Number(els.hoverDelay.value),
    zoom: Number(els.zoom.value),
    enablePrefetch: !!els.enablePrefetch.checked,
    enableAnimations: !!els.enableAnimations.checked,
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
  ['theme', 'hoverDelay', 'zoom', 'enablePrefetch', 'enableAnimations'].forEach(
    id => {
      const el = els[id];
      const evt = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(evt, onChange);
    },
  );
  els.saveBtn.addEventListener('click', () => doSave(false));
  els.resetBtn.addEventListener('click', resetDefaults);

  // Custom rules event handlers
  if (els.addRuleBtn) {
    els.addRuleBtn.addEventListener('click', handleAddRule);
  }
  if (els.saveRuleBtn) {
    els.saveRuleBtn.addEventListener('click', handleSaveRule);
  }
  if (els.saveAndCloseRuleBtn) {
    els.saveAndCloseRuleBtn.addEventListener('click', handleSaveAndCloseRule);
  }
  if (els.cancelRuleBtn) {
    els.cancelRuleBtn.addEventListener('click', handleCancelRule);
  }
  if (els.testRuleBtn) {
    els.testRuleBtn.addEventListener('click', handleTestRule);
  }

  // API Keys event handlers
  if (els.addApiKeyBtn) {
    els.addApiKeyBtn.addEventListener('click', handleAddApiKey);
  }

  if (els.cloudSyncBtn) {
    els.cloudSyncBtn.addEventListener('click', async () => {
      if (els.cloudSyncBtn.disabled) return;
      els.cloudStatus.textContent = 'Syncing...';
      try {
        await signIn(true);

        // Load and merge from cloud
        const cloudSettings = await loadSettingsFromCloud();
        const merged = await mergeCloudSettings(cloudSettings);

        // Save merged result back to cloud
        await saveSettingsToCloud(merged);

        // Update UI
        initial = merged;
        bindValues(initial);
        renderCustomRules(initial.customRules || []);
        renderApiKeys(initial.apiKeys || {});
        renderBuiltInRules(initial.builtInRules || []);
        renderShortcuts(initial.shortcuts || {});

        els.cloudStatus.textContent = 'Synced.';
      } catch (e) {
        const dbg =
          typeof getOAuthDebugInfo === 'function' ? getOAuthDebugInfo() : null;
        const extra = dbg
          ? ` (client: ${dbg.clientId}, redirect: ${dbg.redirectUri})`
          : '';
        els.cloudStatus.textContent =
          'Sync failed: ' + (e?.message || e) + extra;
        console.error('[Imaginex] Cloud sync failed', { error: e, debug: dbg });
      }
      setTimeout(() => {
        els.cloudStatus.textContent = '';
      }, 2500);
    });
  }

  document.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('click', event => {
      // Remove active class from all items
      document.querySelectorAll('.sidebar-item').forEach(li => {
        li.classList.remove('active');
      });

      // Add active class to clicked item
      event.target.classList.add('active');

      // Get the section ID
      const sectionId = 'section-' + event.target.id;

      // Hide all sections
      document.querySelectorAll('.section-content').forEach(section => {
        section.classList.remove('active');
      });

      // Show selected section
      const selectedSection = document.getElementById(sectionId);
      if (selectedSection) {
        selectedSection.classList.add('active');
      }
    });
  });
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
  for (const k of [
    'theme',
    'hoverDelay',
    'zoom',
    'enablePrefetch',
    'enableAnimations',
  ]) {
    if (newSettings[k] !== initial[k]) {
      initial[k] = newSettings[k];
      changed = true;
    }
  }
  const latestShortcuts = normalizeShortcutState(newSettings.shortcuts);
  const currentShortcuts = normalizeShortcutState(initial.shortcuts);
  if (JSON.stringify(latestShortcuts) !== JSON.stringify(currentShortcuts)) {
    initial.shortcuts = latestShortcuts;
    changed = true;
  }
  const apiKeysChanged =
    JSON.stringify(newSettings.apiKeys || {}) !==
    JSON.stringify(initial.apiKeys || {});
  if (apiKeysChanged) {
    initial.apiKeys = newSettings.apiKeys || {};
  }

  const customRulesChanged =
    JSON.stringify(newSettings.customRules || []) !==
    JSON.stringify(initial.customRules || []);
  if (customRulesChanged) {
    initial.customRules = newSettings.customRules || [];
  }

  const builtInRulesChanged =
    JSON.stringify(newSettings.builtInRules || []) !==
    JSON.stringify(initial.builtInRules || []);
  if (builtInRulesChanged) {
    initial.builtInRules = newSettings.builtInRules || [];
  }

  if (
    (changed || apiKeysChanged || customRulesChanged || builtInRulesChanged) &&
    !dirty
  ) {
    bindValues(initial);
    renderApiKeys(initial.apiKeys || {});
    renderCustomRules(initial.customRules || []);
    renderBuiltInRules(initial.builtInRules || []);
    renderShortcuts(initial.shortcuts || {});
  }
}

// API Keys Management
function renderApiKeys(apiKeys) {
  const container = els.apiKeysList;
  if (!apiKeys || Object.keys(apiKeys).length === 0) {
    container.innerHTML =
      '<p style="opacity: 0.6; font-size: 13px;">No API keys stored. Add one below to use API-based rules.</p>';
    return;
  }

  container.innerHTML = Object.entries(apiKeys)
    .map(
      ([name, value]) => `
    <div class="rule-item" style="display:flex; justify-content:space-between; align-items:center; padding:10px;">
      <div style="flex:1;">
        <strong>${escapeHtml(name)}</strong>
        <div style="opacity:.7; font-size:12px; font-family:monospace;">${escapeHtml(
          value.slice(0, 12),
        )}${'*'.repeat(Math.max(0, value.length - 12))}</div>
      </div>
      <button class="danger delete-api-key-btn" data-key-name="${escapeHtml(
        name,
      )}">Delete</button>
    </div>
  `,
    )
    .join('');

  container.querySelectorAll('.delete-api-key-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteApiKey);
  });
}

// Built-in Rules Management
function renderBuiltInRules(rules) {
  const detectionRules = rules.filter(r => r.category === 'detection');
  const cssFixRules = rules.filter(r => r.category === 'css-fixes');

  renderBuiltInRulesCategory(els.builtInRulesDetection, detectionRules);
  renderBuiltInRulesCategory(els.builtInRulesCssFixes, cssFixRules);
}

function renderBuiltInRulesCategory(container, rules) {
  if (!container) return;

  if (!rules || rules.length === 0) {
    container.innerHTML =
      '<p style="opacity: 0.6; font-size: 13px;">No rules in this category.</p>';
    return;
  }

  container.innerHTML = rules
    .map(rule => {
      const allowDomainsStr = Array.isArray(rule.allowDomains)
        ? rule.allowDomains.join(', ')
        : '';
      const excludeDomainsStr = Array.isArray(rule.excludeDomains)
        ? rule.excludeDomains.join(', ')
        : '';

      return `
    <div class="rule-item" data-rule-id="${rule.id}">
      <div class="rule-header">
        <div class="rule-name">
          <span class="toggle-enabled">
            <input type="checkbox" 
              class="builtin-rule-enabled-toggle" 
              data-rule-id="${rule.id}" 
              ${rule.enabled ? 'checked' : ''} />
            ${escapeHtml(rule.name)}
          </span>
        </div>
        <div class="rule-actions">
          <button class="edit-builtin-domains-btn" data-rule-id="${
            rule.id
          }" style="padding: 4px 10px; font-size: 12px;">Edit Domains</button>
        </div>
      </div>
      <div class="rule-details">
        ${escapeHtml(rule.description)}
        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 11px;">
          <div style="margin-bottom: 4px;">
            <strong>Allowed:</strong> ${
              allowDomainsStr
                ? escapeHtml(allowDomainsStr)
                : '<span style="opacity:0.5;">All domains</span>'
            }
          </div>
          <div>
            <strong>Excluded:</strong> ${
              excludeDomainsStr
                ? escapeHtml(excludeDomainsStr)
                : '<span style="opacity:0.5;">None</span>'
            }
          </div>
        </div>
      </div>
      <div class="builtin-domain-editor" id="domain-editor-${
        rule.id
      }" style="display: none; margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(0,0,0,0.15);">
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Allowed Domains</label>
          <input type="text" class="builtin-allow-input" data-rule-id="${
            rule.id
          }" 
                 value="${escapeHtml(allowDomainsStr)}" 
                 placeholder="e.g., youtube.com, *.youtube.com (comma-separated)" 
                 style="width: 100%; box-sizing: border-box; padding: 6px; font-size: 12px;" />
          <div style="font-size: 10px; opacity: 0.6; margin-top: 2px;">Leave empty to run on all domains. Supports wildcards (*.example.com)</div>
        </div>
        <div style="margin-bottom: 10px;">
          <label style="display: block; font-size: 12px; font-weight: 600; margin-bottom: 4px;">Excluded Domains</label>
          <input type="text" class="builtin-exclude-input" data-rule-id="${
            rule.id
          }" 
                 value="${escapeHtml(excludeDomainsStr)}" 
                 placeholder="e.g., example.com (comma-separated)" 
                 style="width: 100%; box-sizing: border-box; padding: 6px; font-size: 12px;" />
          <div style="font-size: 10px; opacity: 0.6; margin-top: 2px;">Domains where this rule should NOT run (overrides allowed domains)</div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="save-builtin-domains-btn" data-rule-id="${
            rule.id
          }" style="padding: 6px 12px; font-size: 12px;">Save</button>
          <button class="cancel-builtin-domains-btn secondary" data-rule-id="${
            rule.id
          }" style="padding: 6px 12px; font-size: 12px;">Cancel</button>
        </div>
      </div>
    </div>
  `;
    })
    .join('');

  // Wire up event handlers
  container.querySelectorAll('.builtin-rule-enabled-toggle').forEach(toggle => {
    toggle.addEventListener('change', handleToggleBuiltInRule);
  });

  container.querySelectorAll('.edit-builtin-domains-btn').forEach(btn => {
    btn.addEventListener('click', handleEditBuiltInDomains);
  });

  container.querySelectorAll('.save-builtin-domains-btn').forEach(btn => {
    btn.addEventListener('click', handleSaveBuiltInDomains);
  });

  container.querySelectorAll('.cancel-builtin-domains-btn').forEach(btn => {
    btn.addEventListener('click', handleCancelBuiltInDomains);
  });
}

async function handleToggleBuiltInRule(e) {
  const ruleId = e.target.dataset.ruleId;
  const enabled = e.target.checked;

  const builtInRules = (initial.builtInRules || []).map(r =>
    r.id === ruleId ? { ...r, enabled } : r,
  );

  await updateSettings({ builtInRules });
  initial = await loadSettings();

  els.status.textContent = enabled
    ? `Rule enabled: ${ruleId}`
    : `Rule disabled: ${ruleId}`;
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

function handleEditBuiltInDomains(e) {
  const ruleId = e.target.dataset.ruleId;
  const editor = document.getElementById(`domain-editor-${ruleId}`);
  if (editor) {
    editor.style.display = 'block';
    e.target.textContent = 'Editing...';
    e.target.disabled = true;
  }
}

async function handleSaveBuiltInDomains(e) {
  const ruleId = e.target.dataset.ruleId;

  // Get input values
  const allowInput = document.querySelector(
    `.builtin-allow-input[data-rule-id="${ruleId}"]`,
  );
  const excludeInput = document.querySelector(
    `.builtin-exclude-input[data-rule-id="${ruleId}"]`,
  );

  if (!allowInput || !excludeInput) return;

  const parseDomainsInput = input => {
    return (input || '')
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);
  };

  const allowDomains = parseDomainsInput(allowInput.value);
  const excludeDomains = parseDomainsInput(excludeInput.value);

  // Update the rule
  const builtInRules = (initial.builtInRules || []).map(r =>
    r.id === ruleId ? { ...r, allowDomains, excludeDomains } : r,
  );

  await updateSettings({ builtInRules });
  initial = await loadSettings();
  renderBuiltInRules(initial.builtInRules || []);

  els.status.textContent = `Domains updated for ${ruleId}`;
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

function handleCancelBuiltInDomains(e) {
  const ruleId = e.target.dataset.ruleId;
  const editor = document.getElementById(`domain-editor-${ruleId}`);
  if (editor) {
    editor.style.display = 'none';

    // Re-enable the edit button
    const editBtn = document.querySelector(
      `.edit-builtin-domains-btn[data-rule-id="${ruleId}"]`,
    );
    if (editBtn) {
      editBtn.textContent = 'Edit Domains';
      editBtn.disabled = false;
    }
  }
}

// API Keys Management (keeping existing code)

async function handleAddApiKey() {
  const name = els.apiKeyName.value.trim();
  const value = els.apiKeyValue.value.trim();

  if (!name || !value) {
    alert('Both key name and value are required.');
    return;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    alert(
      'Key name must start with a letter and contain only letters, numbers, and underscores.',
    );
    return;
  }

  const apiKeys = { ...(initial.apiKeys || {}), [name]: value };
  await updateSettings({ apiKeys });
  initial = await loadSettings();
  renderApiKeys(initial.apiKeys || {});
  els.apiKeyName.value = '';
  els.apiKeyValue.value = '';
  els.status.textContent = 'API key added';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

async function handleDeleteApiKey(e) {
  const keyName = e.target.dataset.keyName;
  if (!confirm(`Delete API key "${keyName}"?`)) return;

  const apiKeys = { ...(initial.apiKeys || {}) };
  delete apiKeys[keyName];
  await updateSettings({ apiKeys });
  initial = await loadSettings();
  renderApiKeys(initial.apiKeys || {});
  els.status.textContent = 'API key deleted';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

// Custom Rules Management
function renderCustomRules(rules) {
  const container = els.customRulesList;
  if (!rules || rules.length === 0) {
    container.innerHTML =
      '<p style="opacity: 0.6; font-size: 13px;">No custom rules defined yet. Click "Add New Rule" to create one.</p>';
    return;
  }

  container.innerHTML = rules
    .map(rule => {
      const domainInfo = [];
      if (Array.isArray(rule.allowDomains) && rule.allowDomains.length > 0) {
        domainInfo.push(
          `<strong>Allowed:</strong> ${escapeHtml(
            rule.allowDomains.join(', '),
          )}`,
        );
      }
      if (
        Array.isArray(rule.excludeDomains) &&
        rule.excludeDomains.length > 0
      ) {
        domainInfo.push(
          `<strong>Excluded:</strong> ${escapeHtml(
            rule.excludeDomains.join(', '),
          )}`,
        );
      }
      const blockBadge = rule.block
        ? '<span class="rule-badge" title="Blocks matches from triggering the overlay">Blocks</span>'
        : '';
      // Target Page summary
      const tp = rule.targetPage || {};
      const hasTpSelectors = Array.isArray(tp.selectors)
        ? tp.selectors.length > 0
        : String(tp.selectors || '').trim().length > 0;
      const tpSummary = hasTpSelectors
        ? `<div><strong>Target Page:</strong> URL=${escapeHtml(
            tp.urlTemplate || '{href}',
          )}, Selectors=${escapeHtml(
            Array.isArray(tp.selectors)
              ? String(tp.selectors.length) + ' line(s)'
              : tp.selectors || '',
          )}, Max=${escapeHtml(String(tp.maxResults || 1))}</div>`
        : '';
      return `
    <div class="rule-item" data-rule-id="${rule.id}">
      <div class="rule-header">
        <div class="rule-name">
          <span class="toggle-enabled">
            <input type="checkbox" 
              class="rule-enabled-toggle" 
              data-rule-id="${rule.id}" 
              ${rule.enabled ? 'checked' : ''} />
            ${escapeHtml(rule.name)}
          </span>
          ${blockBadge}
        </div>
        <div class="rule-actions">
          <button class="edit-rule-btn" data-rule-id="${rule.id}">Edit</button>
          <button class="danger delete-rule-btn" data-rule-id="${
            rule.id
          }">Delete</button>
        </div>
      </div>
      <div class="rule-details">
        <div><strong>Selector:</strong> <code>${escapeHtml(
          rule.selector,
        )}</code></div>
        ${
          rule.block
            ? '<div><strong>Action:</strong> Block matches (no popup)</div>'
            : ''
        }
        ${tpSummary}
        ${
          rule.userScript
            ? `<div><strong>Script:</strong> ${escapeHtml(
                (rule.userScript || '').slice(0, 80),
              )}...</div>`
            : '<div style="color:#e57373;">No Custom JavaScript</div>'
        }
        ${
          domainInfo.length > 0
            ? `<div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(0,0,0,0.1); font-size: 11px;">${domainInfo.join(
                ' | ',
              )}</div>`
            : ''
        }
      </div>
    </div>
  `;
    })
    .join('');

  // Wire up event handlers for the rendered rules
  container.querySelectorAll('.rule-enabled-toggle').forEach(toggle => {
    toggle.addEventListener('change', handleToggleRule);
  });
  container.querySelectorAll('.edit-rule-btn').forEach(btn => {
    btn.addEventListener('click', handleEditRule);
  });
  container.querySelectorAll('.delete-rule-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteRule);
  });
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleAddRule() {
  editingRuleId = null;
  els.formTitle.textContent = 'New Rule';
  els.ruleName.value = '';
  els.ruleSelector.value = '';
  els.ruleUserScript.value = '';
  if (els.ruleBlockMode) els.ruleBlockMode.checked = false;
  if (els.ruleTargetUrlTemplate) els.ruleTargetUrlTemplate.value = '';
  if (els.ruleTargetSelectors) els.ruleTargetSelectors.value = '';
  if (els.ruleTargetMaxResults) els.ruleTargetMaxResults.value = '50';
  els.ruleAllowDomains.value = '';
  els.ruleExcludeDomains.value = '';
  els.ruleForm.style.display = 'block';
  els.ruleName.focus();
}

function handleEditRule(e) {
  const ruleId = e.target.dataset.ruleId;
  const rules = initial.customRules || [];
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return;

  editingRuleId = ruleId;
  els.formTitle.textContent = 'Edit Rule';
  els.ruleName.value = rule.name;
  els.ruleSelector.value = rule.selector;
  els.ruleUserScript.value =
    typeof rule.userScript === 'string' ? rule.userScript : '';
  if (els.ruleBlockMode) els.ruleBlockMode.checked = !!rule.block;
  // Target page fields
  const tp = rule.targetPage || {};
  if (els.ruleTargetUrlTemplate)
    els.ruleTargetUrlTemplate.value = tp.urlTemplate || '';
  if (els.ruleTargetSelectors)
    els.ruleTargetSelectors.value = Array.isArray(tp.selectors)
      ? tp.selectors.join('\n')
      : tp.selectors || '';
  if (els.ruleTargetMaxResults)
    els.ruleTargetMaxResults.value = String(tp.maxResults || 50);
  // Populate domain fields
  els.ruleAllowDomains.value = Array.isArray(rule.allowDomains)
    ? rule.allowDomains.join(', ')
    : '';
  els.ruleExcludeDomains.value = Array.isArray(rule.excludeDomains)
    ? rule.excludeDomains.join(', ')
    : '';
  els.ruleForm.style.display = 'block';
  els.ruleName.focus();
}

async function handleSaveRule() {
  const name = els.ruleName.value.trim();
  const selector = els.ruleSelector.value.trim();
  const userScript = (els.ruleUserScript.value || '').trim();
  const blockMatches = !!(els.ruleBlockMode && els.ruleBlockMode.checked);
  // Target page fields
  const targetUrlTemplate = (els.ruleTargetUrlTemplate?.value || '').trim();
  const targetSelectorsRaw = (els.ruleTargetSelectors?.value || '').trim();
  const targetSelectors = targetSelectorsRaw
    ? targetSelectorsRaw
        .split(/\r?\n/)
        .map(s => s.trim())
        .filter(Boolean)
    : [];
  const targetMaxResults = Math.max(
    1,
    Number(els.ruleTargetMaxResults?.value || '50') || 50,
  );

  // Parse domain fields
  const parseDomainsInput = input => {
    return (input || '')
      .split(',')
      .map(d => d.trim())
      .filter(d => d.length > 0);
  };

  const allowDomains = parseDomainsInput(els.ruleAllowDomains.value);
  const excludeDomains = parseDomainsInput(els.ruleExcludeDomains.value);

  if (!name || !selector) {
    alert('Rule name and CSS selector are required.');
    return false;
  }

  if (!blockMatches && !userScript && targetSelectors.length === 0) {
    alert(
      'Provide either Target Page Selectors (to auto-extract) or Custom JavaScript.',
    );
    return false;
  }

  const rules = [...(initial.customRules || [])];

  if (editingRuleId) {
    // Update existing rule
    const index = rules.findIndex(r => r.id === editingRuleId);
    if (index >= 0) {
      rules[index] = {
        ...rules[index],
        name,
        selector,
        block: blockMatches,
        userScript: userScript || undefined,
        targetPage:
          targetSelectors.length || targetUrlTemplate
            ? {
                urlTemplate: targetUrlTemplate || '{href}',
                selectors: targetSelectors,
                maxResults: targetMaxResults,
              }
            : undefined,
        allowDomains: allowDomains.length > 0 ? allowDomains : [],
        excludeDomains: excludeDomains.length > 0 ? excludeDomains : [],
      };
      delete rules[index].urlTemplate;
      delete rules[index].extract;
      delete rules[index].api;
      delete rules[index].customJS;
    }
  } else {
    // Add new rule
    const newRule = {
      id: 'custom-' + Date.now(),
      name,
      enabled: true,
      selector,
      block: blockMatches,
      userScript: userScript || undefined,
      targetPage:
        targetSelectors.length || targetUrlTemplate
          ? {
              urlTemplate: targetUrlTemplate || '{href}',
              selectors: targetSelectors,
              maxResults: targetMaxResults,
            }
          : undefined,
      allowDomains: allowDomains.length > 0 ? allowDomains : [],
      excludeDomains: excludeDomains.length > 0 ? excludeDomains : [],
    };
    rules.push(newRule);
  }

  await updateSettings({ customRules: rules });
  initial = await loadSettings();
  renderCustomRules(initial.customRules || []);
  els.status.textContent = editingRuleId ? 'Rule updated' : 'Rule added';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
  return true;
}

function handleCancelRule() {
  els.ruleForm.style.display = 'none';
  editingRuleId = null;
}

async function handleSaveAndCloseRule() {
  const ok = await handleSaveRule();
  if (ok) {
    els.ruleForm.style.display = 'none';
    editingRuleId = null;
  }
}

async function handleTestRule() {
  // Gather rule from form
  const name = els.ruleName.value.trim() || 'Untitled Rule';
  const selector = els.ruleSelector.value.trim();
  const userScript = (els.ruleUserScript.value || '').trim();
  const blockMatches = !!(els.ruleBlockMode && els.ruleBlockMode.checked);

  if (!selector) {
    alert('CSS selector is required to test the rule.');
    return;
  }
  if (blockMatches) {
    els.ruleTestResults.style.display = 'block';
    els.ruleTestDetails.innerHTML =
      '<div style="color:#e57373;">This rule blocks matches instead of returning URLs. No test needed.</div>';
    return;
  }
  if (!userScript) {
    alert('Custom JavaScript is required to test the rule.');
    return;
  }

  // Query active tab and send test message
  try {
    const tabs = await new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, t => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(t);
      });
    });
    const tab = tabs && tabs[0];
    if (!tab || !tab.id) {
      alert('No active tab found to test.');
      return;
    }

    const payload = {
      type: 'imagus:testRule',
      rule: {
        name,
        selector,
        userScript: userScript || undefined,
      },
    };
    const response = await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(tab.id, payload, res => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(res);
      });
    });

    // Render results
    els.ruleTestResults.style.display = 'block';
    const details = els.ruleTestDetails;
    if (!response || response.ok === false) {
      details.innerHTML = `<div style="color:#e57373;">Test failed: ${escapeHtml(
        response?.error || 'Unknown error',
      )}</div>`;
      return;
    }

    const count = response.count || 0;
    const results = response.results || [];
    const top = results.slice(0, 5);

    const html = [
      `<div><strong>Matched elements:</strong> ${count}</div>`,
      top.length
        ? '<div style="margin-top:6px;"><strong>Top results:</strong></div>'
        : '<div style="margin-top:6px; opacity:.7;">No matches found.</div>',
      ...top.map((r, i) => {
        const unresolved = r.unresolvedPlaceholders
          ? ' (unresolved placeholders)'
          : '';
        const urlStr = r.url
          ? `<code>${escapeHtml(r.url)}</code>`
          : '<em>no URL</em>';
        const elemStr = r.elementSummary ? escapeHtml(r.elementSummary) : '';
        return `<div style="margin:4px 0;">#${
          i + 1
        }: ${urlStr}${unresolved}<div style="opacity:.7;">${elemStr}</div></div>`;
      }),
    ].join('');

    details.innerHTML = html;
  } catch (e) {
    els.ruleTestResults.style.display = 'block';
    els.ruleTestDetails.innerHTML = `<div style="color:#e57373;">Test error: ${escapeHtml(
      e.message || String(e),
    )}</div>`;
  }
}

async function handleDeleteRule(e) {
  const ruleId = e.target.dataset.ruleId;
  if (!confirm('Are you sure you want to delete this rule?')) return;

  const rules = (initial.customRules || []).filter(r => r.id !== ruleId);
  await updateSettings({ customRules: rules });
  initial = await loadSettings();
  renderCustomRules(initial.customRules || []);
  els.status.textContent = 'Rule deleted';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

async function handleToggleRule(e) {
  const ruleId = e.target.dataset.ruleId;
  const enabled = e.target.checked;

  const rules = [...(initial.customRules || [])];
  const rule = rules.find(r => r.id === ruleId);
  if (rule) {
    rule.enabled = enabled;
    await updateSettings({ customRules: rules });
    initial = await loadSettings();
    els.status.textContent = enabled ? 'Rule enabled' : 'Rule disabled';
    setTimeout(() => {
      els.status.textContent = '';
    }, 1000);
  }
}

window.addEventListener('keydown', handleCaptureKey, true);
window.addEventListener('mousedown', handleCaptureMouse, true);
window.addEventListener('auxclick', handleCaptureMouse, true);
window.addEventListener('wheel', handleCaptureWheel, {
  capture: true,
  passive: false,
});

init().catch(err => {
  console.error('Failed to init options', err);
  if (els.status) els.status.textContent = 'Error loading settings';
});
