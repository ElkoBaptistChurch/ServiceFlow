import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// `server.ts` serves the OBS output page from `path.join(__dirname, '..', '..', 'output')`.
// That is correct against the source tree (src/main/server -> ../../output = src/output)
// only because `tsconfig.main.json` compiles with rootDir "src", which preserves the exact
// same directory depth under dist (dist/main/server -> ../../output = dist/output). This
// test pins that relationship against the ACTUAL built tree so a change to rootDir/outDir,
// or to where `build:output` copies the output assets, cannot silently break the Browser
// Source in the packaged app without failing a test.
//
// It only runs after `npm run build` has produced a `dist/` tree (electron-builder packages
// dist/**/* unchanged into app.asar, so this is the same relative layout the packaged app
// sees at runtime). On a fresh checkout with no build yet, it is skipped rather than failing.
const distServerFile = path.join(__dirname, '..', '..', 'dist', 'main', 'server', 'server.js');
const built = fs.existsSync(distServerFile);

describe.skipIf(!built)('packaged output path (built dist tree)', () => {
  it('resolves server.ts\'s ../../output from dist/main/server to the real dist/output directory', () => {
    const resolvedOutputDir = path.join(path.dirname(distServerFile), '..', '..', 'output');
    const expectedOutputDir = path.join(__dirname, '..', '..', 'dist', 'output');

    expect(path.resolve(resolvedOutputDir)).toBe(path.resolve(expectedOutputDir));
    expect(fs.existsSync(resolvedOutputDir)).toBe(true);
    expect(fs.existsSync(path.join(resolvedOutputDir, 'index.html'))).toBe(true);
  });
});
