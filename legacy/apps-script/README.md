# Finance Tracker — legacy Apps Script app (frozen)

**Frozen on 2026-05-07. Cutover to new stack on 2026-05-08** (see [ADR-0013](../../docs/decisions/0013-migrate-to-react-supabase.md)). This is the original Google Apps Script + Google Sheets implementation. It was retired in favor of the new React + Supabase + Cloudflare Pages stack at [`/web`](../../web/) + [`/supabase`](../../supabase/).

The code here is preserved verbatim so we can:
- Reference business rules, prompts, and edge-case handling for any future work (`Domain.js`, `Gemini.js`, `Anthropic.js`, `pairDetector.html`).
- Re-deploy the old web app for emergency rollback. The Apps Script project at `scriptId` in `.clasp.json` is left intact for **90 days post-cutover** (until 2026-08-06).

## Reactivating the legacy app

```bash
cd legacy/apps-script
npm install
npm run lint
npm run typecheck
npm run test
npm run push      # clasp push to the Apps Script project
```

Then F5 the Apps Script editor tab.

## Authoritative architectural docs

These live at the repo root, not in this folder, because they cover both legacy and the new stack:

- [`/docs/decisions/`](../../docs/decisions/) — ADRs 0001–0013. ADR-0001 (Sheets), 0002 (Apps Script), 0005 (Alpine), 0006 (separate pages), 0010 (web app access) marked `superseded by 0013`.
- [`/docs/data-model.md`](../../docs/data-model.md) — Sheet schema (legacy reference only; new stack uses Postgres — see [`/supabase/migrations/`](../../supabase/migrations/)).
- [`/docs/project-status.md`](../../docs/project-status.md) — current state of the new stack (Phase 10 = live).
- [`/conversation.md`](../../conversation.md) — full design-discussion history (long).

## What was here

Phases 0–3.6 complete: backbone, Gemini integration, web UI (5 pages), pair-grouping (ADR-0012), Claude fallback (ADR-0011). 113 green tests at the time of freezing. The new stack ports all of this and adds `/recent`, `/edit/$id`, `/photo`, `/stats` plus magic-link auth.

## Emergency rollback procedure

If the new app breaks badly within 90 days of cutover:

1. `cd legacy/apps-script && npm install` (clean checkout works from any post-archive commit; the legacy code is fully self-contained inside this folder).
2. `npm run push` — `clasp push` against the original Apps Script project ID stored in `.clasp.json`.
3. Open the Apps Script editor, re-deploy the web app (Deploy → New deployment → Web app), share the URL with both users.
4. Open an issue to investigate the new stack.

Sheet data and the Apps Script project are untouched — re-pointing both users to the legacy URL is the entire rollback. The legacy app reads its own `SHEET_ID` from Apps Script Properties; it has its own auth model (server-side allowlist via `Config.ALLOWED_EMAILS`, see [ADR-0010](../../docs/decisions/0010-web-app-access-mode.md)) — no Supabase dependency.
