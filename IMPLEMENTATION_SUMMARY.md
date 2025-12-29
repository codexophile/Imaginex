# Custom Rules Implementation Summary

## Overview

Custom rules enable users to define how the extension finds higher‑quality images for specific elements. There are two approaches:

1. Target Page extraction (no code): follow a URL (usually `{href}`) and extract images from the destination page using CSS selectors.
2. Custom JavaScript (code): run a sandboxed snippet that returns a URL, array of URLs, or a DOM element.

This covers elements without image tags, sites with low‑quality thumbnails but predictable high‑res URLs, and complex page structures.

## What Was Added

### 1. Settings Module (`settings.js`)

- Added `customRules` array to default settings (includes a YouTube example).
- Persistent storage under `__settings_v1` with merging of defaults and user edits.
- Built‑in rules catalog with toggle states and per‑rule domain filters (`allowDomains`/`excludeDomains`, wildcards supported).

### 2. Options Page UI (`options.html`)

- “Custom Rules” section with Add/Edit/Delete, enable/disable, and a tester.
- Target Page inputs: URL Template, Selectors (one per line, supports `@attr` and `| srcsetBest`), and Max URLs.
- “Built‑in Rules” section with detection behaviors and site‑specific CSS fixes, plus per‑rule domain editors.
- “Shortcuts” section to assign keyboard/mouse bindings for locked zoom toggle and zoom in/out.
- “Cloud Sync” section for manual Google Drive save/load.

### 3. Options Page Logic (`options.js`)

- Renders and manages custom rules, Target Page inputs, built‑in rules domain filters, shortcuts capture, and API keys.
- Sends `imagus:testRule` to the active tab for rule testing.
- Auto‑saves settings with debounced updates and subscribes to external changes.

### 4. Content Script (`content.js`)

- Event delegation for hover detection on `IMG`, `A`, and elements with `background-image`.
- Best source selection from `srcset`/`picture`/`source` or anchor `href` if it points to an image.
- Target Page extraction: builds target URL from a template, requests HTML via background, parses and extracts absolute image URLs from selectors; supports `@attr` and `| srcsetBest`; caches results briefly; supports gallery via Max URLs.
- Executes custom user scripts via background `userScripts` bridge; supports returning a single URL or an array (gallery).
- Overlay management with intelligent positioning, a loading spinner, gallery controls, and a **locked zoom mode** (pan + zoom).
- Built‑in rule gating via `isRuleEnabled(ruleId)` and dynamic CSS fixes injection.

### 5. Background Service Worker (`background.js`)

- Handles `imagus:execUserScript`, wraps code, and executes in `USER_SCRIPT` world.
- Handles `imagus:fetchHtml` to fetch target page HTML with credentials.
- Signals results to the page via DOM `CustomEvent` (URL or element selector).

### 6. Documentation

- Updated **CUSTOM_RULES.md** and **QUICK_START.md** to cover Target Page extraction, selector syntax, and gallery support, alongside `userScript` usage.
- **BUILT_IN_RULES.md** documents toggleable detection behaviors, CSS fixes, and domain filters with wildcard support.

## Execution Flow

1. User hovers an element.
2. `content.js` checks built‑in rules and custom rule selectors.
3. If a custom rule matches and has Target Page configured, it builds the target URL, fetches HTML via `background.js`, parses, extracts, and uses results if found.
4. Otherwise (or if no results), it asks `background.js` to execute the `userScript`.
5. The rule returns a URL (or array) or an element; `content.js` displays the image and optionally shows gallery controls.
6. User can toggle locked zoom, pan, and zoom via shortcuts or mouse wheel.

## Key Features

- Flexible detection across `IMG`, anchors, and CSS backgrounds.
- Best‑available image selection with `srcset` parsing.
- Toggleable built‑in rules with per‑domain controls.
- Custom rules via Target Page extractors or `userScript`, with gallery support.
- Locked zoom mode with precise panning and zooming.

## Files Modified / Created

- Modified: `settings.js`, `options.html`, `options.js`, `content.js`, `background.js`, `README.md`.
- Created/Updated docs: `CUSTOM_RULES.md`, `QUICK_START.md`, `BUILT_IN_RULES.md`.

## Testing Recommendations

1. Load the extension and open Options.
2. Verify Shortcuts and Built‑in Rules sections.
3. Ensure the default YouTube custom rule is enabled.
4. Use the rule tester on a YouTube page to validate.
5. Hover images and confirm overlay, gallery, and locked zoom behaviors.

## Technical Notes

- MV3 content scripts cannot import extension modules; `content.js` reads from `chrome.storage` and uses messaging.
- Custom JS executes via `userScripts` in page world; results are bridged with DOM events.
- Event delegation minimizes per‑element listeners; overlay sizing/positioning avoids relayouts.

## Summary

The implementation modernizes Imaginex with a robust, user‑script driven rule system, a toggleable built‑in rules framework, and improved UX features like locked zoom and galleries. Documentation and the Options UI provide clear guidance for configuration and testing.
