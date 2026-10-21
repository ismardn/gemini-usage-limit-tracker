# Gemini Usage Limit Tracker - WebExtension

A lightweight WebExtension (Manifest V3) that tracks and displays your real-time Google Gemini usage quota and reset countdown directly in the sidebar navigation.

---

## Purpose

- **Stay Informed**: Keep track of your active quota to avoid hitting query limits unexpectedly.
- **Clean Integration**: No heavy iframes or floating cards. The tracker blends naturally with Gemini's interface.
- **Multi-Account Support**: Automatically detects your active Google account from the URL (`/u/0/`, `/u/1/`, etc.) and updates when you switch accounts.

---

## Key Features

### 1. Responsive Interface
- **When Sidebar is OPEN**:
  - Shows a discrete progress bar above your chat list.
  - **Row 1**: Progress bar (`5px` height) with the current percentage (`45%`).
  - **Row 2**: Real-time remaining time countdown (`2h 15m remaining • 18:30`).
  - Color-coded:
    - **Green (< 60%)**: Normal usage.
    - **Orange (60% - 85%)**: Moderate consumption.
    - **Red (> 85%)**: Limit imminent.
- **When Sidebar is CLOSED**:
  - Collapses into a compact circular progress gauge (28px) next to the menu icon.
  - Shows a hover tooltip with your 5-hour usage and reset countdown.

### 2. Detailed Modal
Clicking the bar or the circular gauge opens a modal with:
- **5-Hour Window**: Progress bar, percentage used, remaining time, and exact reset time.
- **Weekly Limit**: Progress bar, percentage used, and weekly reset schedule.
- **Active Account**: Detected account index (`/u/X/`).
- **Refresh Settings**: Configurable update interval (5, 10, 15, or 30 minutes) with natural randomized jitter (±20s to 45s) to avoid predictable bot patterns.
- **Refresh Now**: Manual refresh button.

### 3. Toolbar Badge
- Real-time percentage badge and color-coded background on the WebExtension icon in your browser toolbar.
- Quick access popup dashboard.

---

## Installation (Developer Mode)

1. Open your browser's extensions page (e.g., `chrome://extensions`, `brave://extensions`, or `edge://extensions`).
2. Enable **Developer mode**.
3. Click **"Load unpacked"**.
4. Select this directory (the root folder containing `manifest.json`).
5. Visit [gemini.google.com](https://gemini.google.com) or reload your tab.

---

## How it works

```
┌────────────────────────────────────────────────────────┐
│                      manifest.json                     │
│               (Manifest V3, DeclarativeNetRequest)     │
└────────────┬─────────────────────────────┬─────────────┘
             │                             │
    ┌────────▼──────────┐        ┌─────────▼───────────┐
    │   background.js   │        │     rules.json      │
    │  (Alarms, Badges, │        │ (Removes X-Frame &  │
    │   Local Storage)  │        │   CSP on /usage)    │
    └────────┬──────────┘        └─────────┬───────────┘
             │                             │
             │           ┌─────────────────┘
    ┌────────▼───────────▼──────────┐
    │          content.js           │
    │  - Extracts active /u/X/ path │
    │  - Manages extraction iframe  │
    │  - Mounts bar & circle widget │
    │  - Computes live countdown    │
    └──────────────┬────────────────┘
                   │
    ┌──────────────▼────────────────┐
    │          extractor.js         │
    │  - Reads React Fiber state    │
    │  - Reads pools & reset times  │
    │  - Posts payload to parent    │
    └───────────────────────────────┘
```

1. **Header Stripping**: `rules.json` removes `x-frame-options` and CSP frame restrictions on `/usage` sub-frames, allowing secure background data retrieval.
2. **Background Extraction**: An invisible iframe loads the usage endpoint. `extractor.js` traverses the React Fiber virtual DOM (`__reactFiber$`) to extract raw state variables directly from memory. The iframe is then destroyed.
3. **Smart Triggering**: Updates automatically with pseudo-random jitter around your selected frequency, when switching accounts, and ~10 seconds after sending a message in chat.