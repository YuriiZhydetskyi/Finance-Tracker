# Finance Tracker — legacy Apps Script app (frozen)

**Frozen on 2026-05-07.** This is the original Google Apps Script + Google Sheets implementation. It was retired in favor of the new React + Supabase stack at the repo root (see [`/web`](../../web/) and [`/supabase`](../../supabase/) once they exist).

The code here is preserved verbatim so we can:
- Reference business rules, prompts, and edge-case handling during the rewrite (`Domain.js`, `Gemini.js`, `Anthropic.js`, `pairDetector.html`).
- Re-deploy the old web app for emergency rollback during cutover (the Apps Script project at `scriptId` in `.clasp.json` is still alive).

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

- [`/docs/decisions/`](../../docs/decisions/) — ADRs 0001–0012 (some marked superseded by ADR-0013 on migration).
- [`/docs/data-model.md`](../../docs/data-model.md) — Sheet schema (legacy reference only; new stack uses Postgres).
- [`/docs/architecture.md`](../../docs/architecture.md) — describes the new stack post-migration.
- [`/conversation.md`](../../conversation.md) — full design-discussion history.

## What was here

Phases 0–3.6 complete: backbone, Gemini integration, web UI (5 pages), pair-grouping (ADR-0012), Claude fallback (ADR-0011). 113 green tests at the time of freezing. See [`/docs/project-status.md`](../../docs/project-status.md) for the snapshot.
