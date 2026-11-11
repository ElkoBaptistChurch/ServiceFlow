#!/usr/bin/env node
// Builds resources/bibles/kjv.json — the KJV ServiceFlow seeds on first launch (D12).
//
// Source: eBible.org's `eng-kjv` in VPL format (https://ebible.org/Scriptures/eng-kjv_vpl.zip),
// public domain in the US. Download and extract it by hand into an empty scratch folder; it
// is never committed and never fetched at build time. Pass the extracted `eng-kjv_vpl.xml`:
//
//   node scripts/build-bundled-bible.mjs /path/to/eng-kjv_vpl.xml [--downloaded YYYY-MM-DD]
//
// The XML, not the `_vpl.txt` in the same zip, because the XML uses standard USFM book codes
// (the .txt uses BibleWorks abbreviations: SOL, JOH, EZE...) and has the KJV's italic
// supplied-word [brackets] already removed.
//
// Only the 66-book Protestant canon is written (plan open question 1); deuterocanonical
// books in the source are dropped. The script checks its own output and exits non-zero —
// writing nothing — if any check fails.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SOURCE_URL = 'https://ebible.org/Scriptures/eng-kjv_vpl.zip';
const EXPECTED_BOOKS = 66;
const EXPECTED_VERSES = 31102;

// The 66 books in canonical order with their default display names. Kept in step with
// src/shared/bibleBooks.ts (the bundledKjv test checks every code against it); duplicated
// here so this script runs with plain Node and no TypeScript build.
const BOOKS = [
  ['GEN', 'Genesis'], ['EXO', 'Exodus'], ['LEV', 'Leviticus'], ['NUM', 'Numbers'],
  ['DEU', 'Deuteronomy'], ['JOS', 'Joshua'], ['JDG', 'Judges'], ['RUT', 'Ruth'],
  ['1SA', '1 Samuel'], ['2SA', '2 Samuel'], ['1KI', '1 Kings'], ['2KI', '2 Kings'],
  ['1CH', '1 Chronicles'], ['2CH', '2 Chronicles'], ['EZR', 'Ezra'], ['NEH', 'Nehemiah'],
  ['EST', 'Esther'], ['JOB', 'Job'], ['PSA', 'Psalms'], ['PRO', 'Proverbs'],
  ['ECC', 'Ecclesiastes'], ['SNG', 'Song of Solomon'], ['ISA', 'Isaiah'], ['JER', 'Jeremiah'],
  ['LAM', 'Lamentations'], ['EZK', 'Ezekiel'], ['DAN', 'Daniel'], ['HOS', 'Hosea'],
  ['JOL', 'Joel'], ['AMO', 'Amos'], ['OBA', 'Obadiah'], ['JON', 'Jonah'], ['MIC', 'Micah'],
  ['NAM', 'Nahum'], ['HAB', 'Habakkuk'], ['ZEP', 'Zephaniah'], ['HAG', 'Haggai'],
  ['ZEC', 'Zechariah'], ['MAL', 'Malachi'],
  ['MAT', 'Matthew'], ['MRK', 'Mark'], ['LUK', 'Luke'], ['JHN', 'John'], ['ACT', 'Acts'],
  ['ROM', 'Romans'], ['1CO', '1 Corinthians'], ['2CO', '2 Corinthians'], ['GAL', 'Galatians'],
  ['EPH', 'Ephesians'], ['PHP', 'Philippians'], ['COL', 'Colossians'],
  ['1TH', '1 Thessalonians'], ['2TH', '2 Thessalonians'], ['1TI', '1 Timothy'],
  ['2TI', '2 Timothy'], ['TIT', 'Titus'], ['PHM', 'Philemon'], ['HEB', 'Hebrews'],
  ['JAS', 'James'], ['1PE', '1 Peter'], ['2PE', '2 Peter'], ['1JN', '1 John'],
  ['2JN', '2 John'], ['3JN', '3 John'], ['JUD', 'Jude'], ['REV', 'Revelation'],
];

function fail(message) {
  console.error(`build-bundled-bible: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const inputPath = args.find((a) => !a.startsWith('--'));
const downloadedFlag = args.indexOf('--downloaded');
const downloaded = downloadedFlag >= 0 ? args[downloadedFlag + 1] : new Date().toISOString().slice(0, 10);
if (!inputPath) fail('usage: node scripts/build-bundled-bible.mjs <eng-kjv_vpl.xml> [--downloaded YYYY-MM-DD]');
if (!/\.xml$/i.test(inputPath)) {
  fail('pass the extracted eng-kjv_vpl.xml (the .txt uses non-USFM book abbreviations)');
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENTITIES[e] ?? m;
  });
}

// Strips eBible's markup and normalises whitespace: pilcrow paragraph marks, any residual
// footnote/italic bracket markers, and runs of whitespace.
export function cleanVerseText(raw) {
  return decodeEntities(raw)
    .replace(/<[^>]*>/g, '')
    .replace(/¶/g, '')
    .replace(/[\[\]]/g, '')
    .replace(/[†‡*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const xml = fs.readFileSync(inputPath, 'utf8');
const nameByCode = new Map(BOOKS);
const versesByCode = new Map(BOOKS.map(([code]) => [code, []]));
const dropped = new Map();
const seen = new Set();
const VERSE = /<v\s+b="([^"]+)"\s+c="(\d+)"\s+v="(\d+)"\s*>([\s\S]*?)<\/v>/g;
let match;
while ((match = VERSE.exec(xml))) {
  const [, code, c, v, raw] = match;
  if (!versesByCode.has(code)) {
    dropped.set(code, (dropped.get(code) ?? 0) + 1);
    continue;
  }
  const key = `${code} ${c}:${v}`;
  if (seen.has(key)) fail(`duplicate verse ${key}`);
  seen.add(key);
  versesByCode.get(code).push([Number(c), Number(v), cleanVerseText(raw)]);
}

const books = BOOKS.map(([code]) => ({
  bookCode: code,
  name: nameByCode.get(code),
  verses: versesByCode.get(code).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
})).filter((b) => b.verses.length > 0);

// --- Self-checks: fail loudly rather than ship a short or corrupt Bible. ---
const verseCount = books.reduce((n, b) => n + b.verses.length, 0);
if (books.length !== EXPECTED_BOOKS) fail(`expected ${EXPECTED_BOOKS} books, got ${books.length}`);
if (verseCount !== EXPECTED_VERSES) fail(`expected ${EXPECTED_VERSES} verses, got ${verseCount}`);
for (const b of books) {
  if (!nameByCode.has(b.bookCode)) fail(`unknown book code ${b.bookCode}`);
  for (const [c, v, text] of b.verses) {
    if (text === '') fail(`empty text at ${b.bookCode} ${c}:${v}`);
    if (/[¶\[\]<>]/.test(text)) fail(`residual markup at ${b.bookCode} ${c}:${v}: ${text}`);
  }
}

const output = {
  comment:
    `Generated by scripts/build-bundled-bible.mjs from ${SOURCE_URL} (eBible.org eng-kjv, ` +
    `downloaded ${downloaded}). Public domain in the US. 66-book Protestant canon only. Do not edit by hand.`,
  code: 'KJV',
  name: 'King James Version',
  source: 'bundled',
  licenseNote: 'Public domain (US).',
  books,
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(repoRoot, 'resources', 'bibles', 'kjv.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
// One book per line keeps diffs of a regenerated file reviewable without bloating it.
const body = JSON.stringify({ ...output, books: [] }, null, 2).replace(
  '"books": []',
  `"books": [\n${books.map((b) => `    ${JSON.stringify(b)}`).join(',\n')}\n  ]`
);
fs.writeFileSync(outPath, `${body}\n`);
console.log(`wrote ${path.relative(repoRoot, outPath)}: ${books.length} books, ${verseCount} verses`);
if (dropped.size > 0) {
  console.log(`dropped deuterocanonical books: ${[...dropped].map(([c, n]) => `${c} (${n})`).join(', ')}`);
}
