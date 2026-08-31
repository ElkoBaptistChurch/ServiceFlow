/**
 * Folds typographic punctuation to ASCII. Applied to BOTH indexed text and queries,
 * because 109 of the church's 556 songs use `'` and an operator types `'`.
 */
export function normalizeForSearch(raw: string): string {
  // Written with \uXXXX escapes (never literal curly-quote characters) so a
  // future transcription/encoding mishap cannot silently mangle this class again.
  return raw.replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D]/g, '"');
}

export function toFtsQuery(raw: string): string {
  const tokens = normalizeForSearch(raw)
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter(Boolean)
    .map((t) => `"${t}"*`);
  return tokens.length > 0 ? tokens.join(' ') : '""';
}
