# Quick Start Guide - Custom Rules

## What Are Custom Rules?

Custom rules let you find higher-quality versions of images that the extension can't normally detect. For example, YouTube shows small thumbnail images, but higher-resolution versions exist at predictable URLs.

## Creating Your First Custom Rule

### Step 1: Open Options

1. Click the extension icon or go to `chrome://extensions/`
2. Find "Imaginex" and click "Options"
3. Scroll down to the "Custom Rules" section

### Step 2: Click "Add New Rule"

A form will appear with several fields to fill out.

### Step 3: Fill Out the Rule

#### Rule Name

Give your rule a descriptive name like "YouTube Thumbnails" or "Product Images"

#### CSS Selector

This tells the extension which elements to match. Examples:

- `a#thumbnail img[src*="ytimg.com"]` - YouTube thumbnails
- `img.product-image` - Product images with that class
- `div[data-image-id]` - Divs with a data-image-id attribute

**Tip**: Use browser DevTools (F12) to inspect elements and test selectors

#### URL Template (optional)

A pattern for the high-quality image URL with placeholders:

- `https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp`
- `https://cdn.example.com/{productId}/large.jpg`

Leave empty if you're returning the full URL from JavaScript.

#### Custom JavaScript (required if no URL template)

Code to extract data from the matched element. The element is available as `element`.

**Example 1 - Return variables for template:**

```javascript
const videoId = element.src.match(/\/vi\/([^\/]+)\//)?.[1];
return videoId ? { videoId } : null;
```

**Example 2 - Return full URL:**

```javascript
const productId = element.dataset.productId;
if (!productId) return null;
return `https://example.com/products/${productId}/hd.jpg`;
```

### Step 4: Save the Rule

Click "Save Rule" and the rule will be added to your list.

### Step 5: Test It

1. Go to a website with matching elements (try `custom-rules-test.html` for testing)
2. Hover over an element that matches your selector
3. The high-quality image should appear!

## Pre-configured Example: YouTube

The extension comes with a YouTube rule already configured:

**Selector:** `a#thumbnail img[src*="i.ytimg.com"]`  
**URL Template:** `https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp`  
**Custom JS:**

```javascript
const match =
  element.src.match(/\/vi\/([^\/]+)\//) ||
  element.closest('a')?.href?.match(/[?&]v=([^&]+)/);
return match ? { videoId: match[1] } : null;
```

This extracts the video ID and generates a URL for the 1920x1080 thumbnail.

## Common Patterns

### Pattern 1: Extract from URL

```javascript
// Extract ID from image source
const id = element.src.match(/\/images\/(\d+)\//)?.[1];
return { id };
```

### Pattern 2: Extract from Data Attribute

```javascript
// Get ID from data attribute
const id = element.dataset.imageId;
return id ? { id } : null;
```

### Pattern 3: Modify Existing URL

```javascript
// Replace size parameter in URL
let url = element.src.replace('/small/', '/large/');
return url; // Return full URL
```

### Pattern 4: Navigate to Parent Element

```javascript
// Look at parent link for information
const link = element.closest('a');
const id = link?.href?.match(/id=(\d+)/)?.[1];
return { id };
```

## Troubleshooting

### Rule Not Working?

1. **Check the selector**: Open DevTools console and try:

   ```javascript
   document.querySelectorAll('your-selector-here');
   ```

   If nothing shows up, your selector doesn't match.

2. **Check console logs**: The extension logs debug messages:

   - "Element matches custom rule: [Name]"
   - "Custom rule generated URL: [URL]"
   - Look for error messages

3. **Test your JavaScript**: Try running it in the console:

   ```javascript
   const element = document.querySelector('your-selector');
   // Paste your custom JS here
   ```

4. **Verify the rule is enabled**: Check the toggle next to the rule name

### Common Mistakes

❌ **Forgot to return something**: Your JavaScript must return either an object or a URL string  
✅ `return { videoId }` or `return 'https://...'`

❌ **Selector too broad**: Matches too many elements  
✅ Make it more specific: add class names, attributes, or parent selectors

❌ **Missing null check**: Code crashes if data isn't found  
✅ Always check: `if (!id) return null;`

❌ **Template placeholder doesn't match variable name**  
✅ If template has `{videoId}`, return object must have `videoId` property

## Tips for Success

1. **Start Simple**: Begin with the URL template approach before trying complex JavaScript
2. **Test on Known Sites**: Use the provided test page or YouTube to verify things work
3. **One Rule at a Time**: Add rules one by one and test each before adding more
4. **Copy from Examples**: Use the examples in CUSTOM_RULES.md as templates
5. **Be Specific**: Narrow selectors prevent false matches and improve performance

## Need More Help?

- Read the full documentation: [CUSTOM_RULES.md](CUSTOM_RULES.md)
- Test your rules: [custom-rules-test.html](custom-rules-test.html)
- Check implementation details: [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md)

## Example Sites to Try

Once you've mastered custom rules, try creating rules for:

- **YouTube**: Video thumbnails (included by default)
- **Twitter/X**: Profile pictures and post images
- **Instagram**: Post images and stories
- **Reddit**: Image posts and thumbnails
- **Product sites**: E-commerce product images

Happy rule creating! 🎨
