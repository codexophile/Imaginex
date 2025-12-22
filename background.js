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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
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
            const trigger = (ctx && ctx.triggerSelector) ? document.querySelector(ctx.triggerSelector) : null;
            const returnURL = (u) => {
              try { document.dispatchEvent(new CustomEvent('imagus:userScriptURL', { detail: String(u) })); } catch (_) {}
            };
            const returnElement = (el) => {
              try {
                const token = 'imagus-return-' + Math.random().toString(36).slice(2);
                if (el && el.setAttribute) el.setAttribute('data-imagus-return', token);
                const sel = '[data-imagus-return="' + token + '"]';
                document.dispatchEvent(new CustomEvent('imagus:userScriptElement', { detail: sel }));
              } catch (_) {}
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
