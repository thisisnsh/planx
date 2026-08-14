#!/usr/bin/env node
// Renders scripts/og-image.html to site/public/images/planx-og-20260813.png at 1200x630.
//
// Development utility: requires a local Chrome. Override the binary with
// CHROME_BIN when it is not at the default macOS location.
//
//   node scripts/generate-og.js

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'scripts', 'og-image.html');
const target = join(root, 'site', 'public', 'images', 'planx-og-20260813.png');

const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const chrome = candidates.find((path) => existsSync(path));

if (!chrome) {
  console.error('No Chrome binary found. Set CHROME_BIN to a Chrome or Chromium executable.');
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'planx-og-'));

try {
  execFileSync(
    chrome,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-sync',
      '--virtual-time-budget=4000',
      // Render at 2x, then downsample, so the text edges stay crisp at 1200x630.
      '--force-device-scale-factor=2',
      '--window-size=1200,630',
      `--user-data-dir=${profile}`,
      `--screenshot=${target}`,
      pathToFileURL(source).href,
    ],
    { stdio: 'ignore', timeout: 120_000 },
  );
} catch (error) {
  // Headless Chrome writes the screenshot and then sometimes lingers. Only treat
  // this as fatal when no file landed.
  if (!existsSync(target)) throw error;
} finally {
  rmSync(profile, { recursive: true, force: true });
}

if (!existsSync(target)) {
  console.error('Chrome did not produce a screenshot.');
  process.exit(1);
}

// Downsample the 2x render to the 1200x630 Open Graph size.
try {
  execFileSync('sips', ['-z', '630', '1200', target], { stdio: 'ignore' });
} catch {
  console.warn('sips is unavailable; leaving the screenshot at its rendered size.');
}

console.log(`Wrote ${target}`);
