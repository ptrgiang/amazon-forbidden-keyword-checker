import { useMemo, useState } from 'react';
import {
  deleteManagedSite,
  isSiteEnabled,
  saveSettings,
  setSiteEnabled
} from '../lib/storage';
import type { StoredState } from '../lib/storage';

export function ManageSites({ state }: { state: StoredState }): JSX.Element {
  const [selectedSites, setSelectedSites] = useState<Set<string>>(new Set());
  const settings = state.settings;
  const sites = useMemo(
    () => [...settings.managedSites].sort((a, b) => a.localeCompare(b)),
    [settings.managedSites]
  );

  const toggleSite = (site: string, enabled: boolean): void => {
    void saveSettings(setSiteEnabled(settings, site, enabled));
  };

  const toggleSelected = (site: string, selected: boolean): void => {
    setSelectedSites((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(site);
      } else {
        next.delete(site);
      }
      return next;
    });
  };

  const deleteSelectedSites = (): void => {
    if (selectedSites.size === 0) return;
    const nextSettings = [...selectedSites].reduce(
      (currentSettings, site) => deleteManagedSite(currentSettings, site),
      settings
    );
    setSelectedSites(new Set());
    void saveSettings(nextSettings);
  };

  return (
    <div className="card">
      <h2>Manage Sites</h2>
      <div className="muted small">
        Sites are added from the popup by enabling the current site.
      </div>
      <div className="site-table-toolbar">
        <button
          className="btn btn-danger"
          onClick={deleteSelectedSites}
          disabled={selectedSites.size === 0}
        >
          Delete
        </button>
      </div>
      <table className="kw site-table">
        <thead>
          <tr>
            <th>Select</th>
            <th>Site</th>
            <th>Status</th>
            <th>Enabled</th>
          </tr>
        </thead>
        <tbody>
          {sites.length === 0 && (
            <tr>
              <td colSpan={4} className="muted">
                No sites saved.
              </td>
            </tr>
          )}
          {sites.map((site) => {
            const enabled = isSiteEnabled(settings, site);
            return (
              <tr key={site} className={enabled ? undefined : 'disabled'}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${site} for deletion`}
                    checked={selectedSites.has(site)}
                    onChange={(e) => toggleSelected(site, e.target.checked)}
                  />
                </td>
                <td>{site}</td>
                <td>{enabled ? 'Enabled' : 'Off'}</td>
                <td>
                  <span className="switch">
                    <input
                      type="checkbox"
                      aria-label={`Enable ${site}`}
                      checked={enabled}
                      onChange={(e) => toggleSite(site, e.target.checked)}
                    />
                    <span className="slider" />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
