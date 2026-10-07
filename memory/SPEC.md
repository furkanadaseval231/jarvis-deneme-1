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
| `kod_yamasi_oner` | `dev_core` | proposes a real unified diff against a real file (does NOT write) |
| `commit_tara` | `dev_core` | scans watched dirs for new git commits now |
| `bildirimleri_oku` | `executive_briefing` | unread notifications |

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

## Autonomous behaviours (phase 2)

### Wake word — "Hey Jarvis"
Frontend only, free.

**ONE SpeechRecognition engine, mode-switched** (`lib/jarvis.tsx`, `modeRef`: off | wake |
command). This is the critical constraint: a browser allows exactly ONE live recogniser.
The first implementation ran a separate wake recogniser alongside the command one, so
`start()` threw `InvalidStateError`, the mic button needed ~3 clicks and the wake word never
fired. Never reintroduce a second instance — switch `modeRef` instead; wake → command is a
flag flip on the live engine (no restart, no race, reacts on the first click).

Behaviour:
- Toggle: `settings.wake_word_enabled`. Header shows `wake-word-indicator` while armed.
- `matchesWakeWord()` / `stripWakeWord()` are exported and unit-verifiable. Matching runs on
  a space-collapsed copy, so split ASR output ("jar vis") still lands; variants covered:
  jarvis / carvis / çarvis / garvis / jervis / jarvıs / jarviz / carwis / jarves.
  Rejects near-misses: "servis aracı", "kervan", "garanti", "jar dosyası".
- Trailing words are the command: "Hey Jarvis müziği aç" fires in one breath.
- Command mode auto-submits after silence (900 ms after a final result, 1800 ms after an
  interim one). A second mic tap sends immediately.
- `onend` respawns the engine (Chrome ends continuous streams on silence / ~60 s).
- While `orbState === "speaking"` the wake listener is parked so JARVIS never hears itself,
  and re-arms afterwards **only if `modeRef === "off"`** — without that guard a mic tap during
  a spoken reply gets overwritten back to wake mode and the press appears to do nothing.
- Verified: 3 consecutive wake turns + 3 consecutive single-click mic turns + a 12-click
  storm all keep exactly 1 live engine and 1 total engine start; 8/8 commands delivered.

### Code patch apply (preview → confirm → write)
`lib/devtools.py`. A proposal NEVER writes: `build_proposal()` reads the file, locates the
`find` string, renders a unified diff and stores it in `patches` with `status: pending`.
`POST /dev/patches/{id}/apply` writes the file after copying the original to
`<file>.bak-YYYYmmdd-HHMMSS`. Guards: target must be under `/app`, never in
`node_modules`/`.git`/`.venv`/`__pycache__`/`.emergent`, max 400 KB, and apply re-checks that
`find` is still present (409 + Turkish reason if the file drifted).
UI: `PatchCard` renders the colourised diff with Uygula / Reddet; appears inline in chat
(via the `kod_yamasi_oner` action) and listed under Projeler & Kodlama → KOD YAMALARI.

### Morning brief (09:00 Europe/Istanbul)
Platform cron → `POST /api/cron/morning-brief` (Bearer `WEBHOOK_CRON_SECRET`, acks 202 and
backgrounds the work, idempotent per webhook run id via the `cron_runs` unique index, and
skipped if today's morning brief already exists). `build_morning_brief()` uses only real
data: open projects/courses, pending tasks with due dates, recent activity rows.
Stored as `Briefing(kind="morning")` + a `morning_brief` notification.
UI: `MorningGreeting` banner greets on open and speaks the report on the first user gesture
(browser autoplay policy), then marks `spoken: true` so it greets once per day.
`POST /api/briefing/morning` is the manual "Şimdi Üret" trigger.

### Commit watching
`scan_commits()` compares each watched dir's `git rev-parse HEAD` against `repo_state`.
First sight of a repo only records HEAD — it never floods the feed with pre-existing history.
New commits create a `commit` notification + a `dev_core` activity row. Idempotent: a second
scan with no new commits creates nothing.
Two cadences: the platform cron `*/15 * * * *` covers hours the app is closed (prod discards
anything under 15 min), and the dashboard itself polls `POST /dev/commits/scan` every 2
minutes while open. Toggle: `settings.commit_watch_enabled`.

## Cron inventory (`.emergent/crons.yml`)
| name | schedule | endpoint |
|---|---|---|
| morning-brief | `0 9 * * *` Europe/Istanbul | `/api/cron/morning-brief` |
| commit-watch | `*/15 * * * *` | `/api/cron/commit-watch` |

Both require `Authorization: Bearer $WEBHOOK_CRON_SECRET` (in `backend/.env`), return 202
immediately and run the job in a background task.

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
- `GET|POST /briefing/morning`, `POST /briefing/{id}/spoken`
- `POST /dev/patches`, `GET /dev/patches`, `POST /dev/patches/{id}/apply`, `POST /dev/patches/{id}/reject`
- `POST /dev/commits/scan`
- `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`
- `POST /cron/morning-brief`, `POST /cron/commit-watch` (Bearer secret, 202)
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
  tests must drive the typed path and assert the TTS endpoint separately. The wake-word
  indicator therefore renders 0 times in headless runs — that is expected, not a bug.
  To test the voice state machine, inject a fake `window.SpeechRecognition` via
  `addInitScript` (one that throws if a second instance starts, mirroring the real browser)
  and assert on the request body sent to `/api/chat`. Stubbing `/api/chat` means messages are
  never persisted, so do NOT assert on the chat stream in that setup — it reads the real DB.
  Set `auto_speak:false` during such a run so TTS playback does not muddy the orb states.
- The morning greeting speaks on the first user gesture, so a test that clicks anything
  before asserting the banner will find it already consumed. Assert it before any click.
- The Emergent LLM key has a budget cap; when it is exhausted every LLM route returns 502
  with a Turkish detail and the UI shows the error banner. Non-LLM features keep working.
  Symptom in logs: `litellm.RateLimitError: Budget has been exceeded`.
- `/app/ornek_hata.py` and its `.bak-*` file are a live demo of an applied patch, kept so the
  patch record in the UI is not dangling.
