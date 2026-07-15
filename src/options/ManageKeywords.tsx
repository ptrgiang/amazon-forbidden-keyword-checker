import { useEffect, useMemo, useRef, useState } from 'react';
import { allLanguages, mergeKeywords } from '../lib/merge';
import { cleanTerm } from '../lib/normalize';
import { saveOverrides, type StoredState } from '../lib/storage';
import type { LocalOverrides, MergedKeyword } from '../lib/types';
import { EMPTY_OVERRIDES } from '../lib/types';

type SourceFilter = 'all' | 'remote' | 'local';
type StatusFilter = 'all' | 'active' | 'disabled' | 'edited';

function newId(): string {
  return crypto.randomUUID();
}

function keywordFromUrl(): string {
  return new URLSearchParams(location.search).get('keyword')?.trim() ?? '';
}

export function ManageKeywords({ state }: { state: StoredState }): JSX.Element {
  const { remote, overrides } = state;
  const targetKeyword = useRef(keywordFromUrl());
  const [search, setSearch] = useState(targetKeyword.current);
  const [langFilter, setLangFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [newTerm, setNewTerm] = useState('');
  const [newLang, setNewLang] = useState('');
  const [newLangName, setNewLangName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTerm, setEditTerm] = useState('');

  const languages = useMemo(() => allLanguages(remote, overrides), [remote, overrides]);
  const merged = useMemo(() => mergeKeywords(remote, overrides), [remote, overrides]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return merged.filter((k) => {
      if (q && !k.term.toLowerCase().includes(q)) return false;
      if (langFilter !== 'all' && !k.languages.includes(langFilter)) return false;
      if (sourceFilter !== 'all' && k.source !== sourceFilter) return false;
      if (statusFilter === 'active' && k.disabled) return false;
      if (statusFilter === 'disabled' && !k.disabled) return false;
      if (statusFilter === 'edited' && !k.edited) return false;
      return true;
    });
  }, [merged, search, langFilter, sourceFilter, statusFilter]);

  const update = (next: LocalOverrides): void => {
    void saveOverrides(next);
  };

  const addKeyword = (): void => {
    const term = cleanTerm(newTerm);
    if (!term) return;
    const lang = newLang || languages[0] || 'Custom';
    update({
      ...overrides,
      added: [
        ...overrides.added,
        {
          id: newId(),
          term,
          languages: [lang],
          createdAt: Date.now()
        }
      ]
    });
    setNewTerm('');
  };

  const addLanguage = (): void => {
    const name = cleanTerm(newLangName);
    if (!name || languages.includes(name)) return;
    update({ ...overrides, extraLanguages: [...overrides.extraLanguages, name] });
    setNewLangName('');
  };

  const remoteKeyOf = (k: MergedKeyword): string => k.id.slice(2);

  const setDisabled = (k: MergedKeyword, disabled: boolean): void => {
    if (k.source === 'remote') {
      const key = remoteKeyOf(k);
      update({
        ...overrides,
        edits: { ...overrides.edits, [key]: { ...overrides.edits[key], key, disabled } }
      });
    } else {
      update({
        ...overrides,
        added: overrides.added.map((a) => (a.id === remoteKeyOf(k) ? { ...a, disabled } : a))
      });
    }
  };

  const restore = (k: MergedKeyword): void => {
    const key = remoteKeyOf(k);
    const edits = { ...overrides.edits };
    delete edits[key];
    update({ ...overrides, edits });
  };

  const deleteLocal = (k: MergedKeyword): void => {
    update({
      ...overrides,
      added: overrides.added.filter((a) => a.id !== remoteKeyOf(k))
    });
  };

  const startEdit = (k: MergedKeyword): void => {
    setEditingId(k.id);
    setEditTerm(k.term);
  };

  useEffect(() => {
    const target = targetKeyword.current.toLowerCase();
    if (!target || editingId) return;
    const match =
      merged.find((k) => k.term.toLowerCase() === target) ??
      merged.find((k) => k.term.toLowerCase().includes(target));
    if (match) startEdit(match);
  }, [editingId, merged]);

  const commitEdit = (k: MergedKeyword): void => {
    const term = cleanTerm(editTerm);
    if (k.source === 'remote') {
      const key = remoteKeyOf(k);
      const prev = overrides.edits[key];
      // Only store fields that actually diverge from the remote original.
      const original = remote?.keywords.find((r) => r.key === key);
      update({
        ...overrides,
        edits: {
          ...overrides.edits,
          [key]: {
            ...prev,
            key,
            term: term && term !== original?.term ? term : undefined
          }
        }
      });
    } else {
      update({
        ...overrides,
        added: overrides.added.map((a) =>
          a.id === remoteKeyOf(k)
            ? { ...a, term: term || a.term }
            : a
        )
      });
    }
    setEditingId(null);
  };

  const resetOverrides = (): void => {
    if (confirm('Reset all local overrides? Local keywords, edits and disabled flags will be removed.')) {
      update(structuredClone(EMPTY_OVERRIDES));
    }
  };

  const exportCsv = (): void => {
    const rows = [
      ['Term', 'Languages', 'Source', 'Status', 'Edited'],
      ...merged.map((k) => [
        k.term,
        k.languages.join(', '),
        k.source === 'remote' ? 'Google Sheet' : 'Local',
        k.disabled ? 'Disabled' : 'Active',
        k.edited ? 'Yes' : ''
      ])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'forbidden-keywords-merged.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ minWidth: 200, flex: 1 }}
            placeholder="Search keywords…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search keywords"
          />
          <select className="select" value={langFilter} onChange={(e) => setLangFilter(e.target.value)} aria-label="Filter by language">
            <option value="all">All languages</option>
            {languages.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <select className="select" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value as SourceFilter)} aria-label="Filter by source">
            <option value="all">All sources</option>
            <option value="remote">Google Sheet</option>
            <option value="local">Local</option>
          </select>
          <select className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by status">
            <option value="all">Any status</option>
            <option value="active">Active</option>
            <option value="disabled">Disabled</option>
            <option value="edited">Edited</option>
          </select>
          <button className="btn" onClick={exportCsv}>Export CSV</button>
          <button className="btn btn-danger" onClick={resetOverrides}>Reset local overrides</button>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          The Google Sheet is read-only — edits below are stored locally and survive refreshes.
          Showing {visible.length} of {merged.length} keywords.
        </div>
      </div>

      <div className="card grid2">
        <div>
          <strong>Add local keyword</strong>
          <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
            <input className="input" placeholder="Keyword or phrase" value={newTerm} onChange={(e) => setNewTerm(e.target.value)} />
            <select className="select" value={newLang} onChange={(e) => setNewLang(e.target.value)} aria-label="Language for new keyword">
              {languages.map((l) => (
                <option key={l} value={l}>{l}</option>
              ))}
              {languages.length === 0 && <option value="">Custom</option>}
            </select>
            <button className="btn btn-primary" onClick={addKeyword} disabled={!newTerm.trim()}>Add</button>
          </div>
        </div>
        <div>
          <strong>Add local language</strong>
          <div className="row" style={{ marginTop: 8 }}>
            <input className="input" placeholder="e.g. German" value={newLangName} onChange={(e) => setNewLangName(e.target.value)} />
            <button className="btn" onClick={addLanguage} disabled={!newLangName.trim()}>Add language</button>
          </div>
          <div className="muted small" style={{ marginTop: 6 }}>
            New sheet columns are detected automatically after Refresh.
          </div>
        </div>
      </div>

      <table className="kw">
        <thead>
          <tr>
            <th style={{ width: '28%' }}>Keyword</th>
            <th>Languages</th>
            <th>Source</th>
            <th>Status</th>
            <th style={{ width: 190 }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((k) => (
            <tr key={k.id} className={k.disabled ? 'disabled' : ''}>
              <td>
                {editingId === k.id ? (
                  <input className="input" value={editTerm} onChange={(e) => setEditTerm(e.target.value)} aria-label="Edit keyword" />
                ) : (
                  <>
                    {k.term} {k.edited && <span className="badge">edited</span>}
                  </>
                )}
              </td>
              <td>{k.languages.join(', ')}</td>
              <td>
                <span className="badge">{k.source === 'remote' ? 'Google Sheet' : 'Local'}</span>
              </td>
              <td>{k.disabled ? 'Disabled' : 'Active'}</td>
              <td>
                {editingId === k.id ? (
                  <>
                    <button className="btn btn-sm btn-primary" onClick={() => commitEdit(k)}>Save</button>{' '}
                    <button className="btn btn-sm" onClick={() => setEditingId(null)}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn btn-sm" onClick={() => startEdit(k)}>Edit</button>{' '}
                    {k.disabled ? (
                      <button className="btn btn-sm" onClick={() => setDisabled(k, false)}>Enable</button>
                    ) : (
                      <button className="btn btn-sm" onClick={() => setDisabled(k, true)}>Disable</button>
                    )}{' '}
                    {k.source === 'remote' && k.edited && (
                      <button className="btn btn-sm" onClick={() => restore(k)}>Restore</button>
                    )}
                    {k.source === 'local' && (
                      <button className="btn btn-sm btn-danger" onClick={() => deleteLocal(k)}>Delete</button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">No keywords match the current filters.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}
