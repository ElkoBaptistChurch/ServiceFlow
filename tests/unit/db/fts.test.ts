import { describe, it, expect } from 'vitest';
import { normalizeForSearch } from '../../../src/main/db/fts';

describe('normalizeForSearch', () => {
  it('folds a typographic right single quote to an ASCII apostrophe', () => {
    expect(normalizeForSearch('believer\u2019s')).toBe("believer's");
  });

  it('folds typographic single quotes (curly and modifier-letter) to ASCII apostrophes', () => {
    expect(normalizeForSearch('\u2018quoted\u2019')).toBe("'quoted'");
  });

  it('folds typographic double quotes to ASCII double quotes', () => {
    expect(normalizeForSearch('\u201Chello\u201D')).toBe('"hello"');
  });

  it('leaves an ASCII-only string unchanged', () => {
    expect(normalizeForSearch("plain ascii text with 'quotes' and \"quotes\"")).toBe(
      "plain ascii text with 'quotes' and \"quotes\""
    );
  });
});
