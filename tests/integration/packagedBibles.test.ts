import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { load as loadYaml } from 'js-yaml';
import { bundledBiblesDir, listBundledCodes } from '../../src/main/content/bundledBibles';

// The bundled KJV ships outside app.asar via electron-builder's extraResources, and
// bundledBiblesDir() reads it from <resourcesPath>/bibles when packaged. Nothing at
// runtime connects the two except this test: if the yml mapping and the code's idea of
// the layout drift apart, a fresh install opens with no Bible at all.
const repoRoot = path.join(__dirname, '..', '..');

describe('packaged bundled-Bible layout', () => {
  it('electron-builder copies resources/bibles to the folder bundledBiblesDir reads when packaged', () => {
    const config = loadYaml(fs.readFileSync(path.join(repoRoot, 'electron-builder.yml'), 'utf8')) as {
      extraResources?: { from: string; to: string }[];
    };
    const entry = (config.extraResources ?? []).find((e) => path.normalize(e.from) === path.normalize('resources/bibles'));
    expect(entry).toBeDefined();

    // Simulate the packaged tree: <resourcesPath>/<to>/kjv.json.
    const resourcesPath = path.join('/', 'Program Files', 'ServiceFlow', 'resources');
    const shippedDir = path.join(resourcesPath, entry!.to);
    expect(bundledBiblesDir({ packaged: true, resourcesPath })).toBe(shippedDir);
  });

  it('ships a kjv.json from the source folder electron-builder copies', () => {
    expect(listBundledCodes(path.join(repoRoot, 'resources', 'bibles'))).toEqual(['KJV']);
  });

  // When the dist tree exists, the compiled module's own dev-path resolution must land on
  // the same folder as the source module's (rootDir "src" keeps the depth identical).
  const distModule = path.join(repoRoot, 'dist', 'main', 'content', 'bundledBibles.js');
  it.skipIf(!fs.existsSync(distModule))('resolves the dev path identically from the built dist tree', () => {
    const resolved = path.join(path.dirname(distModule), '..', '..', '..', 'resources', 'bibles');
    expect(path.resolve(resolved)).toBe(path.resolve(repoRoot, 'resources', 'bibles'));
  });
});
