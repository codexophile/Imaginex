// Background script for Image Enlarger extension
// This runs as a service worker in Manifest V3

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    console.log('Image Enlarger extension installed');
  } else if (details.reason === 'update') {
    console.log('Image Enlarger extension updated');
  }
});

// Handle extension startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Image Enlarger extension started');
});

// API Proxy: caching and rate limiting
const apiCache = new Map(); // urlHash -> {data, expires}
const rateLimits = new Map(); // domain -> {count, resetTime}
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const RATE_LIMIT = 10; // requests per minute per domain
const RATE_WINDOW = 60 * 1000; // 1 minute

function getJsonPath(obj, path) {
  if (!path) return obj;
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let result = obj;
  for (const key of keys) {
    if (result == null) return null;
    result = result[key];
  }
  return result;
}

function getDomain(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

function checkRateLimit(domain) {
  const now = Date.now();
  const limit = rateLimits.get(domain);
  if (!limit || now > limit.resetTime) {
    rateLimits.set(domain, { count: 1, resetTime: now + RATE_WINDOW });
    return true;
  }
  if (limit.count >= RATE_LIMIT) {
    return false;
  }
  limit.count++;
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'imagus:fetchApi') {
    (async () => {
      try {
        const { url, path, headers } = msg;
        if (!url) throw new Error('Missing API URL');

        // Check cache
        const cacheKey = url;
        const cached = apiCache.get(cacheKey);
        if (cached && Date.now() < cached.expires) {
          sendResponse({ ok: true, data: cached.data });
          return;
        }

        // Check rate limit
        const domain = getDomain(url);
        if (!checkRateLimit(domain)) {
          sendResponse({
            ok: false,
            error: 'Rate limit exceeded for ' + domain,
          });
          return;
        }

        // Fetch
        const opts = { method: 'GET' };
        if (headers && typeof headers === 'object') {
          opts.headers = headers;
        }
        const res = await fetch(url, opts);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        // Extract path
        const data = path ? getJsonPath(json, path) : json;
        if (!data) throw new Error('Path not found in response');

        // Cache
        apiCache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL });
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true; // async
  }
  // Execute user-provided JavaScript in USER_SCRIPT world
  if (msg.type === 'imagus:execUserScript') {
    (async () => {
      try {
        const tabId = sender?.tab?.id || msg.tabId;
        if (!tabId) throw new Error('No tabId to execute user script');
        const codeStr = String(msg.code || '').trim();
        const ctxObj = msg.ctx || {};
        if (!codeStr) throw new Error('Empty user script');

        const wrapped = `(() => {
          try {
            const ctx = ${JSON.stringify(ctxObj)};
            const returnURL = (u) => {
              try { document.dispatchEvent(new CustomEvent('imagus:userScriptURL', { detail: String(u) })); } catch (_) {}
            };
            const log = (...a) => { try { document.dispatchEvent(new CustomEvent('imagus:userScriptLog', { detail: a })); } catch (_) {} };
            ${codeStr}
          } catch (e) {
            try { document.dispatchEvent(new CustomEvent('imagus:userScriptError', { detail: String(e && e.message || e) })); } catch (_) {}
          }
        })();`;

        if (!chrome?.userScripts?.execute) {
          sendResponse({
            ok: false,
            error:
              'userScripts API unavailable. Enable userScripts permission.',
          });
          return;
        }
        await chrome.userScripts.execute({
          target: { tabId },
          world: 'USER_SCRIPT',
          js: [{ code: wrapped }],
        });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || String(err) });
      }
    })();
    return true; // async
  }
});

// Optional: Add context menu or browser action functionality in the future
// This background script is minimal for now but provides a foundation for future features
