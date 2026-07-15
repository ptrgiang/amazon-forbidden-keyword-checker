/** Injected stylesheet for all content-script UI. */

export const STYLE_ID = 'afkc-styles';

export const CSS = `
#afkc-overlay {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147483645;
}
.afkc-hl {
  position: fixed;
  background: rgba(220, 38, 38, 0.16);
  border-bottom: 2px solid #dc2626;
  border-radius: 2px;
  pointer-events: none;
  box-sizing: border-box;
}
::highlight(afkc-violation) {
  background-color: rgba(220, 38, 38, 0.16);
  text-decoration: underline;
  text-decoration-color: #dc2626;
  text-decoration-thickness: 2px;
}
::highlight(afkc-selection-violation) {
  background-color: rgba(220, 38, 38, 0.16);
  text-decoration: underline;
  text-decoration-color: #dc2626;
  text-decoration-thickness: 2px;
}
::highlight(afkc-page-violation) {
  background-color: rgba(220, 38, 38, 0.16);
  text-decoration: underline;
  text-decoration-color: #dc2626;
  text-decoration-thickness: 2px;
}
.afkc-popover, .afkc-panel {
  all: initial;
  position: fixed;
  z-index: 2147483646;
  font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #1f2328;
  background: #ffffff;
  border: 1px solid #d0d7de;
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.14);
  box-sizing: border-box;
}
.afkc-popover { max-width: 320px; padding: 10px 12px; }
.afkc-panel { width: 360px; max-height: 55vh; display: flex; flex-direction: column; }
.afkc-popover *, .afkc-panel * { all: revert; box-sizing: border-box; font: inherit; color: inherit; margin: 0; }
.afkc-title { font-weight: 600; margin-bottom: 4px; display: flex; align-items: center; gap: 6px; }
.afkc-term { color: #dc2626; font-weight: 600; word-break: break-word; }
.afkc-meta { color: #57606a; font-size: 12px; margin-bottom: 8px; }
.afkc-badge {
  display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 10px;
  border: 1px solid #d0d7de; color: #57606a; background: #f6f8fa;
}
.afkc-close:focus, .afkc-highlight-switch:focus {
  outline: none; box-shadow: none;
}
.afkc-panel-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; padding: 10px 12px; border-bottom: 1px solid #d0d7de; font-weight: 600;
}
.afkc-panel-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.afkc-panel-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.afkc-panel-body { padding: 10px 12px; overflow: auto; }
.afkc-panel-minimized .afkc-panel-head { border-bottom: none; }
.afkc-panel-minimized .afkc-panel-body { display: none; }
.afkc-highlight-switch {
  cursor: pointer; min-width: 72px; height: 22px; padding: 0 8px;
  border: 1px solid #d0d7de; border-radius: 999px; background: #f6f8fa;
  color: #57606a; font-size: 11px; line-height: 20px; text-align: center;
  white-space: nowrap;
}
.afkc-highlight-switch.active { background: #dc2626; border-color: #dc2626; color: #ffffff; }
.afkc-panel-item { padding: 6px 0; border-bottom: 1px solid #eaeef2; }
.afkc-panel-item-main { display: flex; align-items: center; gap: 8px; }
.afkc-panel-item-info { min-width: 0; flex: 1; }
.afkc-count-badge {
  flex: none; min-width: 24px; height: 20px; padding: 0 6px; border-radius: 10px;
  border: 1px solid #d0d7de; color: #57606a; background: #f6f8fa;
  font-size: 11px; line-height: 18px; text-align: center;
}
.afkc-panel-item:last-child { border-bottom: none; }
.afkc-close {
  cursor: pointer; border: none; background: none; font-size: 16px;
  color: #57606a; padding: 0 2px; line-height: 1;
}
.afkc-icon-btn {
  width: 22px; height: 22px; padding: 0; display: inline-flex;
  align-items: center; justify-content: center; font-size: 16px; font-weight: 700;
}
`;

export function injectStyles(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head ?? doc.documentElement).appendChild(style);
}
