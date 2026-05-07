# Finance Tracker

Особистий фінансовий трекер для двох. Фотографуєш чек → AI розпізнає товари → ти редагуєш і зберігаєш у БД. Аналітика по місяцях, категоріях, користувачах. Працює з телефона і з ноутбука.

## Status — migration in progress (2026-05-07)

Перехід зі старого стеку (Google Apps Script + Google Sheets + Alpine.js) на новий (React + Vite + Tailwind + TanStack Query + Supabase + Cloudflare Pages).

- **`/legacy/apps-script/`** — старий працюючий додаток. Заморожений; зберігається для довідки і emergency rollback. Див. [`legacy/apps-script/README.md`](legacy/apps-script/README.md).
- **`/web/`** — новий React-додаток (будується).
- **`/packages/domain/`** — спільний TS-пакет із бізнес-логікою (Zod схеми, фабрики, ULID, pair detector). Імпортується і клієнтом, і Edge Function.
- **`/supabase/`** — Supabase workspace (міграції БД, Edge Functions, seed).
- **`/docs/`** — ADR-и і архітектурні документи (universal — покривають обидва стеки).

План міграції: [`~/.claude/plans/modular-swinging-blossom.md`](#) (локально). Коротко: 11 фаз, ~33 год роботи, $0/місяць операційно.

## Tech stack (target)

- **Frontend:** React 19 + Vite 8 + Tailwind 4 + TanStack Query 5 + TanStack Router → Cloudflare Pages
- **Backend platform:** Supabase (Postgres + Auth + Storage + Edge Functions)
- **Domain:** TypeScript + Zod (shared package)
- **AI:** Gemini 3 Flash (primary) + Claude Sonnet 4.6 (fallback) — proxied via Edge Function
- **FX:** NBU live rates for UAH (no key required, called directly from browser)

## Documentation

- [`docs/decisions/`](docs/decisions/) — ADR-и з причинами рішень (ADR-0001–0012; ADR-0013 на міграцію — буде додано).
- [`docs/architecture.md`](docs/architecture.md) — буде переписано під новий стек у Phase 10.
- [`docs/data-model.md`](docs/data-model.md) — буде переписано на Postgres-схему у Phase 3.
- [`docs/project-status.md`](docs/project-status.md) — буде переписано після MVP.
- [`conversation.md`](conversation.md) — повна історія дизайн-дискусій.

## License

Personal project, all rights reserved.
