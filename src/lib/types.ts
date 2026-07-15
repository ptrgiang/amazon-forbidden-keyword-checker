/** A keyword coming from the remote Google Sheet. */
export interface RemoteKeyword {
  /** Original display text as it appears in the sheet (trimmed). */
  term: string;
  /** Normalized matching key (NFC, lowercased, collapsed whitespace). */
  key: string;
  /** Language labels this term belongs to (a term can exist in several columns). */
  languages: string[];
}

/** Latest successfully synced sheet contents. */
export interface RemoteDataset {
  languages: string[];
  keywords: RemoteKeyword[];
  /** Millis of last successful sync. */
  syncedAt: number;
  sourceUrl: string;
  /** SHA-256 of the raw downloaded bytes; used to detect changes. */
  sourceHash: string;
  /** Which endpoint produced this dataset. */
  format: 'csv';
}

/** A keyword added locally by the user. */
export interface LocalKeyword {
  id: string;
  term: string;
  languages: string[];
  replacement?: string;
  disabled?: boolean;
  createdAt: number;
}

/** A local override applied on top of a remote keyword, addressed by its key. */
export interface RemoteEdit {
  /** Normalized key of the remote keyword this edit applies to. */
  key: string;
  /** Locally edited display/matching text (optional). */
  term?: string;
  replacement?: string;
  disabled?: boolean;
}

export interface LocalOverrides {
  added: LocalKeyword[];
  edits: Record<string, RemoteEdit>;
  /** Languages created locally (beyond what the sheet defines). */
  extraLanguages: string[];
}

/** A merged, ready-to-match keyword entry. */
export interface MergedKeyword {
  /** Stable id: `r:<key>` for remote, `l:<id>` for local additions. */
  id: string;
  term: string;
  key: string;
  languages: string[];
  source: 'remote' | 'local';
  replacement?: string;
  disabled: boolean;
  /** True when a remote keyword has a local edit applied. */
  edited: boolean;
}

export interface Settings {
  mode: 'live' | 'manual';
  /** Hostnames shown in Manage Sites. Disabled sites remain listed. */
  managedSites: string[];
  /** Per-origin enabled flags. Missing entry means the default below. */
  siteEnabled: Record<string, boolean>;
  /** Unknown sites are off by default; enabling from the popup adds the site. */
  defaultSiteEnabled: boolean;
  /**
   * null = "all languages" (newly detected languages auto-enabled).
   * Otherwise the explicit list the user saved.
   */
  selectedLanguages: string[] | null;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'ok' | 'error';
  lastError?: string;
  lastAttemptAt?: number;
}

export interface Violation {
  /** Char offset in the scanned text (original indices). */
  start: number;
  end: number;
  /** The exact text found in the document. */
  found: string;
  keyword: MergedKeyword;
}

export const SPREADSHEET_ID = '1s3kkNNsp2rKFVCLtHipmnQpxxVAFsjPg';
export const SHEET_GID = '1519025367';
export const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit?gid=${SHEET_GID}`;
export const CSV_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;

export const DEFAULT_MANAGED_SITES = ['docs.google.com', 'sellercentral.amazon.com'];

export const DEFAULT_SETTINGS: Settings = {
  mode: 'live',
  managedSites: DEFAULT_MANAGED_SITES,
  siteEnabled: {
    'docs.google.com': true,
    'sellercentral.amazon.com': true
  },
  defaultSiteEnabled: false,
  selectedLanguages: null
};

export const EMPTY_OVERRIDES: LocalOverrides = {
  added: [],
  edits: {},
  extraLanguages: []
};
