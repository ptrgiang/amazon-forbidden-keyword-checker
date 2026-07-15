import { describe, expect, it } from 'vitest';
import { activeKeywordCount, allLanguages, mergeKeywords } from '../src/lib/merge';
import type { LocalOverrides, RemoteDataset } from '../src/lib/types';
import { EMPTY_OVERRIDES } from '../src/lib/types';

const remote: RemoteDataset = {
  languages: ['English', 'Spanish'],
  keywords: [
    { term: 'Cure Cancer', key: 'cure cancer', languages: ['English'] },
    { term: 'garantía', key: 'garantía', languages: ['Spanish'] }
  ],
  syncedAt: 1,
  sourceUrl: 'x',
  sourceHash: 'h',
  format: 'csv'
};

describe('mergeKeywords', () => {
  it('passes remote keywords through untouched with no overrides', () => {
    const merged = mergeKeywords(remote, EMPTY_OVERRIDES);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'r:cure cancer',
      source: 'remote',
      disabled: false,
      edited: false
    });
  });

  it('applies local edits (term, replacement, disabled) on top of remote', () => {
    const overrides: LocalOverrides = {
      added: [],
      extraLanguages: [],
      edits: {
        'cure cancer': { key: 'cure cancer', replacement: 'supports wellness' },
        'garantía': { key: 'garantía', disabled: true }
      }
    };
    const merged = mergeKeywords(remote, overrides);
    expect(merged[0].replacement).toBe('supports wellness');
    expect(merged[0].edited).toBe(true);
    expect(merged[1].disabled).toBe(true);
    expect(activeKeywordCount(merged)).toBe(1);
  });

  it('adds local keywords with their own languages', () => {
    const overrides: LocalOverrides = {
      added: [
        { id: 'a1', term: 'wunderheilung', languages: ['German'], createdAt: 1 }
      ],
      edits: {},
      extraLanguages: []
    };
    const merged = mergeKeywords(remote, overrides);
    expect(merged).toHaveLength(3);
    const local = merged.find((k) => k.id === 'l:a1');
    expect(local).toMatchObject({ source: 'local', languages: ['German'] });
  });

  it('a refresh (new remote) preserves local overrides', () => {
    const overrides: LocalOverrides = {
      added: [{ id: 'a1', term: 'my term', languages: ['English'], createdAt: 1 }],
      edits: { 'cure cancer': { key: 'cure cancer', disabled: true } },
      extraLanguages: ['German']
    };
    const newRemote: RemoteDataset = {
      ...remote,
      keywords: [
        ...remote.keywords,
        { term: 'miracle', key: 'miracle', languages: ['English'] }
      ],
      syncedAt: 2
    };
    const merged = mergeKeywords(newRemote, overrides);
    // New remote keyword appears, old edit still applies, local addition kept.
    expect(merged.find((k) => k.key === 'miracle')).toBeTruthy();
    expect(merged.find((k) => k.id === 'r:cure cancer')?.disabled).toBe(true);
    expect(merged.find((k) => k.id === 'l:a1')).toBeTruthy();
  });

  it('handles null remote (first fetch failed) gracefully', () => {
    const merged = mergeKeywords(null, {
      added: [{ id: 'a1', term: 'local only', languages: ['English'], createdAt: 1 }],
      edits: {},
      extraLanguages: []
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe('local');
  });
});

describe('allLanguages', () => {
  it('unions remote, extra, and local keyword languages', () => {
    const langs = allLanguages(remote, {
      added: [{ id: 'a', term: 'x', languages: ['Italian'], createdAt: 1 }],
      edits: {},
      extraLanguages: ['German']
    });
    expect(langs.sort()).toEqual(['English', 'German', 'Italian', 'Spanish']);
  });
});
