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
- You can use a source of type `xpath` to extract values via XPath evaluated relative to the matched element.

### XPath Shorthand (Optional)

If you find the JSON verbose, the Options UI also accepts a shorthand format:

- One step per line
- Optional assignment: `varName = ...` (defaults to `url`)
- Optional fallback: `expr1 || expr2 || expr3`
- Optional mode: append `| srcsetBest`

Examples:

```text
# pick best entry from a srcset string
url = xpath("ancestor::div[contains(@class,'relative')][1]//picture/source[@type='image/webp']/@data-srcset") | srcsetBest

# fall back to img src if the srcset isn't present
url = xpath("ancestor::div[contains(@class,'relative')][1]//picture/source[@type='image/webp']/@srcset") || xpath("ancestor::div[contains(@class,'relative')][1]//picture/img/@src")
```

### CSS Shorthand (Optional)

If you prefer CSS selectors:

```text
# within the matched element, querySelector then read attribute
url = qs("picture source[type='image/webp']@data-srcset") | srcsetBest

# find closest ancestor then query within it, read attribute
url = closest("div.relative.group", "picture img", "src")
```

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

## API Configuration (Optional)

For cases where high-quality images are only available through external APIs (like YouTube profile pictures, Twitter user avatars, etc), you can use API configuration instead of URL templates.

### API Structure

```json
{
  "url": "https://api.example.com?id={extractedVar}&key={settings.apiKeyName}",
  "path": "data.image.url",
  "headers": { "Authorization": "Bearer {settings.token}" }
}
```

- **url** (required): API endpoint URL with placeholders
- **path** (optional): JSON path to extract from response (e.g., `items[0].snippet.thumbnails.high.url`)
- **headers** (optional): Custom headers object with optional placeholders

### Placeholder Types

1. **Extracted variables**: `{variableName}` - from Extract Rules
2. **Settings keys**: `{settings.keyName}` - from API Keys section in Options

### Example: YouTube Channel Profile Pictures

YouTube channel profile pictures don't expose high-resolution sources in the DOM, but they're available via the YouTube Data API v3.

**Step 1: Get a YouTube Data API Key**

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable "YouTube Data API v3"
4. Create credentials → API Key
5. Add the key in the extension's Options page → API Keys section:
   - Name: `youtubeApiKey`
   - Value: Your API key

**Step 2: Create the Rule**

- **Name**: YouTube Channel Avatars
- **CSS Selector**: `img#avatar[src*="yt3.ggpht.com"]`
- **Extract Rules** (CSS shorthand):
  ```
  channelId = qs("a#avatar-link@href") ~ "/channel/([^/]+)"
  ```
  Or (JSON):
  ```json
  [
    {
      "var": "channelId",
      "regex": "/channel/([^/]+)",
      "sources": [
        {
          "type": "cssQueryAttr",
          "closest": "ytd-video-owner-renderer",
          "selector": "a#avatar-link",
          "name": "href"
        }
      ]
    }
  ]
  ```
- **API Configuration**:
  ```json
  {
    "url": "https://www.googleapis.com/youtube/v3/channels?part=snippet&id={channelId}&key={settings.youtubeApiKey}",
    "path": "items[0].snippet.thumbnails.high.url"
  }
  ```

Now when you hover over channel avatars, the extension will:

1. Extract the channel ID from the avatar link
2. Call YouTube Data API with your key
3. Extract the high-quality thumbnail URL from the response
4. Display the enlarged image

### API Features

- **Caching**: API responses are cached for 5 minutes to reduce unnecessary requests
- **Rate Limiting**: 10 requests per minute per domain to avoid hitting API limits
- **Security**: API keys are stored locally and never leave your browser except in API calls you configure

### Other API Examples

**Twitter User Avatars** (if you have Twitter API access):

```json
{
  "url": "https://api.twitter.com/2/users/by/username/{username}?user.fields=profile_image_url",
  "path": "data.profile_image_url",
  "headers": { "Authorization": "Bearer {settings.twitterBearerToken}" }
}
```

**Generic REST API**:

```json
{
  "url": "https://api.service.com/v1/images/{imageId}",
  "path": "high_res_url"
}
```

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
