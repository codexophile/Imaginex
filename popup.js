import { loadSettings } from './settings.js';

function $(id) {
  return document.getElementById(id);
}

function setOutput(html) {
  $('output').innerHTML = html;
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  return tabs && tabs[0];
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function matchesDomain(pageUrl, allowedDomains, excludedDomains) {
  if (!pageUrl) return false;

  try {
    const hostname = new URL(pageUrl).hostname;

    // Check excluded domains first
    if (excludedDomains && excludedDomains.length > 0) {
      for (const pattern of excludedDomains) {
        if (matchDomainPattern(hostname, pattern.trim())) {
          return false;
        }
      }
    }

    // Check allowed domains (if specified)
    if (allowedDomains && allowedDomains.length > 0) {
      for (const pattern of allowedDomains) {
        if (matchDomainPattern(hostname, pattern.trim())) {
          return true;
        }
      }
      return false; // Has allowed list but didn't match
    }

    return true; // No restrictions or passed all checks
  } catch (e) {
    return false;
  }
}

function matchDomainPattern(hostname, pattern) {
  if (!pattern) return false;

  // Convert wildcard pattern to regex
  const regexPattern = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
  const regex = new RegExp(`^${regexPattern}$`, 'i');

  return regex.test(hostname);
}

function formatDomains(allowedDomains, excludedDomains) {
  const parts = [];

  if (allowedDomains && allowedDomains.length > 0) {
    parts.push(`Allowed: ${allowedDomains.join(', ')}`);
  }

  if (excludedDomains && excludedDomains.length > 0) {
    parts.push(`Excluded: ${excludedDomains.join(', ')}`);
  }

  return parts.length > 0 ? parts.join(' | ') : 'All domains';
}

// Check if content script is loaded and responsive
async function ensureContentScriptLoaded(tabId) {
  try {
    // Try to ping the content script
    await chrome.tabs.sendMessage(tabId, { type: 'imagus:ping' });
    return true; // Content script is already loaded
  } catch (e) {
    // Content script not loaded, inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      // Also inject the CSS
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['styles.css']
      });
      
      // Give it a moment to initialize
      await new Promise(resolve => setTimeout(resolve, 100));
      return true;
    } catch (injectionError) {
      console.error('Failed to inject content script:', injectionError);
      return false;
    }
  }
}

async function checkRuleMatches(tab, rule) {
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: 'imagus:testRule',
      rule: {
        name: rule.name,
        selector: rule.selector,
        userScript: rule.userScript,
      },
    });

    return res && res.ok ? res.count || 0 : 0;
  } catch (e) {
    return 0;
  }
}

function createRuleElement(rule, matchCount, pageUrl) {
  const matchesDomainFilter = matchesDomain(
    pageUrl,
    rule.allowedDomains,
    rule.excludedDomains,
  );

  const div = document.createElement('div');
  div.className = `rule-item${rule.enabled ? '' : ' disabled'}`;

  const name = document.createElement('div');
  name.className = 'rule-name';
  name.textContent = rule.name || rule.id || 'Unnamed Rule';

  if (!rule.enabled) {
    name.textContent += ' (Disabled)';
  }

  if (rule.isBlockingRule) {
    name.textContent += ' [Blocking]';
  }

  div.appendChild(name);

  // Selector
  if (rule.selector) {
    const selectorDiv = document.createElement('div');
    selectorDiv.className = 'rule-details';
    selectorDiv.innerHTML = `Selector: <span class="rule-selector">${escapeHtml(rule.selector)}</span>`;
    div.appendChild(selectorDiv);
  }

  // Match count
  const matchDiv = document.createElement('div');
  matchDiv.className = 'rule-details';
  matchDiv.textContent = `Matches: ${matchCount} element${matchCount !== 1 ? 's' : ''}`;
  div.appendChild(matchDiv);

  // Domain filter status
  if (!matchesDomainFilter) {
    const domainDiv = document.createElement('div');
    domainDiv.className = 'rule-details';
    domainDiv.style.color = '#e74c3c';
    domainDiv.textContent = '⚠️ Domain filter excludes this page';
    div.appendChild(domainDiv);
  }

  // Domains
  const domains = formatDomains(rule.allowedDomains, rule.excludedDomains);
  const domainDiv = document.createElement('div');
  domainDiv.className = 'rule-details';
  domainDiv.textContent = `Domains: ${domains}`;
  div.appendChild(domainDiv);

  return div;
}

async function init() {
  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      setOutput('<div class="no-rules">No active tab found.</div>');
      return;
    }

    if (
      !tab.url ||
      tab.url.startsWith('chrome://') ||
      tab.url.startsWith('about:')
    ) {
      setOutput(
        '<div class="no-rules">Extension cannot access this page.</div>',
      );
      return;
    }

    const s = await loadSettings();
    const rules = s.customRules || [];

    if (rules.length === 0) {
      setOutput(
        '<div class="no-rules">No custom rules configured.<br>Create rules in the Options page.</div>',
      );
      return;
    }

    setOutput('<div class="no-rules">Checking rules...</div>');

    // Ensure content script is loaded
    const contentScriptReady = await ensureContentScriptLoaded(tab.id);
    if (!contentScriptReady) {
      setOutput(
        '<div class="no-rules">Unable to load content script on this page.<br>Try refreshing the page.</div>',
      );
      return;
    }

    // Check each rule for matches
    const applicableRules = [];

    for (const rule of rules) {
      if (!rule || !rule.selector) continue;

      const matchCount = await checkRuleMatches(tab, rule);
      const matchesDomainFilter = matchesDomain(
        tab.url,
        rule.allowedDomains,
        rule.excludedDomains,
      );

      // Include rule if it has matches OR if it would match but domain filter excludes it
      if (matchCount > 0 || !matchesDomainFilter) {
        applicableRules.push({ rule, matchCount });
      }
    }

    if (applicableRules.length === 0) {
      setOutput(
        '<div class="no-rules">No rules match elements on this page.</div>',
      );
      return;
    }

    // Sort: enabled first, then by match count
    applicableRules.sort((a, b) => {
      if (a.rule.enabled !== b.rule.enabled) {
        return a.rule.enabled ? -1 : 1;
      }
      return b.matchCount - a.matchCount;
    });

    // Display results
    const container = document.createElement('div');
    for (const { rule, matchCount } of applicableRules) {
      container.appendChild(createRuleElement(rule, matchCount, tab.url));
    }

    setOutput(container.innerHTML);
  } catch (e) {
    setOutput(
      `<div class="no-rules">Error: ${escapeHtml(e?.message || String(e))}</div>`,
    );
  }
}

// Open Options button
$('openOptionsBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// Initialize on load
init();
