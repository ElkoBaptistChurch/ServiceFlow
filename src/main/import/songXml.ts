import { XMLParser } from 'fast-xml-parser';

export interface ParsedSongBlock {
  type: string;
  label: string;
  text: string;
}

// This library mixes single-letter codes with full words in the same column
// (v×2136, c×6, Verse×95, Chorus×21, Ending×1), so both spellings map here.
const TYPE_NAMES: Record<string, string> = {
  v: 'Verse',
  verse: 'Verse',
  c: 'Chorus',
  chorus: 'Chorus',
  b: 'Bridge',
  bridge: 'Bridge',
  p: 'Pre-Chorus',
  'pre-chorus': 'Pre-Chorus',
  i: 'Intro',
  intro: 'Intro',
  e: 'Ending',
  ending: 'Ending',
  o: 'Other',
  other: 'Other',
  t: 'Tag',
  tag: 'Tag',
};

export function typeCodeToName(code: string): string {
  const key = code.trim().toLowerCase();
  if (TYPE_NAMES[key]) return TYPE_NAMES[key];
  // Unknown single letters read best uppercased; unknown words read best capitalized.
  return key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
}

export function parseSongLyrics(xml: string): ParsedSongBlock[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    cdataPropName: '__cdata',
  });
  const doc = parser.parse(xml);
  const rawVerses = doc?.song?.lyrics?.verse;
  const verseList = Array.isArray(rawVerses) ? rawVerses : rawVerses ? [rawVerses] : [];
  return verseList.map((v: any) => ({
    type: String(v.type ?? 'o'),
    label: String(v.label ?? '1'),
    text: (typeof v.__cdata === 'string' ? v.__cdata : String(v['#text'] ?? '')).trim(),
  }));
}
