import { describe, it, expect } from 'vitest';
import { parseSongLyrics, typeCodeToName } from '../../../src/main/import/songXml';

const ABIDE_WITH_ME_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[Abide with me, fast falls the eventide;
The darkness deepens, Lord, with me abide;
When other helpers fail and comforts flee,
Help of the helpless, O abide with me.]]></verse><verse type="v" label="2"><![CDATA[Swift to its close ebbs out life's little day;
Earth's joys grow dim, its glories pass away;
Change and decay in all around I see;
O Thou who changest not, abide with me.]]></verse></lyrics></song>`;

const ALL_CREATURES_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[All creatures of our God and King,
Lift up your voice and with us sing:]]></verse><verse type="c" label="1"><![CDATA[O praise Him, O praise Him,
Hallelujah, hallelujah, hallelujah!]]></verse><verse type="v" label="2"><![CDATA[Thou rushing wind that art so strong,
Ye clouds that sail in heaven along,]]></verse></lyrics></song>`;

// Real row: six <verse> elements, only three distinct (type,label) pairs.
const HOW_SWEET_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="v" label="1"><![CDATA[How sweet the name of Jesus sounds]]></verse><verse type="v" label="1"><![CDATA[It makes the wounded spirit whole]]></verse><verse type="v" label="2"><![CDATA[Dear name, the rock on which I build]]></verse><verse type="v" label="2"><![CDATA[Jesus! My Shepherd, Saviour, Friend]]></verse><verse type="v" label="3"><![CDATA[Weak is the effort of my heart]]></verse><verse type="v" label="3"><![CDATA[Till then I would Thy love proclaim]]></verse></lyrics></song>`;

// Real rows in this library spell the type out in full.
const FULL_WORD_TYPE_XML = `<?xml version='1.0' encoding='UTF-8'?>
<song version="1.0"><lyrics><verse type="Verse" label="1"><![CDATA[Line one]]></verse><verse type="Chorus" label="1"><![CDATA[Line two]]></verse><verse type="Ending" label="1"><![CDATA[Line three]]></verse></lyrics></song>`;

describe('parseSongLyrics', () => {
  it('parses multiple verse-only blocks in document order', () => {
    const blocks = parseSongLyrics(ABIDE_WITH_ME_XML);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'v', label: '1' });
    expect(blocks[0].text).toContain('Abide with me, fast falls the eventide');
    expect(blocks[1]).toMatchObject({ type: 'v', label: '2' });
  });

  it('preserves document order across verse and chorus blocks', () => {
    const blocks = parseSongLyrics(ALL_CREATURES_XML);
    expect(blocks.map((b) => `${b.type}${b.label}`)).toEqual(['v1', 'c1', 'v2']);
  });

  it('keeps every block when a (type,label) pair repeats', () => {
    const blocks = parseSongLyrics(HOW_SWEET_XML);
    expect(blocks).toHaveLength(6);
    expect(blocks[1].text).toContain('It makes the wounded spirit whole');
  });
});

describe('parseSongLyrics — malformed markup resilience', () => {
  it('extracts text from multi-section CDATA', () => {
    // What a real XML writer emits when a lyric contains a literal ']]>'.
    const xml = `<song><lyrics><verse type="v" label="1"><![CDATA[Amazing grace]]><![CDATA[how sweet]]></verse></lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('Amazing gracehow sweet');
  });

  it('preserves separation around inline markup', () => {
    const xml = `<song><lyrics><verse type="v" label="1">Line one<br/>Line two</verse></lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('Line one\nLine two');
  });

  it('extracts text nested in a child element', () => {
    const xml = `<song><lyrics><verse name="v1"><lines>Amazing grace</lines></verse></lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('Amazing grace');
  });

  it('joins CDATA with trailing plain text instead of dropping it', () => {
    const xml = `<song><lyrics><verse type="v" label="1"><![CDATA[Amazing]]> grace</verse></lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('Amazing grace');
  });

  it('drops a verse block whose text is empty after trimming', () => {
    const xml = `<song><lyrics><verse type="v" label="1">   </verse><verse type="v" label="2">Real text</verse></lyrics></song>`;
    expect(parseSongLyrics(xml)).toHaveLength(1);
    expect(parseSongLyrics(xml)[0].text).toBe('Real text');
  });

  it('recovers text from a verse whose closing tag was truncated', () => {
    const xml = `<song><lyrics><verse type="v" label="1">abc</lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('abc');
  });

  it('does not coerce numeric-looking lyric text', () => {
    const xml = `<song><lyrics><verse type="v" label="1">0123</verse></lyrics></song>`;
    expect(parseSongLyrics(xml)[0].text).toBe('0123');
  });

  it('returns no blocks when a song has two sibling <lyrics> elements', () => {
    const xml = `<song><lyrics><verse type="v" label="1">A</verse></lyrics><lyrics><verse type="v" label="1">B</verse></lyrics></song>`;
    expect(parseSongLyrics(xml)).toHaveLength(0);
  });
});

describe('typeCodeToName', () => {
  it('maps known OpenLP type codes to display names', () => {
    expect(typeCodeToName('v')).toBe('Verse');
    expect(typeCodeToName('c')).toBe('Chorus');
    expect(typeCodeToName('b')).toBe('Bridge');
  });

  it('accepts the full-word spellings this library actually uses', () => {
    expect(typeCodeToName('Verse')).toBe('Verse');
    expect(typeCodeToName('Chorus')).toBe('Chorus');
    expect(typeCodeToName('Ending')).toBe('Ending');
    expect(parseSongLyrics(FULL_WORD_TYPE_XML).map((b) => typeCodeToName(b.type))).toEqual([
      'Verse',
      'Chorus',
      'Ending',
    ]);
  });

  it('falls back to a capitalized form for unknown types', () => {
    expect(typeCodeToName('x')).toBe('X');
    expect(typeCodeToName('refrain')).toBe('Refrain');
  });
});
