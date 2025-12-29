# Quick Start Guide — Custom Rules

## What Are Custom Rules?

Custom rules help the extension find high‑quality images it can’t automatically detect. You can do this with no code (Target Page extraction) or with a small JavaScript snippet.

## Create Your First Rule

### 1) Open Options

1. Click the extension icon or go to `chrome://extensions/`.
2. Find “Imaginex” and click “Options”.
3. Open the “Custom Rules” section.

### 2) Click “Add New Rule”

Fill in the basics:

- **Rule Name**
- **CSS Selector**: which elements to match on the current page

Then choose one approach:

Option A — Target Page (no code):

- **Target Page URL Template**: usually `{href}` to follow the link
- **Target Page Selectors**: lines like `.article img | srcsetBest` or `img@src`
- **Max URLs**: 1 for single image, higher for galleries

Option B — Custom JavaScript:

- Provide a snippet that ultimately calls `returnURL(urlOrArray)` or `returnElement(el)`

Example userScript:

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

### 3) Save the Rule

Click “Save Rule”. Use domain filters if it’s site‑specific (e.g., add `*.example.com` to Allowed Domains). `Excluded` overrides `Allowed`.

### 4) Test It

1. Open a page with matching elements (YouTube or `custom-rules-test.html`).
2. Use “Test on Current Tab” or the popup tester.
3. Hover matching elements to see the enlarged image.

## Built‑in Helpers

- Target Page:
  - URL Template placeholders: `{href}`, `{src}`
  - Selector syntax: `css`, `css@attr`, `css | srcsetBest`
  - Absolute URL resolution and short‑term caching
- Custom JS:
  - `returnURL(urlOrArray)`: Provide a URL or an array (gallery)
  - `returnElement(el)`: Provide an img/picture/source; the extension picks the best `srcset`
  - `ctx.src`, `ctx.href`: Useful inputs from the matched element
  - `trigger`: Direct reference to the matched DOM element

## Troubleshooting

- Verify your selector matches (`document.querySelectorAll(...)`).
- For Target Page, start simple: `{href}` and `img | srcsetBest`.
- Check console logs. Target Page issues appear as fetch/parse errors; user scripts as `imagus:userScriptError`.
- Ensure you call `returnURL(...)` or `returnElement(...)` and guard for missing data if using Custom JS.
- Confirm the rule is enabled in Options.

## Tips

- Start simple; return existing high‑res URLs before doing complex logic.
- Keep selectors specific to avoid unintended matches.
- Use galleries (array of URLs) when multiple images are present.

## More

- Full docs: [CUSTOM_RULES.md](CUSTOM_RULES.md)
- Implementation notes: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
  Happy rule creating! 🎨
