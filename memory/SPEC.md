# JARVIS — Kişisel Otonom Komuta Merkezi (SPEC)

Turkish-language, voice-first, multi-agent personal AI OS for a software-developer student.
Desktop-first cinematic command center. No auth, no login — single local user.

## Stack / wiring
- Backend: FastAPI, all routes on `api_router` (`/api`). Mongo via motor.
- Brain: **Gemini 3 (`gemini-3.1-pro-preview`)** through `emergentintegrations` using
  `EMERGENT_LLM_KEY` in `backend/.env`.
- Live web: Gemini **googleSearch grounding** (keyless). DuckDuckGo HTML scraping is
  blocked by anti-bot (202) in this pod — do not reintroduce it.
- TTS: **Edge-TTS `tr-TR-AhmetNeural`** → `POST /api/voice/speak` returns mp3.
  Frontend falls back to browser Web Speech synthesis if that call fails.
- STT: browser Web Speech API, `lang=tr-TR` (Chrome/Edge only; unsupported browsers get a
  clear Turkish message and the typed path still works).
- Frontend: Vite + React 19 + Tailwind v4. Fonts Sora / DM Sans / JetBrains Mono.
  Theme: void black `#060a14`, cyan `#00f0ff`, glassmorphism panels, grid + particle canvas.

## Architecture: orchestrator + 6 sub-agents
`lib/brain.py` holds one Gemini chat with the Turkish persona and a toolbelt. Gemini routes
intent by picking a tool; we execute it for real, then it narrates the result in Turkish.

| Tool | Agent id | Real action |
|---|---|---|
| `web_arastir` | `web_browser` | live grounded search / flight comparison, saved to `webscans` |
| `muzik_cal` / `muzik_durdur` | `media_os` | real YouTube search (ytInitialData scrape), browser embeds and plays |
| `terminal_calistir` | `dev_core` | real shell in `/app` under sandbox policy |
| `proje_tara` | `dev_core` | real `git branch` / `git log` / `git status` read |
| `gorev_ekle`, `gorev_tamamla`, `proje_durumu` | `executive_briefing` | task + project CRUD |
| `not_kaydet` | `research_study` | note persisted |
| `gun_ozeti` | `executive_briefing` | reads today's real `activities` rows |
| `sistem_durumu` | `media_os` | real psutil CPU/RAM/disk |

No tool used → `companion_vision` (chat / image analysis). Images go in as base64
`ImageContent` on the same Gemini turn.

## Terminal sandbox policy (`lib/shell.py`)
- `safe` → runs immediately (ls, git, python, cat, df …).
- `confirm` → returns `needs_confirm=true` + Turkish reason; UI shows a confirm dialog; the
  retry sends `confirm=true` (rm, sudo, kill, mv, chmod, git reset/clean/force-push …).
- `blocked` → never runs (mkfs, dd to /dev/, shutdown, fork bomb, rm -rf /, curl|sh).
- cwd `/app`, 25s timeout, output capped at 12k chars.

## Memory
Cross-session: `build_memory()` injects settings rules, open projects/courses, pending tasks
and the last 12 turns of this session into the system prompt. Messages persist in `messages`.

## Data model (collections)
`messages`, `activities` (the briefing's only source of truth), `projects`, `tasks`, `notes`,
`webscans`, `briefings`, `settings` (single doc, `key:"settings"`).
Every doc has a string uuid4 `id`; datetimes stored aware UTC, normalised on read by
`lib/activity.clean()`.

## Key endpoints (all under /api)
- `POST /chat`, `GET|DELETE /chat/history`
- `POST /voice/speak` (mp3), `GET /voice/voices`
- `POST /web/search`, `GET /web/scans`
- `POST /media/search`, `POST /media/log`
- `POST /system/exec`, `GET /system/classify`, `GET /system/scan`, `GET /system/metrics`
- `GET|POST /projects`, `PATCH|DELETE /projects/{id}`
- `GET|POST /tasks`, `PATCH|DELETE /tasks/{id}`
- `GET|POST /notes`, `DELETE /notes/{id}`, `POST /research`
- `GET /activities`, `POST /briefing`, `GET /briefing/latest`
- `GET|PATCH /settings`

## UI surfaces (single page, sidebar switches the centre column)
Komuta Merkezi (orb + chat + media + right rail), Sohbet & Görsel, Projeler & Kodlama,
Terminal & Konsol, Web & Bilet Ajanı, Araştırma Notları, Günlük Brief, Ayarlar.

Orb states: `idle` / `listening` (mic amplitude) / `thinking` / `speaking` (TTS audio
analyser amplitude) — read from `data-orb-state` on `jarvis-orb-container`.

## Seed facts (backend/seed.py, idempotent)
- settings doc with `user_name: "Patron"`, voice `tr-TR-AhmetNeural`, voice_enabled + auto_speak true.
- 4 projects: "JARVIS AI OS" (project, 70%, no deadline), "Bitirme Projesi — Mobil Uygulama"
  (project, 35%, today+45d), "Veri Yapıları ve Algoritmalar" (course, 60%, today+21d),
  "İşletim Sistemleri" (course, 45%, today+6d).
- 4 tasks, 2 of them `high` priority with due dates (today+6d, today+12d).
- **Deadlines are relative to the server's today**, computed by `in_days()` in seed.py, and
  re-anchored on re-run if a seeded date has gone stale. Never assert on a literal date in a
  test — assert the radar shows a day count (e.g. `6g`) and no `gecikti` row.
- Activities / web scans / briefings are NEVER seeded — only real actions create them.

## Known deliberate behaviours
- `/chat` is non-streaming JSON (it uses `stream_message()` internally and accumulates), so a
  turn that triggers tools can take 10-40s. The orb shows `thinking` throughout.
- Browser autoplay policy: the first TTS playback needs a prior user gesture; before that the
  orb returns to idle silently instead of throwing.
- Voice features require Chrome/Edge; Playwright/Chromium has no STT engine, so automated
  tests must drive the typed path and assert the TTS endpoint separately.
