## Hourvest – Chrome Extension

**See the real cost of your purchases in hours of your life.**

Hourvest helps you rethink spending by converting Amazon prices into the time you’d need to work for them. Just set your hourly wage once, and the extension quietly overlays the “time cost” next to every price you see.

### Features

* **Time-Based Costing** – Instantly see prices in hours and minutes of your life.
* **Customizable Wage** – Enter your own hourly rate in the popup.
* **Auto-Save** – Your settings are stored locally and remembered.
* **Works Everywhere on Amazon** – Product pages, search results, and dynamic content.

### Installation (Manual)

Hourvest isn’t on the Chrome Web Store yet. To install:

1. Download or clone this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.

The extension will appear in your toolbar, ready to use.

### Usage

1. Click the Hourvest icon in the toolbar.
2. Enter your hourly wage and save.
3. Browse Amazon — time equivalents will appear next to prices (e.g., `≈ 2h 10m`).

### File Overview

* `manifest.json` – Extension configuration.
* `popup.html` – Settings popup UI.
* `popup.js` – Handles wage saving/loading.
* `content.js` – Injects time cost into Amazon pages.
* `icons/` – App and toolbar icons.
* `README.md` – Project documentation.
