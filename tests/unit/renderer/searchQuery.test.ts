import { describe, it, expect } from 'vitest';
import { parseBookChapterQuery } from '../../../src/renderer/searchQuery';

describe('parseBookChapterQuery', () => {
  it('splits a book name and trailing chapter number', () => {
    expect(parseBookChapterQuery('mark 5')).toEqual({ bookQuery: 'mark', chapterQuery: '5' });
  });

  it('keeps a numbered book name intact when it is the whole query', () => {
    expect(parseBookChapterQuery('1 corinthians')).toEqual({ bookQuery: '1 corinthians', chapterQuery: null });
  });

  it('splits a numbered book name from its trailing chapter number', () => {
    expect(parseBookChapterQuery('1 john 2')).toEqual({ bookQuery: '1 john', chapterQuery: '2' });
  });

  it('treats a single numeric token with nothing before it as a book query, not a chapter query', () => {
    expect(parseBookChapterQuery('5')).toEqual({ bookQuery: '5', chapterQuery: null });
  });

  it('treats a plain book name with no trailing number as a book-only query', () => {
    expect(parseBookChapterQuery('mark')).toEqual({ bookQuery: 'mark', chapterQuery: null });
  });

  it('collapses extra whitespace around the split', () => {
    expect(parseBookChapterQuery('  mark   5  ')).toEqual({ bookQuery: 'mark', chapterQuery: '5' });
  });

  it('returns an empty book query for an empty input', () => {
    expect(parseBookChapterQuery('')).toEqual({ bookQuery: '', chapterQuery: null });
  });
});
