import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Two things about the built tree are invisible to every other test in this suite, because
// both only misbehave once the app is running from a packaged asar rather than the dev
// server. Both shipped broken in the first installer, so they are pinned here.
//
// Like packagedOutputPath.test.ts, this reads the ACTUAL built dist/ tree (electron-builder
// packages dist/**/* into app.asar unchanged, so the relative layout here is the layout the
// packaged app sees), and skips rather than fails on a fresh checkout with no build yet.
const distDir = path.join(__dirname, '..', '..', 'dist');
const rendererIndex = path.join(distDir, 'renderer', 'index.html');
const preloadBundle = path.join(distDir, 'main', 'preload.js');
const built = fs.existsSync(rendererIndex) && fs.existsSync(preloadBundle);

describe.skipIf(!built)('packaged renderer assets (built dist tree)', () => {
  // The main process opens the renderer with `loadFile`, i.e. over file://. Vite's default
  // `base` of "/" emits <script src="/assets/index-<hash>.js">, which the browser resolves
  // against the FILESYSTEM ROOT (file:///assets/...) instead of the app directory -- so the
  // packaged app loaded a blank window with ERR_FILE_NOT_FOUND while dev, served over
  // http://localhost, worked fine. `base: './'` in vite.config.ts is what fixes it, and this
  // test fails if that setting is ever lost.
  it('references its assets relatively, so they resolve under file://', () => {
    const html = fs.readFileSync(rendererIndex, 'utf8');

    const urls = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((match) => match[1]);
    const localUrls = urls.filter((url) => !/^[a-z]+:/i.test(url) && !url.startsWith('//'));
    // Guard against a vacuous pass: the built page always references at least its own bundle,
    // so finding nothing to check means the regex stopped matching, not that the page is fine.
    expect(localUrls.length).toBeGreaterThan(0);

    expect(localUrls.filter((url) => url.startsWith('/'))).toEqual([]);

    for (const url of localUrls) {
      const resolved = path.join(path.dirname(rendererIndex), url.split('?')[0]);
      expect(fs.existsSync(resolved)).toBe(true);
    }
  });

  // `webPreferences` does not set `sandbox`, and Electron defaults it to true, so preload.js
  // runs sandboxed. A sandboxed preload gets a restricted `require` that resolves only a small
  // allowlist of built-in Electron/Node modules -- a relative require of a sibling file throws
  // "module not found" and the whole preload is dropped, leaving window.api undefined. tsc
  // emits preload.ts as a module that requires ../shared/ipcChannels, which is exactly that
  // case, so preload.ts is bundled by esbuild into one self-contained file instead.
  it('is bundled self-contained, as a sandboxed preload requires', () => {
    const preload = fs.readFileSync(preloadBundle, 'utf8');

    const specifiers = [...preload.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].map(
      (match) => match[1],
    );
    // The bundle always keeps `require("electron")` external, so an empty list means the
    // regex missed rather than that the bundle is clean.
    expect(specifiers).toContain('electron');

    const relative = specifiers.filter(
      (specifier) => specifier.startsWith('.') || specifier.startsWith('/'),
    );
    expect(relative).toEqual([]);
  });

  // The bundle is only self-contained if it actually inlined what it dropped the require for.
  it('inlines the IPC channel names it no longer requires', () => {
    const preload = fs.readFileSync(preloadBundle, 'utf8');

    expect(preload).toContain('bible:list-translations');
    expect(preload).toContain('song:find-by-title');
  });
});
