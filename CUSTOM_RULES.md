# Custom Rules Guide

## Overview

Custom rules allow you to define how the extension should find higher-quality images for specific elements on web pages. This is useful when:

- Elements don't have image tags but link to images
- Images are low quality but better versions exist at predictable URLs
- You want to extract images from complex page structures

## How Custom Rules Work

Each custom rule has three main components:

### 1. **CSS Selector** (Required)

Defines which elements the rule should match. Examples:

- `a#thumbnail img[src*="ytimg.com"]` - YouTube thumbnail images
- `div.product-image` - Product images in a specific div
- `a[href*="instagram.com"] img` - Images in Instagram links

### 2. **URL Template** (Optional)

A template for generating the high-quality image URL. Use placeholders in curly braces `{}` that will be replaced with extracted variables. Examples:

- `https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp`
- `https://example.com/images/{productId}/large.jpg`

### 3. **Extract Rules (JSON)** (Optional)

Manifest V3 blocks running user-provided JavaScript (CSP blocks `unsafe-eval`), so rules use CSP-safe extractors.

An extractor is a JSON array. Each step:

- reads a value from one or more sources (`src`, `href`, `attr`, `closestAttr`)
- runs a regex against it
- stores the first capture group into a variable named by `var`

Advanced:

- You can set `mode` to `"srcsetBest"` to pick the highest-quality URL from a `srcset`-style string.
- You can use a source of type `closestQueryAttr` to extract from nearby DOM structures:
  it finds `element.closest(closest)` then `querySelector(selector)` within it, then reads an attribute/property by `name`.

Built-in variables are always available:

- `{src}`: element `src`/`currentSrc`
- `{href}`: element `href` or closest link `href`

## Examples

### Example 1: YouTube Video Thumbnails

**Selector:**

```css
a#thumbnail img[src*="i.ytimg.com"]
```

**URL Template:**

```
https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp
```

**Extract Rules (JSON):**

```json
[
  {
    "var": "videoId",
    "regex": "\\/vi(?:_webp)?\\/([^\\/]+)",
    "sources": [{ "type": "src" }]
  },
  {
    "var": "videoId",
    "regex": "[?&]v=([^&]+)",
    "sources": [{ "type": "href" }]
  },
  {
    "var": "videoId",
    "regex": "\\/(?:shorts|embed)\\/([^?\\/]+)",
    "sources": [{ "type": "href" }]
  }
]
```

### Example 2: Twitter/X Images

**Selector:**

```css
img[src*="twimg.com"]
```

**URL Template:**

```
{url}
```

**Extract Rules (JSON):**

This example extracts the full URL and rewrites it by matching the parts you care about.

```json
[
  {
    "var": "url",
    "regex": "^(https?:\\/\\/[^?#]+)(?:\\?.*)?$",
    "sources": [{ "type": "src" }]
  }
]
```

Then change the template on sites like X to the desired canonical form manually, e.g. append `?format=jpg&name=orig` in the template:

```
{url}?format=jpg&name=orig
```

### Example 3: Return Full URL (No Template Logic)

**Selector:**

```css
div.product-thumb
```

To return a full URL without composing multiple placeholders, set the URL template to `{url}` and extract a `url` variable.

**URL Template:**

```
{url}
```

**Extract Rules (JSON):**

```json
[
  {
    "var": "productId",
    "regex": "^(.+)$",
    "sources": [{ "type": "attr", "name": "data-product-id" }]
  }
]
```

Then compose the final URL with the template:

```
https://cdn.example.com/products/{productId}/highres.jpg
```

### Example 4: Instagram Posts

**Selector:**

```css
article img[src*="cdninstagram.com"]
```

**URL Template:**

```
{highResUrl}
```

Instagram URL rewriting is usually site-specific; prefer extracting stable identifiers from attributes and composing the CDN URL via template.

## Tips and Best Practices

1. **Test Your Selectors**: Use browser DevTools to test your CSS selectors before adding them to a rule.

2. **Specific is Better**: Make your selectors as specific as possible to avoid unwanted matches.

3. **Return null on Failure**: If extraction can't find the needed variables, the URL template will keep `{placeholders}` and the rule will be ignored.

4. **Check for Elements**: Use optional chaining (`?.`) when accessing properties that might not exist.

5. **URL Validation**: The extension doesn't validate URLs. Make sure your URL template and extracted variables produce valid URLs.

6. **Performance**: Keep regexes simple. Extraction can run often.

7. **Enable/Disable Rules**: Use the toggle in the options page to temporarily disable rules without deleting them.

## Common Placeholders

When using URL templates, common placeholder patterns include:

- `{videoId}` - Video identifiers
- `{productId}` - Product identifiers
- `{userId}` - User identifiers
- `{imageId}` - Image identifiers
- `{size}` - Size parameters (e.g., "large", "1920x1080")
- `{quality}` - Quality indicators (e.g., "hq", "maxres")

You can use any placeholder name that makes sense for your use case.

## Debugging

Check the browser console for log messages when hovering over elements:

- "Element matches custom rule: [Rule Name]"
- "Custom rule returned URL: [URL]"
- "Custom rule generated URL: [URL]"

- "Not all placeholders replaced in URL template: [URL]"

## Security Note

Because MV3 blocks executing custom JavaScript, extractors are declarative and CSP-safe. You should still only add rules you trust, since overly broad selectors can match unexpected elements.
