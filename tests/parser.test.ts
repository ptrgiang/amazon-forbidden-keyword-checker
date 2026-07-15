import { describe, expect, it } from 'vitest';
import { parseCsv } from '../src/lib/csv';
import { looksLikeHtml, parseKeywordGrid } from '../src/lib/parser';

describe('parseKeywordGrid', () => {
  it('parses language columns dynamically without hardcoding', () => {
    const grid = [
      ['English', 'Spanish', 'German'],
      ['cure cancer', 'cura el cáncer', 'heilt Krebs'],
      ['FDA approved', 'aprobado por la FDA', null]
    ];
    const { languages, keywords } = parseKeywordGrid(grid);
    expect(languages).toEqual(['English', 'Spanish', 'German']);
    expect(keywords).toHaveLength(5);
    const de = keywords.filter((k) => k.languages.includes('German'));
    expect(de.map((k) => k.term)).toEqual(['heilt Krebs']);
  });

  it('ignores fully blank columns and blank cells', () => {
    const grid = [
      ['English', '', 'Spanish', '   '],
      ['anti-bacterial', null, 'antibacteriano', 'junk-under-blank-header'],
      ['', undefined, '', null]
    ];
    const { languages, keywords } = parseKeywordGrid(grid);
    expect(languages).toEqual(['English', 'Spanish']);
    expect(keywords.map((k) => k.term).sort()).toEqual(['anti-bacterial', 'antibacteriano']);
  });

  it('trims and collapses whitespace but preserves $, hyphens, apostrophes, accents', () => {
    const grid = [['English'], ['  $9.99   deal '], ["  don't   miss "], ['éco-friendly']];
    const { keywords } = parseKeywordGrid(grid);
    expect(keywords.map((k) => k.term)).toEqual(['$9.99 deal', "don't miss", 'éco-friendly']);
  });

  it('removes duplicates within a language (case-insensitive)', () => {
    const grid = [['English'], ['Best Seller'], ['best seller'], ['BEST SELLER']];
    const { keywords } = parseKeywordGrid(grid);
    expect(keywords).toHaveLength(1);
    expect(keywords[0].term).toBe('Best Seller'); // first-seen casing preserved
  });

  it('keeps all language labels when the same term appears in multiple columns', () => {
    const grid = [
      ['English', 'Spanish'],
      ['premium', 'premium']
    ];
    const { keywords } = parseKeywordGrid(grid);
    expect(keywords).toHaveLength(1);
    expect(keywords[0].languages.sort()).toEqual(['English', 'Spanish']);
  });

  it('normalizes Unicode (NFC) so composed/decomposed forms dedupe', () => {
    const composed = 'café';
    const decomposed = 'café';
    const grid = [['French'], [composed], [decomposed]];
    const { keywords } = parseKeywordGrid(grid);
    expect(keywords).toHaveLength(1);
  });

  it('detects newly added language columns', () => {
    const before = parseKeywordGrid([['English'], ['cure']]);
    const after = parseKeywordGrid([
      ['English', 'Italian'],
      ['cure', 'guarisce']
    ]);
    expect(before.languages).toEqual(['English']);
    expect(after.languages).toEqual(['English', 'Italian']);
  });

  it('throws on empty/headerless sheets', () => {
    expect(() => parseKeywordGrid([])).toThrow();
    expect(() => parseKeywordGrid([['', null]])).toThrow();
    expect(() => parseKeywordGrid([['English']])).toThrow(/no keywords/i);
  });

});

describe('parseCsv', () => {
  it('handles quoted fields, escaped quotes and CRLF', () => {
    const rows = parseCsv('"English","Spanish"\r\n"say ""best""","el ""mejor"""\r\na,b');
    expect(rows).toEqual([
      ['English', 'Spanish'],
      ['say "best"', 'el "mejor"'],
      ['a', 'b']
    ]);
  });

  it('handles commas inside quotes', () => {
    const rows = parseCsv('English\n"one, two"');
    expect(rows).toEqual([['English'], ['one, two']]);
  });
});

describe('HTML sniffing', () => {
  it('flags Google login pages as HTML, not data', () => {
    const html = new TextEncoder().encode('<!DOCTYPE html><html><head><title>Google Sign-In</title>').buffer;
    expect(looksLikeHtml(html as ArrayBuffer)).toBe(true);
  });
  it('does not flag CSV text as HTML', () => {
    const csv = new TextEncoder().encode('English,Spanish\ncure,cura').buffer;
    expect(looksLikeHtml(csv as ArrayBuffer)).toBe(false);
  });
});
