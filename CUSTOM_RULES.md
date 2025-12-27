# Custom Rules Guide

## Overview

Custom rules let you define how the extension finds higher‑quality images for specific elements. They run a small, sandboxed JavaScript snippet and must return either a URL string or an element for the extension to display.

## How Custom Rules Work

Each rule has:

1. **CSS Selector** (required): Which elements to match.
2. **Custom JavaScript** (required): Calls `returnURL(url)` or `returnElement(el)`.
3. **Domains (optional)**: `Allowed` and `Excluded` domains (supports wildcards).

### JavaScript Context

- `ctx.selector`: The selector that matched
- `ctx.src`: Element `src`/`currentSrc` if present
- `ctx.href`: Element `href` or closest link `href`
- `trigger`: DOM element that matched
- `log(...args)`: Debug helper (outputs to console)

You can also return an array of URLs to enable gallery navigation.

## Examples

### Example 1: YouTube Video Thumbnails

**Selector:**

```css
a#thumbnail img[src*="i.ytimg.com"]
```

**Custom JavaScript:**

```js
/* globals ctx, returnURL */
(() => {
  const m =
    (ctx.src || '').match(/\/(?:vi|vi_webp)\/([A-Za-z0-9_-]{11})/) ||
    (ctx.href || '').match(/[?&]v=([A-Za-z0-9_-]{11})/);
  const id = m && m[1];
  if (!id) return;
  returnURL('https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg');
})();
```

### Example 2: Twitter/X Images (rewrite URL)

**Selector:**

```css
img[src*="twimg.com"]
```

**Custom JavaScript:**

```js
/* globals ctx, returnURL */
(() => {
  const base = (ctx.src || '').replace(/\?.*$/, '');
  if (!base) return;
  returnURL(base + '?format=jpg&name=orig');
})();
```

### Example 3: Product Gallery (multiple URLs)

**Selector:**

```css
div.product-gallery
```

**Custom JavaScript:**

```js
/* globals trigger, returnURL */
(() => {
  const urls = Array.from(trigger.querySelectorAll('img'))
    .map(img => img.currentSrc || img.src)
    .filter(Boolean);
  if (urls.length) returnURL(urls);
})();
```

## Testing Rules

- Use the Options page “Test on Current Tab” button; it sends your selector/script to the active tab and lists matched elements and derived URLs.
- You can also open the popup on a page and run the tester there.

## Tips and Best Practices

- Be specific with selectors to avoid unexpected matches.
- Always guard for missing data (e.g., if no ID found, just `return;`).
- Prefer returning an element when you want the extension to auto‑select the best `srcset`.
- Use domain filters when a rule is site‑specific.

## Debugging

Open DevTools and watch console logs:

- `Custom rule matched:` when your selector triggers
- `Custom rule returned URL:` when your script returns
- Errors thrown in your script appear as `imagus:userScriptError`

## Security Note

Custom JS runs in a sandboxed page world via the `userScripts` API. It cannot access extension internals. Only add rules you trust; overly broad selectors may match unintended elements.
