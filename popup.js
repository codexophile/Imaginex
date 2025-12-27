import { loadSettings } from './settings.js';

function $(id) {
  return document.getElementById(id);
}

function setOutput(text) {
  $('output').textContent = text;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tabs && tabs[0];
}

function formatResults(res) {
  if (!res) return 'No response (content script not reachable).';
  if (!res.ok) return `Error: ${res.error || 'Unknown error'}`;

  const lines = [];
  lines.push(`Matched elements: ${res.count}`);
  const results = Array.isArray(res.results) ? res.results.slice(0, 8) : [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const url = r.url || '(no url)';
    const unresolved = r.unresolvedPlaceholders
      ? ' [unresolved placeholders]'
      : '';
    const err = r.error ? ` [error: ${r.error}]` : '';
    lines.push(`\n#${i + 1}: ${url}${unresolved}${err}`);
    if (r.elementSummary) lines.push(`  ${r.elementSummary}`);
  }
  return lines.join('\n');
}

async function init() {
  const s = await loadSettings();
  const rules = (s.customRules || []).filter(r => r && r.enabled);
  const select = $('ruleSelect');

  if (rules.length === 0) {
    select.innerHTML = '<option value="">No enabled rules</option>';
  } else {
    select.innerHTML = rules
      .map(
        r =>
          `<option value="${r.id}">${(r.name || r.id).replace(
            /</g,
            '&lt;'
          )}</option>`
      )
      .join('');
  }

  $('openOptionsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });

  $('testBtn').addEventListener('click', async () => {
    try {
      const tab = await getActiveTab();
      if (!tab?.id) {
        setOutput('No active tab found.');
        return;
      }

      const ruleId = select.value;
      const rule = rules.find(r => r.id === ruleId);
      if (!rule) {
        setOutput('Select an enabled rule first.');
        return;
      }

      setOutput('Testing...');
      const res = await chrome.tabs.sendMessage(tab.id, {
        type: 'imagus:testRule',
        rule: {
          name: rule.name,
          selector: rule.selector,
          userScript: rule.userScript,
        },
      });

      setOutput(formatResults(res));
    } catch (e) {
      setOutput(`Test failed: ${e?.message || String(e)}`);
    }
  });
}

init().catch(e => setOutput(`Init failed: ${e?.message || String(e)}`));
