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

type XmlNode = Record<string, any>;

function findElements(nodes: XmlNode[] | undefined, tag: string): XmlNode[] {
  return (nodes ?? []).filter((n) => tag in n);
}

// Walks a verse's children in document order collecting every text run, joining CDATA
// and plain text runs with nothing between them (they are one continuous stretch of
// prose that the source file just happened to split across CDATA sections — see I-03),
// but inserting a newline at each <br/> so multi-line lyrics don't get glued into one
// run of words (see I-04). Recurses into any other child element (e.g. a <lines>
// wrapper some rows use) so its text isn't silently skipped.
function collectText(nodes: XmlNode[] | undefined): string {
  if (!nodes) return '';
  let out = '';
  for (const node of nodes) {
    for (const key of Object.keys(node)) {
      if (key === ':@') continue;
      if (key === '#text') {
        out += String(node[key]);
      } else if (key.toLowerCase() === 'br') {
        out += '\n';
      } else {
        out += collectText(node[key]);
      }
    }
  }
  return out;
}

export function parseSongLyrics(xml: string): ParsedSongBlock[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    cdataPropName: '__cdata',
    preserveOrder: true,
    // Without this, a verse whose entire text is numeric-looking ("0123", "1.50")
    // gets silently coerced through Number and comes back mangled (see I-07).
    parseTagValue: false,
    // The default trims each individual text run, which would eat the space between
    // a CDATA section and adjacent plain text (e.g. "...]]> tail") — the whole verse is
    // still trimmed once, below, after every run is joined.
    trimValues: false,
  });
  const doc = parser.parse(xml) as XmlNode[];
  const songNode = findElements(doc, 'song')[0];
  const lyricsMatches = findElements(songNode?.song, 'lyrics');
  // A song document has exactly one <lyrics> element; zero or several is malformed
  // and has always been treated as "no verses" rather than guessed at.
  const lyricsChildren = lyricsMatches.length === 1 ? lyricsMatches[0].lyrics : undefined;
  const verseNodes = findElements(lyricsChildren, 'verse');

  return verseNodes
    .map((v) => {
      const attrs = v[':@'] ?? {};
      return {
        type: String(attrs.type ?? 'o'),
        label: String(attrs.label ?? '1'),
        text: collectText(v.verse).trim(),
      };
    })
    // An empty slide must never count as imported (see I-03).
    .filter((block) => block.text !== '');
}
