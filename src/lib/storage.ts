import type {
  LocalOverrides,
  RemoteDataset,
  Settings,
  SyncStatus
} from './types';
import { DEFAULT_MANAGED_SITES, DEFAULT_SETTINGS, EMPTY_OVERRIDES } from './types';

/** chrome.storage.local keys. */
export const KEYS = {
  remote: 'afkc.remoteKeywords',
  overrides: 'afkc.localOverrides',
  settings: 'afkc.settings',
  syncStatus: 'afkc.syncStatus'
} as const;

export interface StoredState {
  remote: RemoteDataset | null;
  overrides: LocalOverrides;
  settings: Settings;
  syncStatus: SyncStatus;
}

function uniqueSites(sites: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const site of sites) {
    const normalized = normalizeSiteHost(site);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

export function normalizeSiteHost(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (!value) return null;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    const host = parsed.hostname.replace(/\.$/, '').replace(/^www\./, '');
    if (!host || host.includes('*')) return null;
    return host;
  } catch {
    return null;
  }
}

export function normalizeSettings(raw: Partial<Settings> | undefined): Settings {
  const hadManagedSites = Array.isArray(raw?.managedSites);
  const rawSiteEnabled = raw?.siteEnabled ?? {};
  const siteEnabled: Record<string, boolean> = hadManagedSites
    ? {}
    : { ...DEFAULT_SETTINGS.siteEnabled };

  for (const [site, enabled] of Object.entries(rawSiteEnabled)) {
    const normalized = normalizeSiteHost(site);
    if (normalized) siteEnabled[normalized] = Boolean(enabled);
  }

  const managedSites = hadManagedSites
    ? uniqueSites(raw?.managedSites ?? [])
    : uniqueSites([...DEFAULT_MANAGED_SITES, ...Object.keys(siteEnabled)]);

  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    managedSites,
    siteEnabled,
    defaultSiteEnabled: hadManagedSites ? raw?.defaultSiteEnabled ?? false : false
  };
}

export async function loadState(): Promise<StoredState> {
  const raw = await chrome.storage.local.get([
    KEYS.remote,
    KEYS.overrides,
    KEYS.settings,
    KEYS.syncStatus
  ]);
  return {
    remote: (raw[KEYS.remote] as RemoteDataset | undefined) ?? null,
    overrides: { ...EMPTY_OVERRIDES, ...(raw[KEYS.overrides] as LocalOverrides | undefined) },
    settings: normalizeSettings(raw[KEYS.settings] as Partial<Settings> | undefined),
    syncStatus: (raw[KEYS.syncStatus] as SyncStatus | undefined) ?? { state: 'idle' }
  };
}

export async function saveRemote(remote: RemoteDataset): Promise<void> {
  await chrome.storage.local.set({ [KEYS.remote]: remote });
}

export async function saveOverrides(overrides: LocalOverrides): Promise<void> {
  await chrome.storage.local.set({ [KEYS.overrides]: overrides });
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [KEYS.settings]: normalizeSettings(settings) });
}

export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await chrome.storage.local.set({ [KEYS.syncStatus]: status });
}

function matchesSite(hostname: string, site: string): boolean {
  return hostname === site || hostname.endsWith(`.${site}`);
}

function findMostSpecificSite(hostname: string, sites: string[]): string | undefined {
  let match: string | undefined;
  for (const site of sites) {
    if (matchesSite(hostname, site) && (!match || site.length > match.length)) {
      match = site;
    }
  }
  return match;
}

/** Is scanning enabled for this origin (hostname)? */
export function isSiteEnabled(settings: Settings, hostname: string): boolean {
  const site = normalizeSiteHost(hostname);
  if (!site) return false;
  const matchedSite = findMostSpecificSite(site, Object.keys(settings.siteEnabled));
  const v = matchedSite ? settings.siteEnabled[matchedSite] : undefined;
  return v === undefined ? settings.defaultSiteEnabled : v;
}

export function isSiteManaged(settings: Settings, hostname: string): boolean {
  const site = normalizeSiteHost(hostname);
  return site ? findMostSpecificSite(site, settings.managedSites) !== undefined : false;
}

export function setSiteEnabled(settings: Settings, hostname: string, enabled: boolean): Settings {
  const site = normalizeSiteHost(hostname);
  if (!site) return settings;
  return normalizeSettings({
    ...settings,
    managedSites: [...settings.managedSites, site],
    siteEnabled: { ...settings.siteEnabled, [site]: enabled }
  });
}

export function deleteManagedSite(settings: Settings, hostname: string): Settings {
  const site = normalizeSiteHost(hostname);
  if (!site) return settings;
  const siteEnabled = { ...settings.siteEnabled };
  delete siteEnabled[site];
  return normalizeSettings({
    ...settings,
    managedSites: settings.managedSites.filter((managedSite) => managedSite !== site),
    siteEnabled
  });
}
