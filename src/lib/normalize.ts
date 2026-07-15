/**
 * Text normalization shared by the parser and the matcher.
 * Keywords and scanned text must go through the same pipeline so
 * offsets and comparisons stay consistent.
 */

/** Normalize a keyword/cell for display: NFC + trim + collapse inner whitespace. */
export function cleanTerm(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/** Normalized matching key: cleaned + case-folded. */
export function termKey(raw: string): string {
  return cleanTerm(raw).toLowerCase();
}

export interface NormalizedText {
  /** Normalized text used for matching. */
  norm: string;
  /**
   * For each char in `norm`, the index of the original char it came from.
   * `map.length === norm.length + 1`; the final entry is the original length,
   * so `map[end]` is a valid exclusive end offset.
   */
  map: number[];
}

const WS = /\s/;
const COMBINING = /\p{M}/u;

/**
 * Normalize free text for scanning while keeping a map back to the
 * original character offsets. Whitespace runs collapse to a single space;
 * each base character is NFC-normalized and lowercased TOGETHER with its
 * trailing combining marks so decomposed accents ("a" + U+0301) compose
 * to the same form keyword keys use ("á").
 */
export function normalizeForScan(text: string): NormalizedText {
  const norm: string[] = [];
  const map: number[] = [];
  let lastWasSpace = false;
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i) as number;
    const ch = String.fromCodePoint(cp);
    if (WS.test(ch)) {
      if (!lastWasSpace && norm.length > 0) {
        norm.push(' ');
        map.push(i);
      }
      lastWasSpace = true;
      i += ch.length;
      continue;
    }
    lastWasSpace = false;
    // Gather the cluster: base char plus any following combining marks.
    let j = i + ch.length;
    let cluster = ch;
    while (j < text.length) {
      const nextCp = text.codePointAt(j) as number;
      const next = String.fromCodePoint(nextCp);
      if (!COMBINING.test(next)) break;
      cluster += next;
      j += next.length;
    }
    // NFC may expand or contract; map every produced char to the cluster
    // start so original offsets stay valid.
    const n = cluster.normalize('NFC').toLowerCase();
    for (const c of n) {
      norm.push(c);
      map.push(i);
    }
    i = j;
  }
  // Drop a trailing collapsed space so boundaries stay clean.
  while (norm.length > 0 && norm[norm.length - 1] === ' ') {
    norm.pop();
    map.pop();
  }
  map.push(text.length);
  return { norm: norm.join(''), map };
}

const WORDLIKE = /[\p{L}\p{N}]/u;

/** True when the character counts as part of a word (letters/digits). */
export function isWordChar(ch: string | undefined): boolean {
  return ch !== undefined && WORDLIKE.test(ch);
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
