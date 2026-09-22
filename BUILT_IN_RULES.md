# Built-in Rules System

## Overview

The extension now has a comprehensive built-in rules system that makes all hardcoded patterns and behaviors toggleable and maintainable. Each rule can be enabled/disabled individually from the options page, and triggering is logged to the console for debugging.

Built‑in rules also support per‑domain scoping so they only apply where relevant.

## Rule Categories

### Element Detection Patterns

These rules detect and handle various element types for image enlargement:

#### 1. Sibling Image Pattern

- **ID**: `sibling-image-pattern`
- **Description**: Detects overlay elements (like IMDb posters) and finds the adjacent image to display
- **Console Log**: `[Built-in Rule: Sibling Image Pattern] Found sibling image for trigger:`
- **Use Case**: When hovering over an overlay div that sits next to the actual image element

#### 2. Parent Anchor Image URL

- **ID**: `parent-anchor-image`
- **Description**: When an image is wrapped in a link pointing to an image, prefer the link target
- **Console Log**: `[Built-in Rule: Parent Anchor Image URL] Using anchor href:`
- **Use Case**: `<a href="high-res.jpg"><img src="thumbnail.jpg"></a>` - Shows the high-res version

#### 3. Anchor Image Links

- **ID**: `anchor-image-links`
- **Description**: Show images when hovering over links that point directly to image files
- **Console Log**: `[Built-in Rule: Anchor Image Links] Detected anchor link to image:`
- **Use Case**: Text links like `<a href="photo.jpg">View Image</a>`

#### 4. CSS Background Images

- **ID**: `background-image-css`
- **Description**: Display background-image CSS properties as enlargeable images
- **Console Log**: `[Built-in Rule: CSS Background Images] Detected background-image:`
- **Use Case**: Elements styled with `background-image: url(...)`

## How It Works

### Settings Storage

Built-in rules are stored in `settings.js` in the `builtInRules` array:

```javascript
builtInRules: [
  {
    id: 'sibling-image-pattern',
    name: 'Sibling Image Pattern',
    enabled: true,
    category: 'detection',
    description: 'Detects overlay elements...',
    allowDomains: ['*.example.com'],
    excludeDomains: ['ads.example.com'],
  },
  // ... more rules
];
```

### Runtime Behavior

1. **Loading**: On initialization, `content.js` loads rules from storage into a `Map` for fast lookup
2. **Checking**: Before applying any pattern, code calls `isRuleEnabled(ruleId)`
3. **Logging**: When a rule triggers, it logs to console with format: `[Built-in Rule: Name] Details...`
4. **CSS Application**: CSS fixes are dynamically generated based on enabled rules
5. **Domain Filters**: `isRuleEnabled` also considers `allowDomains`/`excludeDomains` for the current hostname

### Options Page UI

The options page has a dedicated "Built-in Rules" section with two subsections:

1. **Element Detection Patterns**: Toggle detection behaviors
   Each rule shows:

- Checkbox to enable/disable
- Name and description
- Real-time updates when toggled
- Allowed/Excluded Domains editor (supports wildcards like `*.example.com`)

#### Domain Filters

- **Allowed Domains**: If set, the rule only runs on matching hostnames.
- **Excluded Domains**: Rules never run on matching hostnames. Exclusions override Allowed.
- **Wildcards**: `*.example.com` matches `sub.example.com` and deeper; plain `example.com` matches that hostname and subdomains by suffix.

## Debugging

### Finding Which Rule Triggered

Open the browser console and look for logs starting with `[Built-in Rule: ...]`:

```
[Built-in Rule: Sibling Image Pattern] Found sibling image for trigger: <div>
[Built-in Rule: Parent Anchor Image URL] Using anchor href: https://example.com/high-res.jpg
[Built-in Rule: CSS Background Images] Detected background-image: url(...)
```

### Disabling Problematic Rules

If a rule causes issues on a specific site:

1. Open extension options
2. Navigate to "Built-in Rules"
3. Uncheck the problematic rule
4. Reload the affected page
5. Alternatively, add the site to Excluded Domains instead of disabling the rule globally

### Adding New Rules

To add a new built-in rule:

1. **Define in `settings.js`**: Add to `SETTINGS_DEFAULTS.builtInRules` array

   ```javascript
   {
     id: 'my-new-rule',
     name: 'My New Rule',
     enabled: true,
    category: 'detection'
     description: 'What this rule does',
     allowDomains: [], // optional
     excludeDomains: [] // optional
   }
   ```

2. **Implement in `content.js`**:

   ```javascript
   if (isRuleEnabled('my-new-rule')) {
     console.log('[Built-in Rule: My New Rule] Triggered');
     // ... your logic
   }
   ```

3. **Update UI**: Rules automatically appear in the options page based on category

## Benefits

### Maintainability

- All hardcoded patterns in one organized location
- Easy to add/remove/modify rules
- Clear separation of concerns

### Debuggability

- Named rules with descriptive logging
- Easy to trace which rule triggered behavior
- Toggleable for debugging

### User Control

- Users can disable problematic rules
- Per-site customization possible
- No need to uninstall extension for one bad rule

### Performance

- Rules stored in Map for O(1) lookup
- CSS generated once on load and when settings change
- Minimal overhead for disabled rules

## Migration from Hardcoded Patterns

All previously hardcoded patterns have been identified and converted:

- ✅ Sibling image pattern (IMDb overlays)
- ✅ Parent anchor preference
- ✅ Direct anchor image links
- ✅ Background-image CSS detection

No functionality was lost in the refactoring—all behaviors are preserved and now controllable.
