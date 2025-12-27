# Quick Start Guide — Custom Rules

## What Are Custom Rules?

Custom rules help the extension find high‑quality images it can’t automatically detect. You provide a CSS selector and a small JavaScript snippet that returns a URL or element.

## Create Your First Rule

### 1) Open Options

1. Click the extension icon or go to `chrome://extensions/`.
2. Find “Imaginex” and click “Options”.
3. Open the “Custom Rules” section.

### 2) Click “Add New Rule”

Fill in:

- **Rule Name**: e.g., “YouTube Thumbnails”.
- **CSS Selector**: e.g., `a#thumbnail img[src*="ytimg.com"]`.
- **Custom JavaScript**: must call `returnURL(url)` or `returnElement(el)`.

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

Click “Save Rule”. Use domain filters if it’s site‑specific.

### 4) Test It

1. Open a page with matching elements (YouTube or `custom-rules-test.html`).
2. Use “Test on Current Tab” or the popup tester.
3. Hover matching elements to see the enlarged image.

## Built‑in Helpers

- `returnURL(url)`: Provide an image URL (or array of URLs for galleries).
- `returnElement(el)`: Provide an img/picture/source; the extension picks the best `srcset`.
- `ctx.src`, `ctx.href`: Useful inputs from the matched element.
- `trigger`: Direct reference to the matched DOM element.

## Troubleshooting

- Verify your selector matches (`document.querySelectorAll(...)`).
- Check console logs (“Custom rule matched…”; errors appear as `imagus:userScriptError`).
- Ensure you call `returnURL(...)` or `returnElement(...)` and guard for missing data.
- Confirm the rule is enabled in Options.

## Tips

- Start simple; return existing high‑res URLs before doing complex logic.
- Keep selectors specific to avoid unintended matches.
- Use galleries (array of URLs) when multiple images are present.

## More

- Full docs: [CUSTOM_RULES.md](CUSTOM_RULES.md)
- Implementation notes: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)
  Happy rule creating! 🎨
