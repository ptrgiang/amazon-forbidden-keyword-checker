# Amazon Forbidden Keyword Checker

A Chrome/Edge Manifest V3 extension that detects Amazon-restricted keywords while you write in Amazon Seller Central, Google Docs, Google Sheets, and standard website fields.

Everything runs locally in the browser. There is no backend, analytics, tracking, remote script loading, or AI API call. The only network request is the keyword-sheet refresh from Google.

## Features

- Live keyword highlighting in text inputs, textareas, contenteditable fields, Amazon Seller Central fields, Google Docs, and Google Sheets.
- Google Sheets support for canvas-rendered cells, the in-cell editor, and the formula bar.
- Right-click "Scan selected text" context menu with a compact results panel.
- Popup Manual Scan mode with inline highlights inside the popup input.
- Local keyword overrides: add local terms, edit terms, disable terms, restore remote terms, and export the merged list as CSV.
- Per-site enable/disable controls with managed-site defaults for `docs.google.com` and `sellercentral.amazon.com`.
- Language filtering based on the keyword sheet columns.

## Installation

### Download With Windows PowerShell

Open PowerShell and run:

```powershell
$Out = "$env:USERPROFILE\AmazonForbiddenKeywordChecker"
$Headers = @{ "User-Agent" = "AmazonForbiddenKeywordCheckerInstaller" }

Remove-Item -LiteralPath $Out -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $Out -Force | Out-Null

function Save-GitHubDirectory($ApiUrl, $TargetRoot) {
  $Items = Invoke-RestMethod -Uri $ApiUrl -Headers $Headers
  foreach ($Item in $Items) {
    if ($Item.type -eq "dir") {
      Save-GitHubDirectory $Item.url $TargetRoot
    } elseif ($Item.type -eq "file") {
      $Relative = $Item.path.Substring("dist/".Length)
      $Target = Join-Path $TargetRoot $Relative
      New-Item -ItemType Directory -Path (Split-Path -Parent $Target) -Force | Out-Null
      Invoke-WebRequest -Uri $Item.download_url -OutFile $Target -UseBasicParsing
    }
  }
}

Save-GitHubDirectory "https://api.github.com/repos/ptrgiang/amazon-forbidden-keyword-checker/contents/dist?ref=main" $Out
Write-Host "Extension folder: $Out"
```

Then load the extension:

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select:

```powershell
$env:USERPROFILE\AmazonForbiddenKeywordChecker
```

## Requirements For Development

- Node.js 18 or newer
- npm
- Chrome or Edge

## Build From Source

```bash
npm install
npm run build
npm test
```

The production extension is emitted to `dist/`. This repository keeps `dist/` committed so non-technical users can download just that folder and load it directly.

Useful development commands:

```bash
npm run typecheck
npm run test:watch
```

## Load A Local Build In Chrome Or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the `dist/` folder.
5. Pin the extension and click Refresh keywords if the initial sync has not completed.

After changing source files, run `npm run build` again and reload the unpacked extension.

## Keyword Source

The default read-only keyword source is a public Google Sheet:

- Spreadsheet ID: `1s3kkNNsp2rKFVCLtHipmnQpxxVAFsjPg`
- Sheet GID: `1519025367`

The background service worker downloads the sheet through Google's public CSV endpoint. Refresh failures do not replace the last valid local cache.

Sheet parsing rules:

- Row 1 contains language names.
- Every non-empty header column is treated as one language.
- Terms are trimmed, whitespace is collapsed, and text is NFC-normalized.
- Duplicate terms are merged while preserving all language labels.
- New language columns are detected on refresh.

## Popup

The popup provides:

- Enable on this site toggle.
- Live Scan / Manual Scan mode switch.
- Manual Scan text box when Manual Scan is selected.
- Refresh keywords button.
- Language selector.
- Sync status, keyword count, language count, and source sheet link.
- Manage keywords and Manage sites links.

Unknown sites are disabled by default. Enabling a site in the popup adds it to Manage Sites.

## Options Pages

### Manage Keywords

Manage Keywords stores local overrides on top of the read-only Google Sheet. You can:

- Add local keywords.
- Add local languages.
- Edit keyword text.
- Disable or enable keywords.
- Restore edited remote keywords.
- Delete locally added keywords.
- Filter by language, source, and status.
- Export the merged keyword list as CSV.

### Manage Sites

Manage Sites lets you:

- Enable or disable a saved site with a row toggle.
- Select rows with checkboxes.
- Delete selected saved sites.

Hostnames are normalized locally, including removal of `www.`.

## Site Behavior

| Site | Behavior |
| --- | --- |
| Standard websites | Scans `input`, `textarea`, and `contenteditable` fields. Password, payment, hidden, disabled, and read-only fields are skipped. |
| Amazon Seller Central | Scans listing fields and iframed editors that expose normal editable fields. |
| Google Docs | Uses Google editor annotation rendering to scan rendered text and draw non-destructive overlays. Reload the tab once after installing or updating the extension. |
| Google Sheets | Scans canvas-rendered visible cells, the in-cell editor, and the formula bar. Startup wake runs several times to catch Sheets after the first grid paint. |

Hovering a live highlight shows the keyword, language badges, and source badge.

## Privacy And Permissions

Requested extension permissions:

- `storage` for keyword cache, settings, local overrides, and managed sites.
- `contextMenus` for Scan selected text.
- `activeTab` and `scripting` so the popup can enable and rescan the current page without forcing a reload.

Host permissions:

- `https://docs.google.com/*` for the public keyword-sheet export endpoints and Google editor support.
- `https://*.googleusercontent.com/*` for Google export redirects.

The content script can run on HTTP/HTTPS pages, but live scanning stays off for unknown sites until the user enables the site.

## Project Structure

```text
public/                 Manifest, docs-main page hook, generated icons
scripts/                Build helpers
src/background/         Service worker, sheet sync, context menu
src/content/            Live scan engine, site adapters, overlays, panels
src/lib/                Parser, matcher, merge, storage, message contracts
src/options/            Manage Keywords and Manage Sites React UI
src/popup/              Popup React UI
src/ui/                 Shared UI pieces and Manual Scan
tests/                  Vitest unit tests
testpage/               Local static harnesses; run build first
```

## Local Harnesses

After `npm run build`, open these files directly in a browser:

- `testpage/index.html` for standard fields.
- `testpage/docs.html` for annotated Google Docs-style SVG text.

They load `../dist/content.js`, so rebuild before using them.

## Verification Checklist

Before publishing or tagging a release:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Manual checks:

- Load `dist/` as an unpacked extension.
- Refresh keywords from the popup.
- Enable a normal website and type a known forbidden term into a textarea.
- Toggle the site off and confirm highlights disappear.
- Use right-click Scan selected text on static page text.
- Test Google Docs after one tab reload.
- Test Google Sheets view mode, in-cell edit mode, center-aligned cells, formula bar, scroll, and sheet tab switching.
- Test Amazon Seller Central listing fields if you have access.

## GitHub Publishing Notes

Recommended source repository contents:

- Commit source files, tests, `package.json`, `package-lock.json`, and `dist/`.
- Do not commit `node_modules/` or generated `public/icons/`.
- Use GitHub Actions CI in `.github/workflows/ci.yml` to verify pull requests and pushes.
- Run `npm run build` before publishing so `dist/` matches the source.
- Users who install with the PowerShell command should load the generated `AmazonForbiddenKeywordChecker` folder as the unpacked extension.

No license file is included yet. Add one before publishing publicly if you want to grant open-source usage rights.
