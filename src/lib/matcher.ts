import { isWordChar, normalizeForScan } from './normalize';
import type { MergedKeyword, Violation } from './types';

/**
 * Aho–Corasick automaton over normalized text. One pass over the input
 * finds every keyword occurrence regardless of dictionary size, then
 * boundary rules and longest-match-first pruning are applied.
 */

interface AcNode {
  next: Map<string, number>;
  fail: number;
  /** Indices into the keyword list that end at this node. */
  out: number[];
}

export interface MatcherPattern {
  id: string;
  key: string;
  term: string;
}

export class KeywordMatcher {
  private nodes: AcNode[] = [{ next: new Map(), fail: 0, out: [] }];
  private keywords: MergedKeyword[] = [];
  private built = false;

  constructor(keywords: MergedKeyword[], enabledLanguages: string[] | null) {
    const langSet = enabledLanguages === null ? null : new Set(enabledLanguages);
    for (const kw of keywords) {
      if (kw.disabled) continue;
      if (!kw.key) continue;
      if (langSet && !kw.languages.some((l) => langSet.has(l))) continue;
      this.addPattern(kw);
    }
    this.buildFailLinks();
  }

  private addPattern(kw: MergedKeyword): void {
    let cur = 0;
    for (const ch of kw.key) {
      let nxt = this.nodes[cur].next.get(ch);
      if (nxt === undefined) {
        nxt = this.nodes.length;
        this.nodes.push({ next: new Map(), fail: 0, out: [] });
        this.nodes[cur].next.set(ch, nxt);
      }
      cur = nxt;
    }
    this.nodes[cur].out.push(this.keywords.length);
    this.keywords.push(kw);
  }

  private buildFailLinks(): void {
    const queue: number[] = [];
    for (const [, child] of this.nodes[0].next) {
      this.nodes[child].fail = 0;
      queue.push(child);
    }
    let qi = 0;
    while (qi < queue.length) {
      const u = queue[qi++];
      for (const [ch, v] of this.nodes[u].next) {
        let f = this.nodes[u].fail;
        while (f !== 0 && !this.nodes[f].next.has(ch)) f = this.nodes[f].fail;
        const target = this.nodes[f].next.get(ch);
        this.nodes[v].fail = target !== undefined && target !== v ? target : 0;
        this.nodes[v].out.push(...this.nodes[this.nodes[v].fail].out);
        queue.push(v);
      }
    }
    this.built = true;
  }

  get patternCount(): number {
    return this.keywords.length;
  }

  patterns(): MatcherPattern[] {
    return this.keywords.map((kw) => ({
      id: kw.id,
      key: kw.key,
      term: kw.term
    }));
  }

  /**
   * Scan `text` and return non-overlapping violations, longest match first
   * on conflicts. Offsets refer to the ORIGINAL text.
   */
  scan(text: string): Violation[] {
    if (!this.built || this.keywords.length === 0 || !text) return [];
    const { norm, map } = normalizeForScan(text);
    const raw: { start: number; end: number; kwIndex: number }[] = [];
    let state = 0;
    for (let i = 0; i < norm.length; i++) {
      const ch = norm[i];
      while (state !== 0 && !this.nodes[state].next.has(ch)) {
        state = this.nodes[state].fail;
      }
      state = this.nodes[state].next.get(ch) ?? 0;
      const node = this.nodes[state];
      if (node.out.length > 0) {
        for (const kwIndex of node.out) {
          const kw = this.keywords[kwIndex];
          const start = i - kw.key.length + 1;
          if (this.boundaryOk(norm, start, i + 1, kw.key)) {
            raw.push({ start, end: i + 1, kwIndex });
          }
        }
      }
    }
    // Longest-match-first, non-overlapping: sort by start asc, length desc.
    raw.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const picked: typeof raw = [];
    let lastEnd = -1;
    for (const m of raw) {
      if (m.start >= lastEnd) {
        picked.push(m);
        lastEnd = m.end;
      }
    }
    return picked.map((m) => {
      const origStart = map[m.start];
      const origEnd = map[m.end];
      return {
        start: origStart,
        end: origEnd,
        found: text.slice(origStart, origEnd),
        keyword: this.keywords[m.kwIndex]
      };
    });
  }

  /**
   * Whole-word rule: if the pattern edge is a word character, the adjacent
   * text character must not be one (prevents "led" matching inside
   * "recycled"). Patterns whose edge is punctuation (e.g. "$") only require
   * that boundary check on their word-like edge.
   */
  private boundaryOk(norm: string, start: number, end: number, key: string): boolean {
    const first = key[0];
    const last = key[key.length - 1];
    if (isWordChar(first) && isWordChar(norm[start - 1])) return false;
    if (isWordChar(last) && isWordChar(norm[end])) return false;
    return true;
  }
}
