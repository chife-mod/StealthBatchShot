# StealthBatchShot

Batch full-page screenshots of multiple URLs in true size (no compression), with support for lazy load, Responsive targeting (Desktop/Mobile), and stealth-antibot protection.

## Installation

```bash
npm install
npx playwright install
```

## Running the App

```bash
npm start
```

After starting, open your browser and go to:
[http://localhost:3000](http://localhost:3000)

## Features
- **Batch Processing**: Input multiple URLs via Enter or paste.
- **Stealth Mode**: Leverages Playwright with specific Chrome headers, timezone, locales, and injected anti-driver scripts to bypass basic bot protections.
- **Lazy Loading**: Automatically scrolls down the pages sequentially before capturing the screenshot.
- **No Compression**: Outputs raw 1:1 PNGs exactly as rendered without shrinking or cropping.
- **Saves directly to your Downloads folder** (`~/Downloads/`).
