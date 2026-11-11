import type { Testament } from './types';

/**
 * ServiceFlow's own identity for a Bible book: its canonical USFM code. Every source
 * (the bundled KJV, OpenLP files, future formats) maps its books onto this list, so a
 * book's code, testament and display order never depend on how one file numbered it
 * (D12). OpenLP's row ids, for instance, are not stable across files — KJV's 44 is
 * Romans, NET's 44 is Acts.
 */
export interface CanonicalBook {
  code: string;
  /** Default display name, used when a source doesn't supply its own spelling. */
  name: string;
  testament: Testament;
  /** 1-based, contiguous across the whole list. */
  order: number;
  /** Alternate names a source might use. Matching also folds case, punctuation and roman numerals. */
  aliases: string[];
}

type BookSpec = [code: string, name: string, aliases?: string[]];

const OT: BookSpec[] = [
  ['GEN', 'Genesis', ['Gen', 'Gn']],
  ['EXO', 'Exodus', ['Exod', 'Ex']],
  ['LEV', 'Leviticus', ['Lev']],
  ['NUM', 'Numbers', ['Num']],
  ['DEU', 'Deuteronomy', ['Deut']],
  ['JOS', 'Joshua', ['Josh']],
  ['JDG', 'Judges', ['Judg']],
  ['RUT', 'Ruth'],
  ['1SA', '1 Samuel', ['1 Sam', '1 Kingdoms']],
  ['2SA', '2 Samuel', ['2 Sam', '2 Kingdoms']],
  ['1KI', '1 Kings', ['1 Kgs', '3 Kingdoms']],
  ['2KI', '2 Kings', ['2 Kgs', '4 Kingdoms']],
  ['1CH', '1 Chronicles', ['1 Chron', '1 Chr', '1 Paralipomenon']],
  ['2CH', '2 Chronicles', ['2 Chron', '2 Chr', '2 Paralipomenon']],
  ['EZR', 'Ezra'],
  ['NEH', 'Nehemiah', ['Neh']],
  ['EST', 'Esther', ['Esth']],
  ['JOB', 'Job'],
  ['PSA', 'Psalms', ['Psalm', 'Ps', 'Psa']],
  ['PRO', 'Proverbs', ['Prov']],
  ['ECC', 'Ecclesiastes', ['Eccl', 'Qoheleth']],
  ['SNG', 'Song of Solomon', ['Song of Songs', 'Canticles', 'Canticle of Canticles', 'Song']],
  ['ISA', 'Isaiah', ['Isa']],
  ['JER', 'Jeremiah', ['Jer']],
  ['LAM', 'Lamentations', ['Lam']],
  ['EZK', 'Ezekiel', ['Ezek']],
  ['DAN', 'Daniel', ['Dan']],
  ['HOS', 'Hosea', ['Hos']],
  ['JOL', 'Joel'],
  ['AMO', 'Amos'],
  ['OBA', 'Obadiah', ['Obad']],
  ['JON', 'Jonah'],
  ['MIC', 'Micah', ['Mic']],
  ['NAM', 'Nahum', ['Nah']],
  ['HAB', 'Habakkuk', ['Hab']],
  ['ZEP', 'Zephaniah', ['Zeph']],
  ['HAG', 'Haggai', ['Hag']],
  ['ZEC', 'Zechariah', ['Zech']],
  ['MAL', 'Malachi', ['Mal']],
];

const NT: BookSpec[] = [
  ['MAT', 'Matthew', ['Matt', 'Mt']],
  ['MRK', 'Mark', ['Mk']],
  ['LUK', 'Luke', ['Lk']],
  ['JHN', 'John', ['Jn']],
  ['ACT', 'Acts', ['Acts of the Apostles']],
  ['ROM', 'Romans', ['Rom']],
  ['1CO', '1 Corinthians', ['1 Cor']],
  ['2CO', '2 Corinthians', ['2 Cor']],
  ['GAL', 'Galatians', ['Gal']],
  ['EPH', 'Ephesians', ['Eph']],
  ['PHP', 'Philippians', ['Phil']],
  ['COL', 'Colossians', ['Col']],
  ['1TH', '1 Thessalonians', ['1 Thess']],
  ['2TH', '2 Thessalonians', ['2 Thess']],
  ['1TI', '1 Timothy', ['1 Tim']],
  ['2TI', '2 Timothy', ['2 Tim']],
  ['TIT', 'Titus'],
  ['PHM', 'Philemon', ['Phlm']],
  ['HEB', 'Hebrews', ['Heb']],
  ['JAS', 'James', ['Jas']],
  ['1PE', '1 Peter', ['1 Pet']],
  ['2PE', '2 Peter', ['2 Pet']],
  ['1JN', '1 John'],
  ['2JN', '2 John'],
  ['3JN', '3 John'],
  ['JUD', 'Jude'],
  ['REV', 'Revelation', ['Revelations', 'Revelation of John', 'Revelation of St John', 'Apocalypse', 'Rev']],
];

// The books KJV-with-Apocrypha files carry, in the 1611 edition's order. OpenLP's KJV
// has 12 of them; the extra codes cover files that split Daniel's and Esther's additions
// differently.
const AP: BookSpec[] = [
  ['1ES', '1 Esdras', ['Esdras', '3 Esdras']],
  ['2ES', '2 Esdras', ['4 Esdras']],
  ['TOB', 'Tobit', ['Tobias']],
  ['JDT', 'Judith'],
  ['ESG', 'Additions to Esther', ['Rest of Esther', 'The Rest of Esther', 'Esther (Greek)', 'Greek Esther']],
  ['WIS', 'Wisdom of Solomon', ['Wisdom', 'Book of Wisdom']],
  ['SIR', 'Sirach', ['Ecclesiasticus', 'Ben Sira', 'Wisdom of Sirach', 'Wisdom of Jesus son of Sirach']],
  ['BAR', 'Baruch'],
  [
    'S3Y',
    'Song of the Three Holy Children',
    ['Song of the Three Children', 'Song of Three Youths', 'Song of the Three Jews', 'Prayer of Azariah', 'Azariah'],
  ],
  ['SUS', 'Susanna', ['History of Susanna']],
  ['BEL', 'Bel and the Dragon', ['Bel', 'Bel and Dragon']],
  ['MAN', 'Prayer of Manasses', ['Prayer of Manasseh', 'Manasses', 'Manasseh']],
  ['1MA', '1 Maccabees', ['1 Macc']],
  ['2MA', '2 Maccabees', ['2 Macc']],
];

function build(): CanonicalBook[] {
  const out: CanonicalBook[] = [];
  const add = (specs: BookSpec[], testament: Testament) => {
    for (const [code, name, aliases = []] of specs) {
      out.push({ code, name, testament, order: out.length + 1, aliases });
    }
  };
  add(OT, 'OT');
  add(NT, 'NT');
  add(AP, 'AP');
  return out;
}

export const CANONICAL_BOOKS: readonly CanonicalBook[] = build();

const byCode = new Map(CANONICAL_BOOKS.map((b) => [b.code, b]));

export function bookByCode(code: string): CanonicalBook | undefined {
  return byCode.get(code.toUpperCase());
}

const ORDINAL_PREFIX: Record<string, string> = {
  i: '1',
  ii: '2',
  iii: '3',
  iv: '4',
  first: '1',
  second: '2',
  third: '3',
  fourth: '4',
  '1st': '1',
  '2nd': '2',
  '3rd': '3',
  '4th': '4',
};

/**
 * Folds a book name to a comparison key: case, punctuation, a leading "The"/"Book of",
 * and a leading roman numeral or ordinal ("I Kings", "First Kings", "1st Kings", "1Kings"
 * all become "1 kings"). Only the leading token is treated as a number, so "Bel and the
 * Dragon" or a name containing "i" elsewhere is left alone.
 */
export function normalizeBookName(raw: string): string {
  let s = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[.,'’:;()\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^the /, '').replace(/^book of /, '');
  // "1st kings" -> "1 kings", then "1john" -> "1 john"
  s = s.replace(/^(\d)(?:st|nd|rd|th)\b/, '$1');
  s = s.replace(/^(\d)(?=[a-z])/, '$1 ');
  const [first, ...rest] = s.split(' ');
  if (rest.length > 0 && ORDINAL_PREFIX[first]) {
    s = [ORDINAL_PREFIX[first], ...rest].join(' ');
  }
  s = s.replace(/^(\d) (?:book of )?(?:the )?/, '$1 ');
  return s;
}

const byNormalizedName = (() => {
  const map = new Map<string, CanonicalBook>();
  for (const book of CANONICAL_BOOKS) {
    for (const name of [book.name, book.code, ...book.aliases]) {
      const key = normalizeBookName(name);
      // First writer wins; the list is ordered so a canonical book's own name always
      // beats a later book's alias.
      if (!map.has(key)) map.set(key, book);
    }
  }
  return map;
})();

/** Exact match after normalization — never a substring, so "1 John" can't resolve to John. */
export function matchBookByName(name: string): CanonicalBook | undefined {
  return byNormalizedName.get(normalizeBookName(name));
}

/**
 * Codes of every canonical book whose name or alias contains `query` once normalized.
 * Lets the browse box find "Song of Songs" whatever the active translation calls it.
 */
export function bookCodesMatchingQuery(query: string): string[] {
  const q = normalizeBookName(query);
  if (q === '') return [];
  return CANONICAL_BOOKS.filter((b) =>
    [b.name, ...b.aliases].some((n) => normalizeBookName(n).includes(q))
  ).map((b) => b.code);
}
