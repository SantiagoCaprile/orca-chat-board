// Panel styles, injected at load (the generated page has no stylesheet of ours).
export const CSS = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--orca-background);
  color: var(--orca-foreground);
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  display: flex; flex-direction: column; overflow: hidden;
}
button { font: inherit; color: inherit; cursor: pointer; }
input, textarea {
  font: inherit; color: var(--orca-foreground); background: var(--orca-background);
  border: 1px solid var(--orca-input); border-radius: 4px; padding: 3px 6px; width: 100%;
}
input:focus, textarea:focus, button:focus-visible, .card:focus-visible {
  outline: 2px solid var(--orca-ring); outline-offset: -1px;
}

.toolbar {
  display: flex; gap: 6px; align-items: center; padding: 8px;
  border-bottom: 1px solid var(--orca-border); flex: none;
}
.toolbar input { flex: 1; min-width: 60px; }
.ghost {
  background: none; border: 1px solid transparent; border-radius: 4px; padding: 2px 6px;
  color: var(--orca-muted-foreground);
}
.ghost:hover { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.error {
  margin: 6px 8px 0; padding: 6px 8px; border-radius: 4px; flex: none;
  background: color-mix(in srgb, var(--orca-destructive) 15%, transparent);
  color: var(--orca-foreground);
}

.board {
  flex: 1; overflow: auto; padding: 8px; display: flex; gap: 8px;
  align-items: flex-start; min-height: 0;
}
.board > .column { flex: 1 1 200px; min-width: 200px; }
.board > .column.collapsed { flex: 0 0 34px; min-width: 34px; }
.card, .column-head { flex: none; }

/* Collapsed column: a narrow strip with the count and the title running down. */
.column.collapsed {
  cursor: pointer; align-items: center; padding: 6px 0 10px; gap: 8px; min-height: 160px;
  background: color-mix(in srgb, var(--col) 14%, var(--orca-card));
}
.column.collapsed:hover { background: color-mix(in srgb, var(--col) 24%, var(--orca-card)); }
.column.collapsed .strip-title {
  writing-mode: vertical-rl; font-weight: 600; white-space: nowrap;
  color: color-mix(in srgb, var(--col) 70%, var(--orca-foreground));
}

@media (max-width: 420px) {
  .board { flex-direction: column; align-items: stretch; }
  .board > .column, .board > .column.collapsed { flex: none; min-width: 0; }
  .column.collapsed { flex-direction: row; min-height: 0; padding: 6px 8px; }
  .column.collapsed .strip-title { writing-mode: horizontal-tb; flex: 1; }
}

.column {
  --col: #4f8ff7;
  background: color-mix(in srgb, var(--col) 6%, var(--orca-card)); color: var(--orca-card-foreground);
  border: 1px solid color-mix(in srgb, var(--col) 35%, var(--orca-border));
  border-top: 3px solid var(--col); border-radius: var(--orca-radius, 6px);
  display: flex; flex-direction: column; min-height: 60px;
}
.column-head {
  display: flex; align-items: center; gap: 4px; padding: 6px 8px;
  background: color-mix(in srgb, var(--col) 16%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--col) 30%, var(--orca-border));
}
.column-title { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: color-mix(in srgb, var(--col) 70%, var(--orca-foreground)); }
.count { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 11px; padding: 0 6px; border-radius: 9px;
  background: color-mix(in srgb, var(--col) 30%, transparent); color: var(--orca-foreground); }
.column-body { padding: 6px; display: flex; flex-direction: column; gap: 6px; min-height: 40px; }
.column.drop-target { border-color: var(--orca-primary); }
.column.drop-target { border-color: var(--col); box-shadow: 0 0 0 1px var(--col); }
.drop-line { height: 2px; background: var(--col); border-radius: 1px; margin: -4px 0; }
.empty { color: var(--orca-muted-foreground); text-align: center; padding: 8px 0; font-size: 11px; }

.card {
  --st: var(--orca-border);
  background: color-mix(in srgb, var(--st) 7%, var(--orca-background));
  border: 1px solid var(--orca-border); border-left: 3px solid var(--st);
  border-radius: 5px; padding: 6px 8px; cursor: grab; position: relative;
}
.card:hover { border-color: color-mix(in srgb, var(--col) 60%, var(--orca-border)); border-left-color: var(--st); }
.card.st-working { --st: #4f8ff7; }
.card.st-blocked { --st: #e5484d; }
.card.st-waiting { --st: #f0a020; }
.card.st-done { --st: #2fb170; }
.card.st-interrupted { --st: #e5484d; }

.status { width: 16px; height: 16px; flex: none; display: inline-flex; margin-top: 1px; }
.status svg { width: 100%; height: 100%; }
.status.working { color: #4f8ff7; }
.status.working svg { animation: spin 0.9s linear infinite; }
.status.waiting { color: #f0a020; }
.status.waiting svg { animation: tip 2.4s ease-in-out infinite; }
.status.done { color: #2fb170; }
.status.interrupted { color: #e5484d; }
.status.blocked { color: #f76b15; }
.status.closed { color: var(--orca-muted-foreground); }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes tip { 0%, 70% { transform: rotate(0); } 85%, 100% { transform: rotate(180deg); } }
@media (prefers-reduced-motion: reduce) { .status svg { animation: none !important; } }
.card.dragging { opacity: .4; }
.card.closed { opacity: .65; cursor: default; }
.card-top { display: flex; gap: 6px; align-items: flex-start; }
.card-title { flex: 1; font-weight: 500; word-break: break-word; }
.card-meta { display: flex; gap: 6px; align-items: center; margin-top: 4px; flex-wrap: wrap;
  color: var(--orca-muted-foreground); font-size: 11px; }
.card-meta:empty { display: none; }
.chip { --c: #8b95a5; border: 1px solid color-mix(in srgb, var(--c) 45%, transparent); border-radius: 3px; padding: 0 4px;
  background: color-mix(in srgb, var(--c) 14%, transparent); color: color-mix(in srgb, var(--c) 65%, var(--orca-foreground)); }
.logo { width: 15px; height: 15px; display: inline-flex; flex: none; border-radius: 3px; }
.logo svg { width: 100%; height: 100%; }
.chip.agent-claude { --c: #d97757; }
.chip.agent-cursor { --c: #4f8ff7; }
.chip.agent-codex { --c: #10a37f; }
.chip.agent-gemini { --c: #9b6cf2; }
.chip.ws { --c: #1fb5b5; }
.note { margin-top: 4px; color: var(--orca-muted-foreground); white-space: pre-wrap; word-break: break-word; }
.card-actions { position: absolute; top: 3px; right: 3px; display: none; gap: 2px;
  background: var(--orca-background); border-radius: 4px; }
.card:hover .card-actions, .card:focus-within .card-actions { display: flex; }
.card-actions button { padding: 0 4px; }

.badge { --b: #8b95a5; border-radius: 9px; padding: 0 7px; font-size: 10px; font-weight: 600; white-space: nowrap;
  background: color-mix(in srgb, var(--b) 28%, transparent); color: color-mix(in srgb, var(--b) 55%, var(--orca-foreground));
  border: 1px solid color-mix(in srgb, var(--b) 50%, transparent); }
.badge.working { --b: #4f8ff7; }
.badge.blocked { --b: #e5484d; }
.badge.waiting { --b: #f0a020; }
.badge.done { --b: #2fb170; }
.badge.closed { background: var(--orca-muted); color: var(--orca-muted-foreground); }

.edit { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
.edit-actions { display: flex; gap: 4px; justify-content: flex-end; }
.primary { background: var(--orca-primary); color: var(--orca-primary-foreground);
  border: none; border-radius: 4px; padding: 2px 8px; }

details.archive { border-top: 1px solid var(--orca-border); padding: 6px 8px; flex: none; max-height: 40%; overflow: auto; }
details.archive summary { cursor: pointer; color: var(--orca-muted-foreground); }
details.archive .list { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
.danger { color: var(--orca-destructive); }
`
