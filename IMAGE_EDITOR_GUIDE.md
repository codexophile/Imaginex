# Image Editor Guide

The Imaginex extension now includes a powerful image editing feature directly integrated into the locked zoom mode.

## Accessing the Image Editor

1. **Hover** over any image that's smaller than its full size
2. **Enter locked zoom mode** using your configured keyboard shortcut or by clicking the lock icon
3. **Click the edit button** (✏️) in the top-right toolbar to open the image editor

## Editor Features

### Crop

- Click the **"Crop"** button to enter crop mode
- Click and drag on the image to define the crop area
- A green rectangle shows your selection
- Release the mouse to apply the crop

### Rotate

- **"↺ Rotate Left"**: Rotates the image 90° counter-clockwise
- **"Rotate Right ↻"**: Rotates the image 90° clockwise
- You can rotate multiple times to achieve any 90° increment angle

### Flip

- **"Flip H"**: Flips the image horizontally (mirror effect)
- **"Flip V"**: Flips the image vertically (upside down)
- Both can be combined for a 180° rotation effect

### Reset

- Click **"Reset"** to undo all edits and return to the original image
- This works at any point during editing

### Download

- Once you're happy with your edits, click **"Download"** to save the image
- The file is saved as `edited-image.png` to your default download folder
- The original image remains unchanged

### Close

- Click **"Close"** to exit the editor without saving
- Your edits are discarded when you close without downloading

## Technical Details

- **Client-side Processing**: All edits happen in your browser; no data is sent to any server
- **CORS Requirement**: Images must be served with proper CORS headers to work with the editor
- **Canvas-based**: Uses the HTML5 Canvas API for fast, real-time image manipulation
- **PNG Export**: Edited images are exported as PNG format for maximum compatibility

## Tips

- You can combine multiple operations (crop, rotate, flip) for complex edits
- The reset button allows you to experiment without worry
- Rotations are always in 90° increments for precision
- For very large images, the editor may take a moment to process rotations

## Limitations

- Images blocked by CORS policy cannot be edited
- Editing is temporary; all edits are lost when you close the editor without downloading
- Resize functionality is planned for a future update
