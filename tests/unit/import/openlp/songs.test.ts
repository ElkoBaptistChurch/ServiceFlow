import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../../../src/main/db/schema';
import { importOpenlpSongs } from '../../../src/main/import/openlpSongsImporter';
import { createFixtureSongsDb } from '../../helpers/openlpFixtures';
import { getBlocksForSong, findSongsByTitle } from '../../../src/main/db/songRepository';
import { searchSongContent } from '../../../src/main/db/songRepository';

const ALL_CREATURES_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[All creatures of our God and King,
Lift up your voice and with us sing:]]></verse><verse type="c" label="1"><![CDATA[O praise Him, O praise Him,
Hallelujah, hallelujah, hallelujah!]]></verse><verse type="v" label="2"><![CDATA[Thou rushing wind that art so strong.]]></verse></lyrics></song>`;

let mainDb: Database.Database;

beforeEach(() => {
  mainDb = new Database(':memory:');
  applySchema(mainDb);
});

// Real row, trimmed: six blocks, three distinct (type,label) pairs.
const HOW_SWEET_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[How sweet the name of Jesus sounds]]></verse><verse type="v" label="1"><![CDATA[It makes the wounded spirit whole]]></verse><verse type="v" label="2"><![CDATA[Dear name, the rock on which I build]]></verse><verse type="v" label="2"><![CDATA[Jesus! My Shepherd, Saviour, Friend]]></verse><verse type="v" label="3"><![CDATA[Weak is the effort of my heart]]></verse><verse type="v" label="3"><![CDATA[Till then I would Thy love proclaim]]></verse></lyrics></song>`;

const CURLY_APOSTROPHE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[In a believer’s ear!]]></verse></lyrics></song>`;

describe('importOpenlpSongs', () => {
  it('imports songs and their blocks in document order', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML, ccliNumber: '12345' },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.kind).toBe('songs');
    expect(summary.errors).toHaveLength(0);
    const song = findSongsByTitle(mainDb, 'All Creatures')[0];
    const blocks = getBlocksForSong(mainDb, song.id);
    expect(blocks.map((b) => b.label)).toEqual(['Verse 1', 'Chorus 1', 'Verse 2']);
  });

  // Guards the "How Sweet the name of Jesus Sounds" data shape: keying blocks by
  // label instead of position would silently import three of these six blocks.
  it('keeps every block when a song repeats a (type,label) pair', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'How Sweet the name of Jesus Sounds', lyrics: HOW_SWEET_XML },
    ]);

    importOpenlpSongs(mainDb, fixturePath);

    const song = findSongsByTitle(mainDb, 'How Sweet')[0];
    const blocks = getBlocksForSong(mainDb, song.id);
    expect(blocks).toHaveLength(6);
    expect(blocks[1].text).toContain('It makes the wounded spirit whole');
    expect(blocks.map((b) => b.displayOrder)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('is idempotent — re-importing upserts rather than duplicates', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);

    importOpenlpSongs(mainDb, fixturePath);
    importOpenlpSongs(mainDb, fixturePath);

    expect(findSongsByTitle(mainDb, 'All Creatures')).toHaveLength(1);
    const song = findSongsByTitle(mainDb, 'All Creatures')[0];
    expect(getBlocksForSong(mainDb, song.id)).toHaveLength(3);
  });

  it('drops blocks that no longer exist in the OpenLP source', () => {
    const before = createFixtureSongsDb([{ title: 'Shrinking Song', lyrics: ALL_CREATURES_XML }]);
    importOpenlpSongs(mainDb, before);

    const after = createFixtureSongsDb([
      {
        title: 'Shrinking Song',
        lyrics:
          '<?xml version="1.0"?><song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Only one left]]></verse></lyrics></song>',
      },
    ]);
    importOpenlpSongs(mainDb, after);

    const song = findSongsByTitle(mainDb, 'Shrinking')[0];
    expect(getBlocksForSong(mainDb, song.id)).toHaveLength(1);
  });

  it('indexes typographic apostrophes so an ASCII query finds them', () => {
    const fixturePath = createFixtureSongsDb([{ title: 'How Sweet', lyrics: CURLY_APOSTROPHE_XML }]);
    importOpenlpSongs(mainDb, fixturePath);
    expect(searchSongContent(mainDb, "believer's").length).toBeGreaterThan(0);
  });

  it('makes imported lyrics searchable via FTS', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);
    importOpenlpSongs(mainDb, fixturePath);
    const results = searchSongContent(mainDb, 'Hallelujah');
    expect(results.length).toBeGreaterThan(0);
  });

  it('skips a malformed row and reports it without aborting the rest', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'Broken Song', lyrics: 'not xml at all' },
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    expect(summary.errors[0].identifier).toBe('Broken Song');
    expect(findSongsByTitle(mainDb, 'All Creatures')).toHaveLength(1);
  });

  // Fix round 1 (minor, ride-along): a NULL lyrics cell must not surface a raw JS
  // TypeError ("Cannot read properties of null...") to a non-technical volunteer
  // reading the import summary.
  it('reports a plain-language reason for a song with no lyrics data', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'No Lyrics Song', lyrics: null },
      { title: 'All Creatures of our God and King', lyrics: ALL_CREATURES_XML },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(1);
    expect(summary.skipped).toBe(1);
    const badRow = summary.errors.find((e) => e.identifier === 'No Lyrics Song');
    expect(badRow).toBeDefined();
    expect(badRow!.reason).toBe('song has no lyrics data');
    expect(badRow!.reason).not.toMatch(/cannot read properties/i);
  });

  // I-01: OpenLP does not enforce a unique title (two arrangements of the same hymn is
  // routine in a real church library), but this app's songs.title is UNIQUE. Without
  // disambiguation the second row's upsert silently deletes the first row's blocks
  // while still reporting both as imported.
  it('does not overwrite a song when a later row has the same title', () => {
    const fixturePath = createFixtureSongsDb([
      { title: 'Amazing Grace', lyrics: ALL_CREATURES_XML, ccliNumber: '111' },
      { title: 'Amazing Grace', lyrics: HOW_SWEET_XML, ccliNumber: '222' },
    ]);

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(summary.imported).toBe(2);
    const songs = findSongsByTitle(mainDb, 'Amazing Grace');
    expect(songs).toHaveLength(2);
    const blockSets = songs.map((s) => getBlocksForSong(mainDb, s.id).map((b) => b.text));
    // Both arrangements' blocks survive somewhere — neither was wiped by the other.
    expect(blockSets.some((texts) => texts.some((t) => t.includes('All creatures')))).toBe(true);
    expect(blockSets.some((texts) => texts.some((t) => t.includes('How sweet the name')))).toBe(true);
  });

  // I-12: SQLite's default BINARY collation treats these as three distinct rows, but
  // findSongsByTitle's LIKE is case-insensitive, so they'd appear together in search
  // results with no way to tell them apart.
  it('treats titles differing only in whitespace as the same song', () => {
    const fixturePath = createFixtureSongsDb([
      { title: '  Amazing Grace  ', lyrics: ALL_CREATURES_XML },
    ]);

    importOpenlpSongs(mainDb, fixturePath);

    const songs = findSongsByTitle(mainDb, 'Amazing Grace');
    expect(songs).toHaveLength(1);
    expect(songs[0].title).toBe('Amazing Grace');
  });

  // D-12: editing a song's title in OpenLP between imports must not silently orphan
  // the old row forever — the operator needs to be told, and nothing gets deleted
  // without asking.
  it('reports songs that no longer exist in the source file', () => {
    const fixturePath = createFixtureSongsDb([{ title: 'Original Title', lyrics: ALL_CREATURES_XML }]);
    importOpenlpSongs(mainDb, fixturePath);

    // Simulate the volunteer renaming the song inside OpenLP, then re-importing the
    // same database file.
    const source = new Database(fixturePath);
    source.prepare(`UPDATE songs SET title = ? WHERE title = ?`).run('Renamed Title', 'Original Title');
    source.close();

    const summary = importOpenlpSongs(mainDb, fixturePath);

    expect(findSongsByTitle(mainDb, 'Original Title')).toHaveLength(1); // not deleted
    expect(findSongsByTitle(mainDb, 'Renamed Title')).toHaveLength(1);
    const orphanNotice = summary.errors.find((e) => e.identifier === 'Original Title');
    expect(orphanNotice).toBeDefined();
  });
});
