# Image Enlarger Extension Icons

This folder should contain the following icon files:

- `icon16.png` - 16x16 pixels (for extension menu)
- `icon48.png` - 48x48 pixels (for extension management page)
- `icon128.png` - 128x128 pixels (for Chrome Web Store)

## Creating the Icons

You can create these icons using any graphics editor. Here's a simple design suggestion:

**Icon Design:**

- A magnifying glass with a small image/picture symbol inside
- Use a blue (#4285f4) magnifying glass with a colorful image symbol
- Keep the design simple and recognizable at small sizes

**SVG Template (save as SVG and export to PNG at required sizes):**

```svg
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <circle cx="50" cy="50" r="35" fill="none" stroke="#4285f4" stroke-width="8"/>
  <rect x="30" y="30" width="40" height="30" fill="#34a853" rx="3"/>
  <circle cx="40" cy="40" r="3" fill="#ea4335"/>
  <polygon points="50,50 55,45 60,55 50,55" fill="#fbbc04"/>
  <line x1="75" y1="75" x2="95" y2="95" stroke="#4285f4" stroke-width="8" stroke-linecap="round"/>
</svg>
```

## Quick Creation Method

If you don't have a graphics editor, you can:

1. Use an online SVG to PNG converter with the template above
2. Use any stock icon from icon libraries like:
   - Google Material Icons
   - Feather Icons
   - Font Awesome
3. Search for "magnifying glass" or "zoom" icons

Make sure to export/resize to exactly 16x16, 48x48, and 128x128 pixels for best results.
