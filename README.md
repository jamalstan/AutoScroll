# Shorts Auto-Advance (Chrome MV3 Extension)

Automatically advance to the next YouTube Short when the current one ends, instead of looping/replaying.

## Features
- Detects when a YouTube Short ends and moves to the next Short
- Handles YouTube's SPA navigation and dynamic DOM updates
- Popup toggle to enable/disable behavior (saved with chrome.storage)

## Install (Load Unpacked)
1. Open Chrome → go to `chrome://extensions`.
2. Enable "Developer mode" (top-right).
3. Click "Load unpacked" and select this folder.
4. Navigate to a YouTube Shorts URL like `https://www.youtube.com/shorts/VIDEO_ID`.
5. Use the extension action popup to enable/disable as needed.

## Files
- `manifest.json`: MV3 config
- `content.js`: Content script that binds to the active Shorts video and advances on end
- `popup.html`, `popup.js`: Simple UI to toggle the feature

## Packaging for the Chrome Web Store
- Zip the folder contents (not the folder itself), e.g. `manifest.json`, `content.js`, `popup.html`, `popup.js`, `README.md`, etc.
- In the Chrome Web Store Developer Dashboard, create a new item and upload the zip.
- Provide store listing details (screenshots, description, icons). Note: This repo doesn't include icons—upload them via the store listing (128x128 required; also prepare 16/32/48/128 for best practice).

## Notes
- This extension only runs on `*://*.youtube.com/shorts/*` pages.
- If YouTube changes their DOM, the script tries multiple strategies (Next button, ArrowDown, wheel fallback). If navigation breaks, update `content.js` selectors.

## Privacy
- No network requests. No analytics. Uses only `chrome.storage.sync` to keep the toggle state.
