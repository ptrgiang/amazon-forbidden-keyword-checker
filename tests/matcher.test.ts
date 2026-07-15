import { describe, expect, it } from 'vitest';
import { KeywordMatcher } from '../src/lib/matcher';
import { termKey } from '../src/lib/normalize';
import type { MergedKeyword } from '../src/lib/types';

let seq = 0;
function kw(term: string, extra: Partial<MergedKeyword> = {}): MergedKeyword {
  return {
    id: `t:${seq++}`,
    term,
    key: termKey(term),
    languages: ['English'],
    source: 'remote',
    disabled: false,
    edited: false,
    ...extra
  };
}

function scan(terms: (string | MergedKeyword)[], text: string, langs: string[] | null = null) {
  const list = terms.map((t) => (typeof t === 'string' ? kw(t) : t));
  return new KeywordMatcher(list, langs).scan(text);
}

describe('KeywordMatcher', () => {
  it('matches whole words only — no partial match inside larger words', () => {
    expect(scan(['cure'], 'This will cure you')).toHaveLength(1);
    expect(scan(['cure'], 'procured securely')).toHaveLength(0);
    expect(scan(['led'], 'recycled bottles')).toHaveLength(0);
    expect(scan(['led'], 'LED lights')).toHaveLength(1);
  });

  it('matches exact multi-word phrases', () => {
    const r = scan(['clinically proven'], 'It is Clinically   Proven to work');
    expect(r).toHaveLength(1);
    expect(r[0].found).toBe('Clinically   Proven');
  });

  it('is case-insensitive but reports the original text', () => {
    const r = scan(['FDA approved'], 'this is fda APPROVED stuff');
    expect(r).toHaveLength(1);
    expect(r[0].found).toBe('fda APPROVED');
    expect(r[0].keyword.term).toBe('FDA approved');
  });

  it('handles Unicode normalization (composed vs decomposed accents)', () => {
    const r = scan(['cáncer'], 'cura el cáncer hoy'); // decomposed in text
    expect(r).toHaveLength(1);
  });

  it('matches accented multilingual characters', () => {
    expect(scan(['garantía'], 'con garantía total')).toHaveLength(1);
    expect(scan(['garantía'], 'con garantías total')).toHaveLength(0); // plural = different word
  });

  it('matches next to punctuation', () => {
    expect(scan(['best seller'], 'A best seller!')).toHaveLength(1);
    expect(scan(['best seller'], '(best seller), yes')).toHaveLength(1);
    expect(scan(['cure'], 'cure.')).toHaveLength(1);
  });

  it('handles special characters like $', () => {
    const r = scan(['$1'], 'only $1 today');
    expect(r).toHaveLength(1);
    expect(r[0].found).toBe('$1');
    expect(scan(['$1'], 'only $15 today')).toHaveLength(0); // digit boundary respected
  });

  it('handles hyphenated and apostrophe words', () => {
    expect(scan(['anti-bacterial'], 'an anti-bacterial wipe')).toHaveLength(1);
    expect(scan(["doctor's choice"], "the Doctor's Choice brand")).toHaveLength(1);
  });

  it('prefers the longest phrase when matches overlap', () => {
    const r = scan(['cancer', 'cure cancer', 'cure'], 'this can cure cancer fast');
    expect(r).toHaveLength(1);
    expect(r[0].keyword.term).toBe('cure cancer');
  });

  it('finds multiple non-overlapping violations with correct offsets', () => {
    const text = 'cure today, cure tomorrow';
    const r = scan(['cure'], text);
    expect(r).toHaveLength(2);
    for (const v of r) expect(text.slice(v.start, v.end)).toBe(v.found);
  });

  it('is regex-safe: keywords with regex metacharacters are literal', () => {
    expect(scan(['100% (guaranteed)'], 'it is 100% (guaranteed) ok')).toHaveLength(1);
    expect(scan(['a+b'], 'formula a+b works')).toHaveLength(1);
    expect(scan(['a+b'], 'aab')).toHaveLength(0);
  });

  it('skips disabled keywords', () => {
    expect(scan([kw('cure', { disabled: true })], 'cure')).toHaveLength(0);
  });

  it('filters by selected languages; null means all', () => {
    const es = kw('cura', { languages: ['Spanish'] });
    const en = kw('cure', { languages: ['English'] });
    expect(scan([es, en], 'cure y cura', null)).toHaveLength(2);
    expect(scan([es, en], 'cure y cura', ['Spanish'])).toHaveLength(1);
    expect(scan([es, en], 'cure y cura', ['Spanish', 'English'])).toHaveLength(2);
    expect(scan([es, en], 'cure y cura', [])).toHaveLength(0);
  });

  it('stays fast with thousands of keywords', () => {
    const list: MergedKeyword[] = [];
    for (let i = 0; i < 5000; i++) list.push(kw(`forbidden${i} phrase${i % 97}`));
    list.push(kw('cure cancer'));
    const matcher = new KeywordMatcher(list, null);
    const text = ('lorem ipsum dolor sit amet cure cancer consectetur '.repeat(200));
    const t0 = performance.now();
    const r = matcher.scan(text);
    const elapsed = performance.now() - t0;
    expect(r.length).toBe(200);
    expect(elapsed).toBeLessThan(500);
  });

  it('reports offsets in original text despite whitespace collapsing', () => {
    const text = 'x   FDA    approved   y';
    const r = scan(['fda approved'], text);
    expect(r).toHaveLength(1);
    expect(text.slice(r[0].start, r[0].end)).toBe('FDA    approved');
  });
});
