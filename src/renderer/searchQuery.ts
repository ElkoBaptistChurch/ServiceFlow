export interface BookChapterQuery {
  bookQuery: string;
  chapterQuery: string | null;
}

/**
 * Splits a browse-search query into a book-name part and an optional trailing chapter
 * number, e.g. "mark 5" -> book "mark", chapter "5". A trailing numeric token is only
 * pulled out as the chapter query when at least one token precedes it, so numbered book
 * names ("1 john", "1 corinthians") stay intact when typed alone.
 */
export function parseBookChapterQuery(query: string): BookChapterQuery {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && /^\d+$/.test(last)) {
    return { bookQuery: tokens.slice(0, -1).join(' '), chapterQuery: last };
  }
  return { bookQuery: tokens.join(' '), chapterQuery: null };
}
