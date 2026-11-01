import { describe, it, expect } from 'vitest';
import { detectOpenlpFile } from '../../../src/main/import/detectOpenlpFile';
import { createFixtureSongsDb, createFixtureBibleDb } from '../../helpers/openlpFixtures';

describe('detectOpenlpFile', () => {
  it('identifies a songs database by its schema, not its filename', () => {
    const p = createFixtureSongsDb([{ title: 'X', lyrics: '<song/>' }]);
    expect(detectOpenlpFile(p)).toBe('songs');
  });

  it('identifies a bible database by its schema', () => {
    const p = createFixtureBibleDb('KJV', [{ id: 1, name: 'Genesis', testamentReferenceId: 1 }], []);
    expect(detectOpenlpFile(p)).toBe('bible');
  });

  it('returns unknown for anything else', () => {
    const p = createFixtureBibleDb('KJV', [], []);
    expect(['bible', 'unknown']).toContain(detectOpenlpFile(p));
  });
});
