# AI Exam Coach

A MERN application that turns a single recruitment notification PDF into a complete preparation system: extracted syllabus, AI lessons, adaptive quizzes, full CBT mock tests, a 60-day roadmap, analytics and an AI mentor that answers using your own performance data.

**Stack** — React (Vite) + Tailwind CSS · Node.js + Express · MongoDB (Mongoose) · Gemini via the official `@google/genai` SDK · JWT · Multer · pdf-parse

---

## Quick start

```bash
npm run install:all
```

Then create `backend/.env` yourself with at least these variables:

| Variable | Why it matters |
| --- | --- |
| `MONGO_URI` | Local `mongodb://127.0.0.1:27017/ai-exam-coach` or an Atlas connection string |
| `GEMINI_THINKING_LEVEL` | `minimal` / `low` / `medium` / `high`. Defaults to `low` because latency is dominated by output tokens |
| `GEMINI_GROUNDING` | `true` backs fact-heavy question generation with Google Search. Off by default — it uses a separate, smaller quota |
| `GEMINI_MODEL` | Defaults to `gemini-3.6-flash`. Google retires model ids over time — if the API returns a 404 naming a replacement, set it here |
| `GEMINI_FALLBACK_MODELS` | Comma-separated chain tried when the primary model is overloaded, retired or out of quota. Ends with the free `gemma-4-31b-it` |
| `GEMINI_FREE_MODEL` | The free model beneath the whole chain (default `gemma-4-31b-it`). Appended separately from `GEMINI_FALLBACK_MODELS` so setting that list cannot silently remove the floor. Empty string removes it |
| `MIN_PAPER_CONFIDENCE` | Confidence floor for a previous-year paper question (default 75). Higher than the practice-question floor on purpose |
| `GEMINI_API_KEY` | Get one at [aistudio.google.com/apikey](https://aistudio.google.com/apikey). Without it, every AI endpoint returns 500 |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Long random strings — do not ship the defaults |

Run both servers:

```bash
npm run dev
```

- API: http://localhost:5000 (health check at `/api/health`)
- Web: http://localhost:5173 (Vite proxies `/api` to the backend, so there is no CORS setup in dev)

### Optional: demo data

```bash
npm run seed
```

Creates `demo@examcoach.dev` / `demo1234` with a fully populated exam (5 subjects, 19 topics, a seeded question bank and some history) so you can explore the UI before wiring up a Gemini key.

### Bring your own key

AI Exam Coach runs on each learner's own Gemini API key. Every account adds its
own under **Settings → API Key**, and spends its own quota; a key is only ever
visible to, and only ever spent by, the account that added it. A learner with
no usable key sees a prompt to add one rather than a failure part-way into a
lesson.

`GEMINI_API_KEY` in the environment stays the operator's own. It is offered
only to an admin account, so signed-up learners cannot silently spend the
operator's quota.

The key ring resolves its owner from an `AsyncLocalStorage` request context
bound in `protect`, rather than threading a user id through every AI call —
analysis, lessons, questions, roadmaps, mock blueprints and mentor chat would
all have to carry an argument none of them otherwise needs. The store follows
the async chain, so background work a handler starts and does not await (the
upload pipeline, the question warm-up) still resolves the right owner's keys.

### One-off: giving existing API keys an owner

```bash
cd backend
npm run backfill-key-owners             # dry run
npm run backfill-key-owners -- --apply
```

Keys added before the ring became per-account carry no owner, which makes them
invisible to everyone. This copies `addedBy` into `user`.

You usually do not need it: a key is adopted automatically the next time the
account that added it reads its ring, so signing in is enough. The script is
for doing every account at once. Either way only rows whose `addedBy` matches
are touched — a key with neither is reported rather than guessed at, since
assigning someone else's key to an account would let it spend credits that are
not its own.

### One-off: realigning stored topic labels

```bash
cd backend
npm run snap-topics             # dry run — reports what would change, writes nothing
npm run snap-topics -- --apply  # makes the changes, after saving a backup
```

Topic labels were once written by three authors that never reconciled — the
notification analyser, the roadmap planner and the question generator — so a
roadmap day could point at "Current Affairs" while the syllabus said "General
Awareness and Current Affairs". `Exam.resolveTopic` now bridges that at read
time and new labels are snapped as they are written, so this script is only
for rows stored before both. Run the dry run first; it reads and reports only.

It refuses to run without an explicit `MONGO_URI` rather than falling back to
a local database, writes a `snap-topics-backup-*.json` copy of every document
it touches (gitignored — it contains learner data), and the only thing it ever
removes is a duplicate Progress row **after** summing its history into the
canonical one, so no answered question is lost.

---

## Deploying to Render

The repository ships a `render.yaml` blueprint. It runs **one web service**: the API also serves the built frontend, so the browser talks to a single origin and there is no CORS to configure and no separate `VITE_API_URL` to keep in sync.

```
build: npm install && npm run build      # installs both halves, builds the frontend
start: npm start                         # runs the API, which serves frontend/dist
```

The root `build` script installs the frontend with `--include=dev` on purpose. Render sets `NODE_ENV=production` during the build, which otherwise makes npm skip devDependencies — and Vite, Tailwind and PostCSS all live there, so the build would fail with "vite: not found".

**MongoDB is not included.** Render does not host it, so `MONGO_URI` must point at a MongoDB Atlas cluster — the free M0 tier is enough. In Atlas, allow access from anywhere (`0.0.0.0/0`) or from Render's outbound addresses, otherwise the connection is refused.

Set these in the Render dashboard (the blueprint marks them `sync: false` so they are never committed):

| Variable | Notes |
| --- | --- |
| `MONGO_URI` | Atlas connection string |
| `GEMINI_API_KEY` | Optional once keys are added in-app, but useful for the first boot |

`JWT_SECRET` and `JWT_REFRESH_SECRET` are generated by Render automatically. **Do not rotate `JWT_SECRET` after adding API keys** — stored keys are encrypted with a value derived from it, and changing it makes them undecryptable.

Two things to know about the free plan:

- **The disk is ephemeral.** Uploaded PDFs are deleted when the service restarts. Analysis happens immediately on upload so this rarely matters, but *Re-analyse* on an old scanned document will fail because the file is gone. Move `middleware/upload.js` to S3 or GridFS if that matters.
- **The service sleeps when idle** and takes a few seconds to wake. Background question warm-ups do not run while it is asleep.

After the first deploy, sign up — **the first account becomes the admin** and can reach the API key ring under Settings.

---

## How it works

### The upload pipeline

`POST /api/documents/upload` accepts the file, returns **202 Accepted** with a `documentId`, and runs the chain in the background. The client polls `GET /api/documents/:id/status` until `completed` or `failed`. This is not optional polish: under upstream load, Gemini retries and model fallbacks can push a scanned PDF past any browser timeout, and a dropped connection would otherwise lose the work.

1. **Multer** stores the upload (20MB cap). A `.txt` or `.md` file is accepted as well as a PDF — if you already have the notification as text, that is the best input there is: nothing is transcribed and no page images reach the model.
2. **pdf-parse** extracts the text layer.
3. If there is none — a scanned notification — the PDF is **transcribed to text once**, by Gemini, with tables preserved as markdown. That transcript is stored immediately.
4. Everything after this point reads text, never page images: both analysis passes, and any later re-analysis. Direct vision remains only as a fallback if transcription produces nothing usable.
5. **Gemini 3.6 Flash** returns structured JSON: exam name, organization, vacancies, eligibility, selection process, exam pattern, syllabus, subject-wise topics, important dates.
6. The result is normalised and saved as an **Exam** document.
7. A **Progress** row is created for every topic — the adaptive engine's memory.
8. A **60-day roadmap** is generated automatically (best-effort; a failure here does not lose the analysis).

Concurrent identical requests are collapsed on both sides: `useAsync` shares one in-flight promise (React StrictMode fires effects twice in development, which would otherwise double every generation), and lesson writes upsert rather than insert, so a genuine race cannot trip the unique index.

Every AI response is requested as `application/json`, then passed through `utils/jsonExtract.js`, which strips fences, repairs trailing commas and smart quotes, and retries once by showing the model its own broken output.

### The adaptive engine

`services/adaptive.service.js` decides what you see next. Average accuracy across attempted topics sets the weak-topic share of each batch:

| Average accuracy | Weak-topic share |
| --- | --- |
| under 40% | 80% |
| under 55% | 70% |
| under 70% | 50% |
| 70% and above | 30% (breadth) |

Within that share, topics are ranked by `(100 - accuracy) + mistakeCount penalty + importance boost`, so a topic you keep getting wrong outranks one you have merely not mastered. Difficulty is chosen per topic from your own accuracy on it.

### The API key ring

Gemini keys are managed from **Settings → API Keys** in the app rather than only from `.env`. Keys are stored encrypted (AES-256-GCM, derived from `JWT_SECRET`), shown masked, and never sent back to the browser.

Requests walk the ring in order. What happens on failure depends on whose fault it is:

| Failure | Whose fault | What happens |
| --- | --- | --- |
| 402 credits depleted | the key | Parked immediately; the next key takes over. Revive it after topping up |
| 429 rate limit | the key | Set aside for 5 minutes, then retried |
| 401/403 invalid key | the key | Marked invalid — retrying never helps |
| 503 model overloaded | the **model** | The model fallback chain runs first; only when every model fails does the next key get a turn |

That last row matters: a 503 means the model is busy, and the same model is busy for every key, so rotating keys first would waste time without helping.

`GEMINI_API_KEY` from `.env` still works and is appended to the ring as a last resort, so a fresh install runs before anything is configured. The ring is admin-only; the **first account to sign up becomes the admin**, since there is no other bootstrap path.

Syllabus extraction records where each topic came from. The syllabus pass must quote the document's own ``Syllabus`` or ``Scheme of Examination`` section verbatim into `syllabusQuote` **before** structuring it, and every subject and topic carries `fromNotification`. Topics the model supplied because the notification named a subject without listing its contents are marked `false` and shown dashed in the UI, with a count of how many were read from the notification versus added. An invented syllabus sends a learner to the wrong exam, so this has to be visible rather than buried in a note.

### Exam authenticity

Questions are worthless if they do not resemble the real paper, so the generation prompt treats this as a correctness requirement: model each question on the exam's actual previous-year papers (or the closest equivalent SSC/RRB/IBPS/state-PSC paper), never invent a name, date, figure or scheme, and avoid volatile facts outside Current Affairs.

Fact-heavy subjects (General Knowledge, Current Affairs) are generated **with Google Search grounding on by default** — the model searches before writing anything dated, and the pages it consulted are stored on the question as `groundingSources`. Settled subjects like arithmetic skip search, since it would only add latency. Grounding draws on a separate, smaller quota than ordinary generation, so losing it degrades to model memory within a few seconds rather than failing the request, and the question is then honestly marked ungrounded.

There is deliberately no LangChain or similar agent framework here. LangChain does not search the internet itself — it orchestrates a model plus a separate search tool. Gemini already exposes Google Search natively, so the framework would add a dependency and a round trip without adding a capability.

Each question carries an audit trail — `sourceBasis` (the real pattern it was modelled on, shown in the answer review) and `factualConfidence` (the model's own 0-100 honesty rating). Anything below `MIN_FACTUAL_CONFIDENCE` (default 70) is discarded rather than served: a shorter accurate batch beats a full batch with one plausible fabrication. Setting `GEMINI_GROUNDING=true` additionally backs fact-heavy subjects with Google Search instead of model memory.

### Rendering AI text

Model output is markdown by contract, so every surface that shows it — mentor chat, lesson explanations, test feedback — renders through one shared component (`components/ui/Markdown.jsx`) rather than printing the string. Displaying it raw leaks `**` and `##` onto the screen. The mentor prompt asks for real structure (a lead line, bullets for sets, bold topic names) so there is something worth rendering.

### Languages

Questions, options, explanations, lessons and the mentor are generated in **English, Hinglish or Odia (ଓଡ଼ିଆ)**, chosen per user from the sidebar and overridable per request. Exam terminology, formulas and proper nouns stay in English in every language, because that is how they appear in the real paper.

Language is part of a question's identity: the unique index is `{user, exam, fingerprint, language}`, and the fingerprint keeps letters from every script — an ASCII-only hash would flatten every Odia question to the same empty string and silently discard them all.

**Questions never repeat.** Each question stores a normalised `fingerprint`, unique per user+exam. The generator first reuses unseen questions from your bank, then asks Gemini only for the shortfall — and passes your last 120 question texts into the prompt as a do-not-repeat list.

### Mastery, not raw accuracy

`Progress.recompute()` blends accuracy with a confidence factor that saturates at 10 attempts, so 2/2 does not outrank 18/20:

```
mastery = accuracy × min(1, attempted / 10)
```

Readiness is then deterministic — 50% weighted mastery, 30% syllabus coverage, 20% recent test accuracy — and that number is fed to the AI as grounding so its narrative prediction cannot drift far from the data.

---

The backend is **CommonJS** (`require` / `module.exports`); the frontend is ESM, as Vite expects. Files that export both a default and named values attach the named ones onto the default, so `require(m)` and `require(m).name` both work.

---

## Folder structure

```
Exam-Prepare/
├── backend/
│   ├── src/
│   │   ├── config/          db connection, constants, languages
│   │   ├── models/          User, Document, Exam, Question, TestSession,
│   │   │                    Progress, Lesson, Roadmap, ChatMessage
│   │   ├── services/        gemini, prompts, pdf, ai, adaptive, analytics, roadmap
│   │   ├── controllers/     auth, document, exam, learning, session, analytics,
│   │   │                    roadmap, mentor
│   │   ├── routes/          one router per domain + index
│   │   ├── middleware/      auth, upload, validate, rateLimit, error
│   │   ├── validators/      zod schemas
│   │   ├── utils/           ApiError, asyncHandler, jsonExtract, text, logger
│   │   ├── scripts/seed.js
│   │   ├── app.js
│   │   └── server.js
│   └── uploads/
└── frontend/
    └── src/
        ├── api/             axios client (auto token refresh) + endpoints
        ├── context/         AuthContext
        ├── hooks/           useAsync
        ├── components/      layout (AppLayout, ProtectedRoute) + ui kit
        ├── pages/           Login, Signup, Dashboard, Upload, Learn, Lesson,
        │                    Practice, TestRunner, Result, Mock, Analytics,
        │                    Roadmap, Mentor, NotFound
        ├── App.jsx
        └── main.jsx
```

---

## API reference

All routes are prefixed with `/api`. Protected routes need `Authorization: Bearer <accessToken>`.

### Auth
| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/auth/signup` | Create an account, returns access + refresh tokens |
| POST | `/auth/login` | Sign in |
| POST | `/auth/refresh` | Exchange a refresh token for a new pair |
| GET | `/auth/me` | Current user with populated active exam |
| PATCH | `/auth/me` | Update name, avatar, active exam, preferences |
| POST | `/auth/change-password` | Change password |

### Documents & exams
| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/documents/upload` | Upload a PDF (field name `pdf`). Returns 202 + `documentId` |
| GET | `/documents/:id/status` | Poll target: `parsing` → `analyzing` → `completed`/`failed`, with the exam attached when done |
| POST | `/documents/:id/reanalyze` | Re-run Gemini on a stored upload (text layer, or the page images for a scan) |
| GET | `/documents` · `/documents/:id` · `/documents/:id/text` | List / read / raw text |
| DELETE | `/documents/:id` | Delete the upload (keeps the exam) |
| GET | `/exams` · `/exams/:id` · `/exams/:id/syllabus` | List / read / syllabus with live mastery |
| POST | `/exams/:id/activate` | Set the active exam |
| PATCH | `/exams/:id` | Correct an AI extraction by hand |
| DELETE | `/exams/:id` | Delete the exam and everything derived from it |

### Learning (Phase 1)
| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/learning/:examId/lesson/stream?subject=&topic=` | SSE: teaching prose streams as it is written, structured material follows |
| GET | `/learning/:examId/lesson?subject=&topic=&refresh=` | Same lesson, non-streaming (cached per topic and language) |
| POST | `/learning/:examId/lesson/complete` | Mark complete, updates the streak |
| GET | `/learning/:examId/lessons` | All generated lessons |
| GET | `/learning/:examId/next` | What to study next, with the reason |

### Tests (Phases 2, 3, 4, 6)
| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/tests/quiz` | Adaptive question set. Body: `examId, count, subjects[], topics[], difficulty, mode` |
| POST | `/tests/mock` | Full CBT from the AI blueprint of the real exam pattern |
| GET | `/tests` · `/tests/:id` | History / one session (answers withheld until submitted) |
| POST | `/tests/:id/submit` | Score, update Progress, return a full review + AI feedback |
| DELETE | `/tests/:id` | Abandon an in-progress attempt |

### Analytics (Phase 7)
`/analytics/dashboard` · `/topics` · `/subjects` · `/trend` · `/activity` · `/readiness?ai=true` · `/weak-topics` · `/exams`

### Roadmap (Phase 5) & Mentor
`POST /roadmap` · `GET /roadmap` · `GET /roadmap/today` · `PATCH /roadmap/:id/day/:day`
`POST /mentor/stream` (SSE, streamed reply) · `POST /mentor/chat` (non-streaming) · `GET /mentor/conversations` · `GET|DELETE /mentor/conversations/:id`

Every response uses the same envelope:

```json
{ "success": true, "message": "OK", "data": { }, "meta": { "total": 0, "page": 1, "limit": 20, "pages": 1 } }
```

---

## Production notes

- **Rate limits** are tiered: 600 req/15min overall, 20 sign-in attempts/15min, 20 AI calls/min per user, 30 uploads/hour.
- **AI cost control**: lessons are cached per topic and language, questions are reused from the bank before generating, PDF text is clamped to ~120k characters, and re-uploading a PDF already analysed (matched by SHA-256) returns the earlier exam in milliseconds instead of re-running the pipeline.
- **Latency**: several layers, because free-tier throttling dominates wall time.
  - *Fast failover* — capacity spikes are per-model, so a 503/429 retries once (~1.2s) and then switches models, instead of sleeping through a 46-second backoff ladder. The long ladder only applies on the last model, when there is nothing else to try.
  - *Prefetch* — the question bank is topped up in the background at four moments when the learner is already occupied: right after a PDF is analysed (so the very first quiz is instant, not just later ones), after a lesson is generated ("Quiz me" is the usual next click), after a quiz starts, and after one is submitted. Since banked questions are used before any generation, the common case becomes a database read with no model call at all.
  - *Chunked generation* — a batch is split into concurrent calls of 5 questions rather than one long response, because generation time scales with output length.
  - *Streaming mentor* — `POST /mentor/stream` returns Server-Sent Events, so the first words appear in about a second. Its follow-up chips and action buttons are derived from the learner's own data rather than requested from the model, removing a second round trip.
  - *Streaming lessons* — measured throughput on the free tier is roughly 19 output tokens/second, so one long response is the slowest possible shape. A lesson is therefore split: the teaching prose streams straight to the page while the notes, tricks and examples are generated concurrently. The learner reads within a second or two instead of waiting for the whole lesson.
  - *Token diet* — question explanations are capped at 40 words. At ~19 tokens/second, every unnecessary word is measurable waiting.
  - *Transcribe once* — a scan costs one vision call, not one per analysis. Re-analysing, or analysing again after a restart, runs on the stored text, which also means it works on hosts with an ephemeral disk where the original file is gone.
  - *Cached mock blueprint* — stored on the Exam and invalidated when the syllabus or pattern changes, removing a model call from every mock.
- **Scan latency**: reading page images is cheap; generating the long JSON is what costs time. The vision extraction is therefore split into two halves — identity/logistics and syllabus/pattern — issued concurrently against a single uploaded file and merged, so wall-clock time is roughly halved.
- **Transport**: all Gemini calls go through the official `@google/genai` SDK, which owns the HTTP, streaming frame parsing and the resumable upload protocol. The backend therefore makes no raw HTTP calls of its own — there is no `fetch` or `axios` in `backend/src`. `services/gemini.service.js` wraps the SDK with the parts it does not provide: the model fallback chain, status-aware backoff and actionable error messages. The frontend still uses axios for its own API calls.
- **Thinking level**: 3.x Flash models deliberate before answering. Since output throughput is this app's bottleneck, `GEMINI_THINKING_LEVEL` (default `low`) keeps that short; raise it to `medium` or `high` if answer quality matters more than latency on a given deployment.
- **Upstream resilience**: Gemini calls allow 120s each, with four retries (4s/12s/30s backoff on 429 and 503), then fall through a model chain — `GEMINI_MODEL` first, then each of `GEMINI_FALLBACK_MODELS`. Capacity spikes hit individual models rather than the whole service, so the fallback is what actually gets a request through during a busy period.
- **Previous papers, honestly labelled**: the Previous Papers tab builds a past-year paper for revision, with answers and explanations. A language model cannot reproduce a real question paper verbatim, and one that claims to is the most damaging thing this app could ship — a learner would revise fabricated questions believing they are the official exam. So every question is labelled `recalled` (the model recognises it from the actual paper) or `reconstructed` (same syllabus point and pattern, rewritten), the paper states how much of it is which, and anything below `MIN_PAPER_CONFIDENCE` is dropped rather than shown. A question with no stated provenance is treated as reconstructed: the stronger claim has to be made deliberately, never won by default.
- **The free floor**: `GEMINI_FREE_MODEL` (default `gemma-4-31b-it`) is appended beneath the whole chain, and deliberately kept out of `GEMINI_FALLBACK_MODELS` — that list is the operator's preference order, and any deployment already setting it would otherwise drop the floor without noticing, exactly when a spent quota makes it the only model left. It is free rather than metered. When a key's paid credits are depleted (402) or its quota is rate-limited (429), the app parks that key, tries any other key first, and — if none is left — drops to Gemma on the same key, because a free model bills against a different allowance. So running out of quota degrades the app instead of stopping it. Gemma is an open model and accepts fewer fields than Gemini: no system instruction, no pinned JSON response type, no Google Search grounding and no thinking control. `capabilitiesOf` in `gemini.service.js` reshapes each request for whichever model is being tried — the system instruction is folded into the top of the prompt, and JSON comes back as ordinary text for `utils/jsonExtract.js` to recover. Answers are noticeably weaker there, so it is a floor, not a substitute. A key that is simply **invalid** (401/403) never reaches Gemma: nothing on that key will answer.
- **Malformed JSON recovery**: a broken response is *regenerated* from the original context, not patched. Asking a model to repair its own truncated JSON makes it close the structure early and silently drop data — text repair only runs after a clean regeneration has also failed. Truncated output (`finishReason: MAX_TOKENS`) retries with double the token budget.
- **Large scans** go through the Gemini Files API: uploaded once, referenced by URI, and deleted afterwards, so retries do not re-send megabytes and the 20MB inline request ceiling never applies.
- **Uploads** are stored on local disk. For a multi-instance deployment, move `middleware/upload.js` to S3 or GridFS — nothing else assumes local files.
- **Roadmap resilience**: if the model returns fewer than the requested days, the missing days are filled deterministically by cycling the syllabus rather than failing the request.
- **Bundle**: routes behind the sign-in wall are lazy-loaded, so Recharts (~104KB gzip) and the markdown renderer (~48KB gzip) load only on the screens that need them. The initial payload is ~88KB gzip rather than ~222KB.
- Build the frontend with `npm run build`; serve `frontend/dist` from any static host and point `VITE_API_URL` at the deployed API.

## Known limits

- Scanned PDFs are read by Gemini vision rather than a local OCR engine, so they cost more tokens and take longer. Above 14MB a scan is rejected, because the bytes must fit inside the Gemini request body — split or compress it.
- AI feedback on a submitted test is best-effort: if Gemini fails, the test is still scored and saved.
- The 60-day roadmap is a single large generation (up to ~32k output tokens); very long syllabi may hit the fill-in path described above.
