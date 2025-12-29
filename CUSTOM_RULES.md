# Custom Rules Guide

## Overview

Custom rules let you define how the extension finds higher‑quality images for specific elements. You can set them up in two ways:

- No‑code: Target Page extraction using URL templates and CSS selectors
- Code: A small sandboxed JavaScript snippet that returns a URL or element

Both approaches can also return multiple URLs to enable gallery navigation.

## How Custom Rules Work

Each rule has:

1. **CSS Selector** (required): Which elements on the current page to match.
2. One of the following (choose either):
   - **Target Page (recommended when a click opens a details page)**
     - **URL Template**: Where to fetch, e.g. `{href}` from the trigger
     - **Selectors**: How to extract image URLs from that page
     - **Max URLs**: Limit for gallery extraction
   - **Custom JavaScript**
     - Runs in a sandbox and must call `returnURL(url)` or `returnElement(el)`
3. **Domains (optional)**: `Allowed` and `Excluded` domains (supports wildcards like `*.example.com`).

Target Page extraction runs first. If configured and it finds results, the extension uses those. If not, it falls back to Custom JavaScript (if provided).

### Target Page Extraction

- **URL Template**: A small template that builds the target page URL from the trigger context. Most common placeholders:

  - `{href}`: The element `href` or closest link `href`
  - `{src}`: The element `src`/`currentSrc`
    If the template is just `{href}`, the extension will fetch the link destination page.

- **Selectors**: One per line. Each line can be:

  - `cssSelector` → pick best image from `srcset`/`src` (auto)
  - `cssSelector@attr` → take a specific attribute (e.g., `img@src`, `a@href`)
  - `cssSelector | srcsetBest` → shorthand to choose the best candidate from `srcset` if present

- **Max URLs**: Limits how many matches become a gallery. If 1, the first match is used.

- **Resolution**: All extracted links are resolved to absolute URLs using the fetched page URL as the base.

Notes:

- Extraction uses a background fetch with credentials and parses HTML safely (no scripts executed).
- Results are cached briefly to avoid repeated network calls on the same element.

### Custom JavaScript Context

- `ctx.selector`: The selector that matched
- `ctx.src`: Element `src`/`currentSrc` if present
- `ctx.href`: Element `href` or closest link `href`
- `trigger`: DOM element that matched
- `log(...args)`: Debug helper (outputs to console)

Your script must call `returnURL(urlOrArray)` or `returnElement(el)`. Returning an array of URLs enables gallery navigation.

## Examples

### Example 1: Target Page — Article Image

Use when the thumbnail links to an article/details page that contains the real images.

- **Selector:**

```css
a.card-thumb
```

- **Target Page**
  - URL Template: `{href}`
  - Selectors:

```
.article-content img | srcsetBest
```

- Max URLs: `1`

### Example 2: Target Page — Gallery

Extract multiple images to enable gallery navigation.

- **Selector:**

```css
a.gallery-link
```

- **Target Page**
  - URL Template: `{href}`
  - Selectors:

```
.gallery img | srcsetBest
```

- Max URLs: `12`

### Example 3: YouTube Video Thumbnails (Custom JS)

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

### Example 4: Twitter/X Images (rewrite URL)

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

### Example 5: Product Gallery (multiple URLs)

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

- Use the Options page “Test on Current Tab” button. It evaluates your rule (Target Page first, then Custom JS) on the active tab and lists matched elements and derived URLs.
- You can also open the popup on a page and run the tester there.

## Tips and Best Practices

- Be specific with selectors to avoid unexpected matches.
- For Target Page, start with `{href}` and a simple `img | srcsetBest` selector.
- Prefer returning an element when you want the extension to auto‑select the best `srcset`.
- Use domain filters when a rule is site‑specific. `Excluded` overrides `Allowed`.

## Debugging

Open DevTools and watch console logs:

- `Custom rule matched:` when your selector triggers
- Target Page fetch and parse messages; failures appear as `imagus:fetchHtml` errors
- `Custom rule returned URL:` when your script returns
- Errors thrown in your script appear as `imagus:userScriptError`

## Security Note

- Target Page fetches run in the background with your normal cookies to access pages as you would; HTML is parsed, not executed.
- Custom JS runs in a sandboxed page world via the `userScripts` API. It cannot access extension internals. Only add rules you trust; overly broad selectors may match unintended elements.
