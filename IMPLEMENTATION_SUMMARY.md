# Custom Rules Implementation Summary

## Overview

Added a comprehensive custom rules system that allows users to define how the extension should find higher-quality images for specific HTML elements. This is particularly useful for:

- Elements without image tags that link to images
- Low-quality images where better versions exist at predictable URLs
- Complex page structures requiring custom logic

## What Was Added

### 1. Settings Module (`settings.js`)

- Added `customRules` array to default settings
- Includes an example YouTube thumbnail rule pre-configured
- Rules persist across browser sessions

### 2. Options Page UI (`options.html`)

- New "Custom Rules" section with:
  - List of all defined rules with enable/disable toggles
  - Add/Edit/Delete rule functionality
  - Form for creating/editing rules with validation
  - Visual feedback for rule status
- Responsive design matching the existing options page style

### 3. Options Page Logic (`options.js`)

- Functions to render, add, edit, delete, and toggle custom rules
- Real-time updates when rules are modified
- Form validation to ensure required fields are filled
- Integration with the settings module for persistence

### 4. Content Script (`content.js`)

- Custom rule matching engine using CSS selectors
- JavaScript execution sandbox for extracting data from elements
- URL template system with placeholder replacement
- Support for both IMG and non-IMG elements
- Integration with existing hover detection system
- Debug logging for troubleshooting
- Automatic preference for parent anchor href when hovering an `img` inside a link if the `href` is an image URL (uses higher-resolution link targets by default without needing a custom rule)

### 5. Documentation

- **CUSTOM_RULES.md**: Comprehensive guide with:
  - How custom rules work
  - Component explanations (selector, template, JavaScript)
  - Multiple real-world examples
  - Tips and best practices
  - Debugging guide
  - Security considerations
- **custom-rules-test.html**: Test page with:
  - Multiple test scenarios
  - YouTube thumbnail examples
  - Product image examples
  - Non-IMG element examples
  - Instructions and debugging tips

### 6. README Updates

- Added custom rules to features list
- Documented the custom rules section
- Included example usage
- Updated file structure

## How It Works

### Rule Structure

Each custom rule consists of:

```javascript
{
  id: 'unique-id',
  name: 'Rule Name',
  enabled: true,
  selector: 'CSS selector',
  urlTemplate: 'https://example.com/{placeholder}',
  extract: [
    { var: 'placeholder', regex: '...', sources: [{ type: 'src' }] }
  ]
}
```

### Execution Flow

1. User hovers over an element
2. Extension checks if element matches any enabled custom rule's CSS selector
3. If matched, runs CSP-safe extractor steps (`extract`) to produce variables
4. Placeholders in the URL template are replaced with extracted variables
5. Final URL is used to display the high-quality image

### Example: YouTube Thumbnails

```javascript
// Rule Configuration
{
  selector: 'a#thumbnail img[src*="i.ytimg.com"]',
  urlTemplate: 'https://i.ytimg.com/vi_webp/{videoId}/maxresdefault.webp',
  extract: [
    { var: 'videoId', regex: '\\/vi(?:_webp)?\\/([^\\/]+)', sources: [{ type: 'src' }] }
  ]
}

// Execution
// 1. User hovers over YouTube thumbnail
// 2. Selector matches the thumbnail image
// 3. Extractor extracts video ID: "dQw4w9WgXcQ"
// 4. Template generates: https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp
// 5. Extension displays 1920x1080 thumbnail instead of default 320x180
```

## Key Features

### Flexibility

- Works with any HTML element (img, div, a, etc.)
- CSS selectors provide powerful element matching
- Extract rules provide CSP-safe data extraction
- URL templates make common patterns easy to define

### User Experience

- Intuitive UI for managing rules
- Enable/disable without deleting
- Edit existing rules
- Visual feedback on rule status
- Pre-configured example rule

### Developer Experience

- Comprehensive documentation with examples
- Test page for validation
- Console logging for debugging
- Error handling for invalid rules

### Security

- JavaScript executes in content script context
- Sandboxed execution (Function constructor)
- No eval() usage
- Clear security note in documentation

## Files Modified

1. **settings.js**: Added customRules to defaults
2. **options.html**: Added custom rules UI section with styles
3. **options.js**: Added rule management functions and event handlers
4. **content.js**: Added rule matching, execution, and image loading logic
5. **README.md**: Updated features and documentation

## Files Created

1. **CUSTOM_RULES.md**: Complete user guide
2. **custom-rules-test.html**: Test page with examples

## Testing Recommendations

1. **Load the extension** with the updated code
2. **Open options page** and verify the custom rules section appears
3. **Check the default YouTube rule** is present and enabled
4. **Open custom-rules-test.html** to test various scenarios
5. **Hover over test images** and check console for debug messages
6. **Try creating new rules** with the test page examples
7. **Test enable/disable** toggle functionality
8. **Verify rule persistence** by closing and reopening the browser

## Future Enhancements

Potential improvements for future versions:

- Rule import/export functionality
- Rule sharing community/marketplace
- Visual rule builder (point-and-click selector)
- Rule testing interface within options page
- Pre-configured rule library for popular sites
- Performance metrics per rule
- Rule execution timeout limits
- Regex support in URL templates

## Technical Notes

### Performance Considerations

- Rules are filtered to only enabled ones
- CSS selector matching is native and fast
- Custom JS execution is synchronous but should be quick
- No external network requests for rule processing

### Browser Compatibility

- Uses modern JavaScript features (arrow functions, template literals, optional chaining)
- Compatible with all Chromium-based browsers supporting MV3
- CSS selector matching uses native `element.matches()`

### Error Handling

- Try-catch blocks around rule execution
- Graceful degradation if rule fails
- Console warnings for debugging
- Null checks for missing data

## Summary

This implementation provides a powerful and flexible system for users to define custom rules for finding higher-quality images. It maintains the extension's simplicity while adding advanced functionality for power users. The comprehensive documentation and test page make it easy for users to understand and create their own rules.
