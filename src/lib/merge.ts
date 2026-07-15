import { termKey } from './normalize';
import type { LocalOverrides, MergedKeyword, RemoteDataset } from './types';

/**
 * Merge the read-only remote dataset with local overrides into the list
 * used by the matcher and the Manage Keywords UI. Remote data is never
 * mutated; edits/disables are layered on top by normalized key.
 */
export function mergeKeywords(
  remote: RemoteDataset | null,
  overrides: LocalOverrides
): MergedKeyword[] {
  const merged: MergedKeyword[] = [];
  if (remote) {
    for (const rk of remote.keywords) {
      const edit = overrides.edits[rk.key];
      const term = edit?.term !== undefined && edit.term !== '' ? edit.term : rk.term;
      merged.push({
        id: `r:${rk.key}`,
        term,
        key: termKey(term),
        languages: rk.languages,
        source: 'remote',
        replacement: edit?.replacement || undefined,
        disabled: edit?.disabled === true,
        edited:
          edit !== undefined &&
          (edit.term !== undefined || edit.replacement !== undefined || edit.disabled === true)
      });
    }
  }
  for (const lk of overrides.added) {
    merged.push({
      id: `l:${lk.id}`,
      term: lk.term,
      key: termKey(lk.term),
      languages: lk.languages,
      source: 'local',
      replacement: lk.replacement || undefined,
      disabled: lk.disabled === true,
      edited: false
    });
  }
  return merged;
}

/** All languages across remote data and local additions/extras. */
export function allLanguages(
  remote: RemoteDataset | null,
  overrides: LocalOverrides
): string[] {
  const set = new Set<string>();
  for (const l of remote?.languages ?? []) set.add(l);
  for (const l of overrides.extraLanguages) set.add(l);
  for (const k of overrides.added) for (const l of k.languages) set.add(l);
  return [...set];
}

/** Count of keywords that will actively match (not disabled, non-empty). */
export function activeKeywordCount(merged: MergedKeyword[]): number {
  return merged.filter((k) => !k.disabled && k.key.length > 0).length;
}
