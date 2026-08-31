import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { load as loadYaml } from 'js-yaml';
import { minimatch } from 'minimatch';

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

  // The test above only checks the real dist/ tree on disk. It says nothing about what
  // electron-builder actually ships in the packaged app: that's governed entirely by the
  // `files` globs in electron-builder.yml. If those globs were ever narrowed (e.g. to
  // `dist/main/**/*`) so that `dist/output` fell out of the package, this file's other
  // test would keep passing while the shipped app 404s on the OBS Browser Source URL.
  // This test parses the real YAML and evaluates the real globs, with minimatch, against
  // the real built file list -- so it fails if the packaged app would actually stop
  // shipping the output assets, regardless of how the glob is spelled.
  it("electron-builder.yml's `files` globs actually match the built dist/output assets", () => {
    const repoRoot = path.join(__dirname, '..', '..');
    const builderConfigPath = path.join(repoRoot, 'electron-builder.yml');
    const builderConfig = loadYaml(fs.readFileSync(builderConfigPath, 'utf8')) as {
      files?: unknown;
    };

    const patterns = Array.isArray(builderConfig.files)
      ? builderConfig.files.filter((entry): entry is string => typeof entry === 'string')
      : [];
    expect(patterns.length).toBeGreaterThan(0);

    const outputDir = path.join(repoRoot, 'dist', 'output');
    const outputFiles = listFilesRecursive(outputDir, repoRoot);
    // Guard against a vacuous pass: if the built output directory were somehow empty,
    // "every file is included" would trivially be true without proving anything.
    expect(outputFiles.length).toBeGreaterThan(0);

    const notMatched = outputFiles.filter((relFile) => !isIncludedByGlobs(relFile, patterns));
    expect(notMatched).toEqual([]);
  });
});

/** Recursively lists files under `dir`, as paths relative to `base` with forward slashes. */
function listFilesRecursive(dir: string, base: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath, base));
    } else {
      files.push(path.relative(base, fullPath).split(path.sep).join('/'));
    }
  }
  return files;
}

/**
 * Applies electron-builder's glob semantics well enough to answer "would this file ship":
 * later patterns override earlier ones, and a leading `!` excludes matches instead of
 * including them.
 */
function isIncludedByGlobs(relFile: string, patterns: string[]): boolean {
  let included = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (minimatch(relFile, pattern.slice(1), { dot: true })) {
        included = false;
      }
    } else if (minimatch(relFile, pattern, { dot: true })) {
      included = true;
    }
  }
  return included;
}
