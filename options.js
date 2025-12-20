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
let editingRuleId = null;

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
  els.enableAnimations = $('enableAnimations');
  els.saveBtn = $('saveBtn');
  els.resetBtn = $('resetBtn');
  els.status = $('status');
  els.cloudSaveBtn = $('cloudSaveBtn');
  els.cloudLoadBtn = $('cloudLoadBtn');
  els.cloudStatus = $('cloudStatus');

  // API Keys elements
  els.apiKeysList = $('apiKeysList');
  els.apiKeyName = $('apiKeyName');
  els.apiKeyValue = $('apiKeyValue');
  els.addApiKeyBtn = $('addApiKeyBtn');

  // Custom rules elements
  els.customRulesList = $('customRulesList');
  els.addRuleBtn = $('addRuleBtn');
  els.ruleForm = $('ruleForm');
  els.formTitle = $('formTitle');
  els.ruleName = $('ruleName');
  els.ruleSelector = $('ruleSelector');
  els.ruleUrlTemplate = $('ruleUrlTemplate');
  els.ruleExtract = $('ruleExtract');
  els.ruleApi = $('ruleApi');
  els.saveRuleBtn = $('saveRuleBtn');
  els.cancelRuleBtn = $('cancelRuleBtn');
  els.testRuleBtn = $('testRuleBtn');
  els.ruleTestResults = $('ruleTestResults');
  els.ruleTestDetails = $('ruleTestDetails');

  const s = await loadSettings();
  initial = s;
  bindValues(s);
  renderCustomRules(s.customRules || []);
  renderApiKeys(s.apiKeys || {});
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
  els.enableAnimations.checked = !!s.enableAnimations;
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
    }
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
          value.slice(0, 12)
        )}${'*'.repeat(Math.max(0, value.length - 12))}</div>
      </div>
      <button class="danger delete-api-key-btn" data-key-name="${escapeHtml(
        name
      )}">Delete</button>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('.delete-api-key-btn').forEach(btn => {
    btn.addEventListener('click', handleDeleteApiKey);
  });
}

async function handleAddApiKey() {
  const name = els.apiKeyName.value.trim();
  const value = els.apiKeyValue.value.trim();

  if (!name || !value) {
    alert('Both key name and value are required.');
    return;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    alert(
      'Key name must start with a letter and contain only letters, numbers, and underscores.'
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
    .map(
      rule => `
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
          rule.selector
        )}</code></div>
        ${
          rule.urlTemplate
            ? `<div><strong>URL Template:</strong> <code>${escapeHtml(
                rule.urlTemplate
              )}</code></div>`
            : ''
        }
        ${
          Array.isArray(rule.extract) && rule.extract.length
            ? `<div><strong>Extract:</strong> ${rule.extract.length} step(s)</div>`
            : ''
        }
      </div>
    </div>
  `
    )
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
  els.ruleUrlTemplate.value = '';
  els.ruleExtract.value = '';
  els.ruleApi.value = '';
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
  els.ruleUrlTemplate.value = rule.urlTemplate || '';
  if (Array.isArray(rule.extract) && rule.extract.length) {
    els.ruleExtract.value = JSON.stringify(rule.extract, null, 2);
  } else {
    els.ruleExtract.value = '';
  }
  if (rule.api && typeof rule.api === 'object') {
    els.ruleApi.value = JSON.stringify(rule.api, null, 2);
  } else {
    els.ruleApi.value = '';
  }
  els.ruleForm.style.display = 'block';
  els.ruleName.focus();
}

function parseExtractInput(text) {
  const raw = (text || '').trim();
  if (!raw) return null;

  // JSON mode
  if (raw.startsWith('[')) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error('Extract Rules must be valid JSON.');
    }
    if (!Array.isArray(parsed)) {
      throw new Error('Extract Rules JSON must be an array.');
    }
    for (const step of parsed) {
      if (!step || typeof step !== 'object') {
        throw new Error('Each Extract Rules step must be an object.');
      }
      if (typeof step.var !== 'string' || !step.var.trim()) {
        throw new Error(
          'Each Extract Rules step must include a non-empty "var".'
        );
      }
      if (typeof step.regex !== 'string' || !step.regex.trim()) {
        throw new Error(
          'Each Extract Rules step must include a non-empty "regex".'
        );
      }
      if (step.sources != null && !Array.isArray(step.sources)) {
        throw new Error('If provided, "sources" must be an array.');
      }
    }
    return parsed;
  }

  // Shorthand mode (human-friendly): one rule per line.
  // Supports:
  //   url = xpath('...') | srcsetBest
  //   url = qs('selector@attr') | srcsetBest
  //   url = closest('closestSelector', 'selector', 'attr') | srcsetBest
  //   xpath('...') || qs('...') || closest('...') | srcsetBest
  const steps = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    let line = original.trim();
    if (!line) continue;
    if (line.startsWith('#') || line.startsWith('//')) continue;

    // Optional mode via pipe
    let mode = null;
    const pipeIdx = line.lastIndexOf('|');
    if (pipeIdx !== -1) {
      const rhs = line.slice(pipeIdx + 1).trim();
      const lhs = line.slice(0, pipeIdx).trim();
      if (rhs === 'srcsetBest') {
        mode = rhs;
        line = lhs;
      }
    }

    // Optional assignment
    let varName = 'url';
    const eqIdx = line.indexOf('=');
    let exprPart = line;
    if (eqIdx !== -1) {
      varName = line.slice(0, eqIdx).trim();
      exprPart = line.slice(eqIdx + 1).trim();
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(varName)) {
      throw new Error(
        `Invalid variable name on line ${
          i + 1
        }. Use letters/numbers/underscore (e.g. url, videoId).`
      );
    }

    // Optional regex override via '~ <regex>' (quotes optional)
    let regexString = '(.+)';
    const tildeIdx = exprPart.lastIndexOf('~');
    if (tildeIdx !== -1) {
      const regexPart = exprPart.slice(tildeIdx + 1).trim();
      exprPart = exprPart.slice(0, tildeIdx).trim();
      if (!regexPart) {
        throw new Error(`Missing regex after '~' on line ${i + 1}.`);
      }
      if (
        (regexPart.startsWith('"') && regexPart.endsWith('"')) ||
        (regexPart.startsWith("'") && regexPart.endsWith("'"))
      ) {
        regexString = regexPart.slice(1, -1);
      } else {
        regexString = regexPart;
      }
      if (!regexString) {
        throw new Error(`Empty regex after '~' on line ${i + 1}.`);
      }
    }

    // Support fallbacks via ||
    const exprsRaw = exprPart
      .split('||')
      .map(s => s.trim())
      .filter(Boolean);
    const exprs = [];
    for (const s of exprsRaw) {
      // xpath('...') → source:{ type:'xpath', expr: '...' }
      if (/^xpath\s*\(/i.test(s)) {
        const inner = s.replace(/^xpath\s*\(/i, '').replace(/\)\s*$/, '');
        let expr = inner.trim();
        if (
          (expr.startsWith('"') && expr.endsWith('"')) ||
          (expr.startsWith("'") && expr.endsWith("'"))
        ) {
          expr = expr.slice(1, -1);
        }
        exprs.push({ kind: 'xpath', expr });
        continue;
      }

      // qs('selector@attr') → source:{ type:'cssQueryAttr', selector, name }
      if (/^qs\s*\(/i.test(s)) {
        const inner = s.replace(/^qs\s*\(/i, '').replace(/\)\s*$/, '');
        let selAttr = inner.trim();
        if (
          (selAttr.startsWith('"') && selAttr.endsWith('"')) ||
          (selAttr.startsWith("'") && selAttr.endsWith("'"))
        ) {
          selAttr = selAttr.slice(1, -1);
        }
        const atIdx = selAttr.lastIndexOf('@');
        if (atIdx === -1)
          throw new Error(`qs(...) requires "selector@attr" on line ${i + 1}.`);
        const selector = selAttr.slice(0, atIdx).trim();
        const name = selAttr.slice(atIdx + 1).trim();
        if (!selector || !name)
          throw new Error(`Invalid qs(...) selector@attr on line ${i + 1}.`);
        exprs.push({ kind: 'cssQueryAttr', selector, name });
        continue;
      }

      // closest('closestSelector', 'selector', 'attr') → source:{ type:'closestQueryAttr', closest, selector, name }
      if (/^closest\s*\(/i.test(s)) {
        const m = s.match(
          /^closest\s*\(\s*(['"])(.*?)\1\s*,\s*(['"])(.*?)\3\s*,\s*(['"])(.*?)\5\s*\)\s*$/i
        );
        if (!m)
          throw new Error(
            `closest(...) requires three quoted args on line ${i + 1}.`
          );
        const closestSel = m[2].trim();
        const selector = m[4].trim();
        const name = m[6].trim();
        if (!closestSel || !selector || !name)
          throw new Error(`Invalid closest(...) args on line ${i + 1}.`);
        exprs.push({
          kind: 'closestQueryAttr',
          closest: closestSel,
          selector,
          name,
        });
        continue;
      }

      // Raw XPath string without wrapper
      let rawXpath = s;
      if (
        (rawXpath.startsWith('"') && rawXpath.endsWith('"')) ||
        (rawXpath.startsWith("'") && rawXpath.endsWith("'"))
      ) {
        rawXpath = rawXpath.slice(1, -1);
      }
      exprs.push({ kind: 'xpath', expr: rawXpath });
    }

    if (exprs.length === 0) {
      throw new Error(`Missing XPath on line ${i + 1}.`);
    }

    steps.push({
      var: varName,
      regex: regexString,
      mode,
      sources: exprs.map(x => {
        if (x.kind === 'xpath') return { type: 'xpath', expr: x.expr };
        if (x.kind === 'cssQueryAttr')
          return { type: 'cssQueryAttr', selector: x.selector, name: x.name };
        if (x.kind === 'closestQueryAttr')
          return {
            type: 'closestQueryAttr',
            closest: x.closest,
            selector: x.selector,
            name: x.name,
          };
        return { type: 'xpath', expr: String(x) };
      }),
    });
  }

  if (steps.length === 0) return null;
  return steps;
}

async function handleSaveRule() {
  const name = els.ruleName.value.trim();
  const selector = els.ruleSelector.value.trim();
  const urlTemplate = els.ruleUrlTemplate.value.trim();
  let extract = null;
  try {
    extract = parseExtractInput(els.ruleExtract.value);
  } catch (e) {
    alert(e.message || String(e));
    return;
  }

  const apiRaw = els.ruleApi.value.trim();
  let api = null;
  if (apiRaw) {
    try {
      api = JSON.parse(apiRaw);
      if (api && typeof api === 'object') {
        if (!api.url || typeof api.url !== 'string') {
          alert('API configuration must include a "url" string property.');
          return;
        }
        // Validate optional fields
        if (api.path !== undefined && typeof api.path !== 'string') {
          alert('API "path" must be a string if provided.');
          return;
        }
        if (api.headers !== undefined && typeof api.headers !== 'object') {
          alert('API "headers" must be an object if provided.');
          return;
        }
      } else {
        alert('API configuration must be a JSON object.');
        return;
      }
    } catch (err) {
      alert('Invalid JSON in API configuration: ' + err.message);
      return;
    }
  }

  if (!name || !selector) {
    alert('Rule name and CSS selector are required.');
    return;
  }

  if (!urlTemplate && (!extract || extract.length === 0) && !api) {
    alert(
      'Either URL template, Extract Rules, or API configuration is required.'
    );
    return;
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
        urlTemplate,
        extract,
        api,
      };
      delete rules[index].customJS;
    }
  } else {
    // Add new rule
    const newRule = {
      id: 'custom-' + Date.now(),
      name,
      enabled: true,
      selector,
      urlTemplate,
      extract,
      api,
    };
    rules.push(newRule);
  }

  await updateSettings({ customRules: rules });
  initial = await loadSettings();
  renderCustomRules(initial.customRules || []);
  els.ruleForm.style.display = 'none';
  els.status.textContent = editingRuleId ? 'Rule updated' : 'Rule added';
  setTimeout(() => {
    els.status.textContent = '';
  }, 1500);
}

function handleCancelRule() {
  els.ruleForm.style.display = 'none';
  editingRuleId = null;
}

async function handleTestRule() {
  // Gather rule from form
  const name = els.ruleName.value.trim() || 'Untitled Rule';
  const selector = els.ruleSelector.value.trim();
  const urlTemplate = els.ruleUrlTemplate.value.trim();
  let extract = null;
  try {
    extract = parseExtractInput(els.ruleExtract.value);
  } catch (e) {
    alert(e.message || String(e));
    return;
  }

  if (!selector) {
    alert('CSS selector is required to test the rule.');
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
      rule: { name, selector, urlTemplate, extract },
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
        response?.error || 'Unknown error'
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
      e.message || String(e)
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

init().catch(err => {
  console.error('Failed to init options', err);
  if (els.status) els.status.textContent = 'Error loading settings';
});
