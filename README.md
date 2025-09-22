# Image Enlarger - Chrome Extension

A Chromium Manifest V3 extension that displays larger images when hovering over images that are smaller than their actual dimensions, similar to Imagus.

## Features

- 🔍 **Smart Detection**: Only shows enlarged images for photos that are displayed smaller than their natural size
- ⚡ **Fast & Lightweight**: Minimal performance impact with efficient event handling
- 🎯 **Precise Positioning**: Intelligent positioning that adapts to screen edges
- 🌙 **Dark Mode Support**: Automatically adapts to system theme preferences
- ⌨️ **Keyboard Support**: Press Escape to hide the enlarged image
- 📱 **Responsive**: Works on any screen size

## How It Works

1. **Detection**: When you hover over an image, the extension checks if it's displayed smaller than its natural dimensions
2. **Threshold**: Only images scaled down by more than 20% trigger the enlargement
3. **Display**: After a 300ms delay, the full-size image appears near your cursor
4. **Positioning**: The overlay intelligently positions itself to stay within the viewport
5. **Hide**: Moving away, scrolling, clicking, or pressing Escape hides the overlay

## Installation

### Method 1: Developer Mode (Recommended for testing)

1. **Download/Clone** this repository to your computer
2. **Create Icons** (see `icons/README.md` for instructions)
3. **Open Chrome** and navigate to `chrome://extensions/`
4. **Enable Developer Mode** by toggling the switch in the top-right corner
5. **Click "Load unpacked"** and select the extension folder
6. **Confirm** the extension is installed and enabled

### Method 2: Chrome Web Store (Future)

_This extension could be published to the Chrome Web Store following Google's review process._

## File Structure

```
imagus/
├── manifest.json          # Extension configuration
├── content.js            # Main functionality script
├── styles.css            # Overlay styling
├── background.js         # Background service worker
├── icons/                # Extension icons
│   ├── icon16.png       # 16x16 toolbar icon
│   ├── icon48.png       # 48x48 management icon
│   ├── icon128.png      # 128x128 store icon
│   └── README.md        # Icon creation guide
└── README.md            # This file
```

## Technical Details

### Manifest V3 Features

- **Service Worker**: Uses modern background script architecture
- **Content Scripts**: Injects functionality into all web pages
- **Host Permissions**: Accesses all URLs to work on any website
- **ActiveTab Permission**: Minimal permission model for security

### Performance Optimizations

- **Event Delegation**: Efficient event handling for dynamic content
- **Hover Delay**: 300ms delay prevents accidental triggers
- **Image Caching**: Leverages browser's native image caching
- **Lazy Positioning**: Only calculates position when needed

### Browser Support

- ✅ Chrome 88+
- ✅ Edge 88+
- ✅ Opera 74+
- ✅ Other Chromium-based browsers

## Usage Tips

### Best Practices

- **Hover Duration**: Hold your mouse over an image for ~300ms to see the enlargement
- **Movement**: Small mouse movements won't hide the overlay, but leaving the image will
- **Keyboard**: Press `Esc` to quickly hide any enlarged image
- **Scrolling**: Scroll to automatically hide overlays

### Troubleshooting

- **No Enlargement**: The image might already be displayed at its natural size
- **Positioning Issues**: Try moving to a different area of the image
- **Performance**: The extension uses minimal resources, but you can disable it on specific sites if needed

## Development

### Local Development

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Test your changes

### Key Configuration

```javascript
const HOVER_DELAY = 300; // Milliseconds before showing enlarged image
const SCALE_THRESHOLD = 1.2; // Minimum scale factor (20% smaller) to trigger
```

### Customization

- **Hover Delay**: Modify `HOVER_DELAY` in `content.js`
- **Size Threshold**: Adjust the ratio checks in `isImageScaledDown()`
- **Styling**: Modify `styles.css` or the inline styles in `content.js`
- **Positioning**: Adjust the logic in `positionOverlay()`

## Privacy & Security

- **No Data Collection**: This extension doesn't collect, store, or transmit any user data
- **Local Processing**: All image analysis happens locally in your browser
- **Minimal Permissions**: Only requests necessary permissions for functionality
- **No External Requests**: Doesn't make network requests or contact external servers

## Contributing

Feel free to submit issues, feature requests, or pull requests to improve this extension!

## License

This project is open source. Feel free to use, modify, and distribute as needed.

## Changelog

### Version 1.0.0

- Initial release
- Basic hover functionality
- Smart image detection
- Responsive positioning
- Dark mode support
