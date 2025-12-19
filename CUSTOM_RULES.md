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

A template for generating the high-quality image URL. Use placeholders in curly braces `{}` that will be replaced with values from your custom JavaScript. Examples:

- `https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp`
- `https://example.com/images/{productId}/large.jpg`

### 3. **Custom JavaScript** (Optional)

JavaScript code to extract variables from the matched element. The code should:

- Have access to the matched element as `element`
- Return an object with variables for the URL template, OR
- Return the final URL as a string

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

**Custom JavaScript:**

```javascript
// Extract video ID from thumbnail URL or parent link
const match =
  element.src.match(/\/vi\/([^\/]+)\//) ||
  element.closest('a')?.href?.match(/[?&]v=([^&]+)/);
return match ? { videoId: match[1] } : null;
```

### Example 2: Twitter/X Images

**Selector:**

```css
img[src*="twimg.com"]
```

**URL Template:**

```
{imageUrl}
```

**Custom JavaScript:**

```javascript
// Get the original size image by modifying the URL
let url = element.src;
// Remove size parameters like ?format=jpg&name=small
url = url.replace(/\?.*$/, '') + '?format=jpg&name=orig';
return { imageUrl: url };
```

### Example 3: Return Full URL from JavaScript

**Selector:**

```css
div.product-thumb
```

**Custom JavaScript:**

```javascript
// Extract product ID from data attribute and construct URL
const productId = element.dataset.productId;
if (!productId) return null;

// Return the full URL directly (no template needed)
return `https://cdn.example.com/products/${productId}/highres.jpg`;
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

**Custom JavaScript:**

```javascript
// Instagram images have resolution indicators in URL
// Replace small/medium with large
let url = element.src;
url = url.replace(/\/s\d+x\d+\//, '/');
url = url.replace(/\/[a-z]\d+x\d+\//, '/');
return { highResUrl: url };
```

## Tips and Best Practices

1. **Test Your Selectors**: Use browser DevTools to test your CSS selectors before adding them to a rule.

2. **Specific is Better**: Make your selectors as specific as possible to avoid unwanted matches.

3. **Return null on Failure**: If your JavaScript can't extract the needed data, return `null` to prevent errors.

4. **Check for Elements**: Use optional chaining (`?.`) when accessing properties that might not exist.

5. **URL Validation**: The extension doesn't validate URLs. Make sure your custom JavaScript generates valid URLs.

6. **Performance**: Avoid complex JavaScript operations. The code runs on every matching element.

7. **Enable/Disable Rules**: Use the toggle in the options page to temporarily disable rules without deleting them.

## Common Placeholders

When using URL templates with custom JavaScript, common placeholder patterns include:

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

Look for error messages if your custom JavaScript has issues:

- "Error executing custom JS for rule: [Rule Name]"
- "Not all placeholders replaced in URL template: [URL]"

## Security Note

Custom JavaScript runs in the content script context with the same permissions as the extension. Only add custom rules from trusted sources or that you've written yourself.
