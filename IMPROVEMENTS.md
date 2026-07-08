# IMPROVEMENTS.md — Staff-level review of Clara

A critical review of this codebase as if it were a real PR at an AI
automation company, plus the roadmap from "strong portfolio project" to
"production system," and the learning plan that follows from it.

---

## 1. Architecture Review

### What is genuinely good

- **The separation of concerns is the strongest design decision.** n8n
  moves data; the app decides. Every policy (allowlist, dedup, approval
  rules, state transitions) lives in testable TypeScript, not in workflow
  nodes. Many real n8n deployments get this wrong and bury business logic
  in Code nodes where it can't be tested or reviewed. You didn't.
- **The state machine + append-only audit log** (`lib/invoices.ts`) is
  production-grade thinking: transitions validated against an allowed
  graph, audit row written in the same transaction, humans and AI flowing
  through the same gate. This is the part a senior engineer would praise
  unprompted.
- **Intake convergence** (`lib/dispatch.ts`): upload and email share one
  path, so guarantees can't drift. The refactor happened at the right
  moment (second entry point), not speculatively.
- **Reliability was designed from observed failures** (503s, dead
  workflows, stuck jobs), not imagined ones. Retry taxonomy (automatic
  for transient, human for permanent) is correct.
- **Secrets discipline**: credentials by reference in workflow JSON,
  timing-safe internal auth, enumeration-safe login, httpOnly sessions.

### What would concern a senior engineer

**1. A real race condition in the transition guard.**
`transitionInvoice` reads the invoice status and updates it inside a
`$transaction` — but two *concurrent* transactions (e.g. a late n8n
callback arriving while the sweeper fires, or a double-clicked Approve)
can both read `EXTRACTING`/`NEEDS_REVIEW` before either commits, and both
succeed. Postgres default `READ COMMITTED` does not prevent this.
*Fix:* make the update conditional and atomic —
`updateMany({ where: { id, status: expectedFrom }, data: ... })` and
treat `count === 0` as an invalid transition, or `SELECT ... FOR UPDATE`.
Cheap fix, great interview story ("I found a TOCTOU race in my own state
machine").

**2. The n8n webhooks are unauthenticated.**
The app authenticates itself *to* n8n's callbacks, but anyone who can
reach `POST /webhook/invoice-extraction` can trigger extractions (and on
a public deployment, that's the internet). Locally it's fine; in
production it's an open door to burning your Gemini quota.
*Fix:* Header Auth on the n8n Webhook nodes (n8n supports credentials on
webhooks) with a second shared secret, sent by `dispatch.ts`/`notify.ts`.

**3. The extraction endpoint is a fat controller.**
`api/internal/invoices/[id]/extraction/route.ts` does validation, vendor
matching, flag computation, near-dup search, persistence, decision, and
notification. It works, but it's the file every future change touches —
the classic hotspot. *Fix:* extract an `extraction-service.ts` (see
Refactoring exercises). Route handlers should parse, authenticate,
delegate, and respond.

**4. Test coverage is one pure function.**
7 good unit tests for `rules.ts` — and zero tests for the state machine,
the extraction endpoint (the most complex logic in the repo), storage
path traversal, or internal auth. The parts most likely to break are the
least tested. This is the biggest credibility gap between "portfolio"
and "production."

**5. Silent notification loss.**
Fire-and-forget is the right call (a broken notifier must not break
processing), but a failed notification currently vanishes with a
`console.warn`. Production wants an outbox: write the notification to a
table, let a workflow drain it, mark sent. At-least-once instead of
at-most-once.

### Technical debt, honestly listed

| Debt | Why it exists | When it bites |
| --- | --- | --- |
| Local-disk file storage | Free tier, narrow interface planned for swap | The day you deploy serverless |
| `WorkflowRun.startedAt` = callback time, not true start | Kept payloads simple | Duration metrics will be wrong |
| `flags: String[]` free-text | Fast iteration | Typo'd flag names silently never match |
| Exact-name vendor matching | Phase-3 scope cut | First vendor who writes "Acme Inc" vs "Acme Inc." |
| No pagination/search on invoice list (`take: 100`) | Demo-scale data | ~2 weeks after real usage |
| `role` column exists but nothing checks it | Auth phase scope cut | The first non-admin user |
| Money via `toFixed(2)` on a JSON float | Gemini returns numbers | A `1288.004999` edge case, eventually |

### Where you over-engineered

- **Embeddings for near-duplicate detection** is the honest candidate.
  `pg_trgm` trigram similarity on the canonical string would catch most
  of the same rescans with no API call, no vector column, no extra
  workflow nodes. The embedding approach is more general (survives word
  reordering, synonyms) and demonstrates pgvector — defensible for a
  portfolio, but in a code review I'd ask "did we measure that trigram
  wasn't enough?" Keep it, but know the answer: *no, and that's a fair
  criticism; the eval set to settle it is in the roadmap.*

### Where you under-engineered

- **Testing** (above — the big one).
- **Concurrency** (the race, plus: two n8n callbacks for the same
  invoice both passing the 409 guard).
- **Observability is DB rows, not metrics.** Fine at this scale, but
  there's no latency tracking, no token/cost accounting per extraction,
  no alerting threshold (you're alerted per-failure, never "success rate
  dropped below 90%").

---

## 2. Production Readiness Roadmap

### Version 1.1 — small (1–3 hours each)

1. ✅ **Fix the transition race** with conditional `updateMany`. *Matters
   because:* financial systems cannot double-apply approvals. This is
   correctness, do it first. *(Done — with a concurrency test in
   `invoices.race.test.ts` proving exactly one of two racing transitions
   wins.)*
2. **Authenticate the n8n webhooks** (header auth credential + secret in
   `dispatch.ts`/`notify.ts`). *Matters:* quota/DoS protection the day
   anything is public.
3. **Login rate limiting** (simple in-memory or DB counter, lock after 5
   failures/15 min). *Matters:* bcrypt slows guessing; it doesn't stop
   unlimited tries.
4. **Enum-ify flags** (TS union + Zod enum, keep `String[]` in DB).
   *Matters:* `"DUPLICATE_SUSPECTED"` vs `"DUPLICATE_SUSPECT"` should be
   a compile error, not a silent miss.
5. **Pagination + status filter on `GET /api/invoices`** (cursor on
   `createdAt`). *Matters:* every list endpoint in production paginates.
6. **`.nvmrc` + `engines` + a CI workflow** running typecheck, vitest,
   `prisma validate`, and JSON-validating `n8n/workflows/*`. *Matters:*
   a repo without CI reads as pre-production; this one takes an hour.

### Version 1.2 — medium (½–1 day each)

1. **Integration tests for the extraction endpoint** (Vitest + a test
   Postgres via docker; hit the route with success/failure/duplicate
   payloads, assert status + audit rows). *Matters:* this endpoint IS
   the product; today only manual curl runs protect it.
2. **Notification outbox** (table + drain workflow + `sentAt`).
   *Matters:* "the approver never got the email" is a real incident
   class; at-least-once delivery with an audit of sends fixes it.
3. **S3/R2 storage adapter** behind the existing `storage.ts` interface,
   selected by env. *Matters:* unblocks serverless deployment; the
   interface was designed for exactly this swap.
4. **Fuzzy vendor matching**: `pg_trgm` similarity with a review flag on
   sub-threshold matches (`VENDOR_MATCH_FUZZY`). *Matters:* exact-match
   is the #1 source of false UNKNOWN_VENDOR review noise in real AP.
5. **Extraction cost + latency tracking**: capture Gemini's
   `usageMetadata` token counts in the report payload; store on
   `WorkflowRun`; show $/invoice on the health panel. *Matters:* the
   first question a company asks about an LLM pipeline is "what does it
   cost per document?"
6. **RBAC enforcement**: REVIEWER can approve/reject; ADMIN manages
   vendors/users; approval limits per role (reviewer ≤ $5k). *Matters:*
   separation of duties is an audit requirement in finance.

### Version 2.0 — major (several days each)

1. **An evaluation harness for extraction quality.** A labeled set of
   30–50 invoices (varied layouts, scans, currencies), a script that
   runs them through the pipeline and scores field accuracy, confidence
   calibration, and near-dup threshold precision/recall. *Matters:* this
   is the difference between "we use AI" and "we can prove the AI's
   error rate and detect regressions when we change the prompt or
   model." The single highest-signal addition for AI-engineering roles.
2. **Multi-tenancy** (orgId on every table, row-level scoping, per-org
   thresholds and allowlists). *Matters:* it's the SaaS prerequisite,
   and it forces you through the hardest data-modeling exercise there
   is: retrofitting isolation.
3. **Queue-based ingestion** (replace webhook fire-and-forget with a
   real queue — pg-boss keeps it in Postgres). *Matters:* backpressure,
   rate-limit smoothing (Gemini free tier!), priority, and dead-letter
   semantics that HTTP calls can't give you.
4. **Payment scheduling automation** (`APPROVED → SCHEDULED → PAID` via
   a scheduled workflow + mock payment API + reconciliation report).
   *Matters:* completes the business story end-to-end.

---

## 3. Feature Ideas

Top five in detail, the rest tabled.

✅ **Batch upload + ZIP support** *(shipped)* — *Why:* month-end, AP
receives invoices in bulk; one-at-a-time upload is a toy. *As built:*
`POST /api/batches` expands ZIPs server-side (zip-bomb size checks
against declared header sizes before inflating, basename-only entry
names against zip-slip, entry-count caps), creates all invoices as
RECEIVED via the shared intake, and a scheduled batch-dispatcher
workflow drip-feeds them to extraction (`BATCH_DISPATCH_PER_TICK`/min)
so bulk uploads stay inside the LLM rate limit — a deliberate poor-man's
queue whose limitations motivate the v2.0 real-queue upgrade.

✅ **Manual correction workflow** *(shipped)* — *Why:* reviewers don't
just approve/reject; they fix a wrong date and *then* approve. Without
it, every extraction error becomes a rejection. *As built:* corrections
service (`lib/corrections.ts`) allows field edits only in NEEDS_REVIEW,
audits every change as `FIELD_CORRECTED` with old→new metadata, and
re-runs the shared enrichment (`lib/enrichment.ts`, extracted from the
extraction route) so flags recompute: fixing a vendor name clears
UNKNOWN_VENDOR, a colliding number raises DUPLICATE_SUSPECTED.
Embedding-derived flags are preserved; `HUMAN_CORRECTED` marks touched
invoices (future eval/fine-tune material). Editable fields on the detail
page; 4 DB-backed integration tests.

**PO matching** — *Why:* real AP approves invoices against purchase
orders (2-way/3-way match), not vibes. *Architecture:* new PO master
data + a match step in the decision layer (amount tolerance, open
quantity). *DB:* `PurchaseOrder` + line tables, `poNumber` on Invoice.
*n8n:* extraction prompt gains a `poNumber` field. *Frontend:* PO panel
on detail page showing match result. *Difficulty:* hard (the business
rules, not the code).

**Duplicate review workflow** — *Why:* today `DUPLICATE_SUSPECTED` is a
flag; a reviewer should see both invoices side-by-side and mark
"duplicate — reject" or "false positive — link vendor and proceed."
*Architecture:* a resolution action that either rejects or clears the
flag and sets vendorId (currently impossible without SQL). *DB:*
`duplicateOfId` column instead of burying it in audit metadata. *n8n:*
none. *Frontend:* side-by-side compare view. *Difficulty:* medium.

**Cost monitoring** — *Why:* LLM spend is the first thing finance asks
about the AI that processes finance. *Architecture:* token counts from
Gemini's `usageMetadata` flow through the report payload into
`WorkflowRun`; health panel aggregates $/day and $/invoice.
*DB:* 3 columns on WorkflowRun. *n8n:* pass-through fields. *Frontend:*
one chart. *Difficulty:* easy — highest value-to-effort in this list.

| Feature | Why companies need it | Difficulty |
| --- | --- | --- |
| Vendor portal (self-serve invoice status) | Kills "where's my payment?" support email | Hard (external auth) |
| OCR fallback (Tesseract when Gemini fails/unavailable) | Availability during provider outages | Medium |
| Multi-page/multi-invoice PDFs | Real scans are messy | Medium (prompt + splitting) |
| Notification center (in-app, read/unread) | Email is lossy; approvers live in the dashboard | Medium |
| Analytics dashboard (spend by vendor/month, cycle time) | AP managers buy dashboards, not pipelines | Medium |
| Approval limits / multi-step approval chains | Separation of duties, SOX-style controls | Medium |
| AI confidence tuning UI (threshold sliders + backtest) | Ops wants control without deploys | Medium (needs eval set first) |
| Workflow versioning/rollback discipline | Change management for automations | Easy (process > code) |
| Queue management UI (depth, retry, DLQ) | Ops visibility at volume | Hard (needs 2.0 queue) |
| Multi-tenant support | SaaS prerequisite | Hard |

---

## 4. Deployment Guide

The full guide lives in [docs/deployment.md](docs/deployment.md); this is
the decision summary plus the options it doesn't cover.

| Piece | Free option | Catch | Paid reality |
| --- | --- | --- | --- |
| Dashboard (Next.js) | Vercel Hobby | Needs R2/S3 storage swap first (no disk) | $0 |
| Postgres + pgvector | Neon or Supabase free | Cold starts (Neon scale-to-zero); connection pooling required | $0 |
| Files | Cloudflare R2 (10 GB) | Requires the storage adapter | $0 |
| n8n | **No true free 24/7 option** | Render free sleeps → Gmail poller dies; Railway credit expires | ~$5/mo VPS or Railway hobby; n8n Cloud from ~$20/mo |
| n8n on Coolify | Coolify itself is free | You still pay for the VPS it runs on (~$4–6/mo Hetzner) | Nice middle path: dashboards + n8n + Postgres all on one VPS |
| n8n on Oracle Cloud always-free ARM VM | Genuinely $0 | Real sysadmin work; capacity lottery; you own security patching | $0 + your time |

**Recommended for a portfolio:** keep it local + the demo video, OR spend
~$5/mo on one small VPS running Coolify (n8n + Postgres + the Next app
all on it — skips the storage refactor since you have a disk!) with the
repo documenting the serverless topology you *would* use at scale. The
$5 VPS is the best learning-per-dollar: you'll touch DNS, HTTPS
(Caddy/Traefik), env management, and backups — all interview-relevant.

Expected costs: $0 (local/Oracle) · ~$5/mo (VPS/Coolify or Railway) ·
~$25+/mo (managed everything: n8n Cloud + Vercel + Neon paid).

---

## 5. n8n Learning Exercises

No solutions — hints only. Verify each against the running system.

### Beginner

**5.1 Slack/Discord alert on auto-approval**
*Scenario:* the AP manager wants a channel ping when Clara approves
without a human. *Expected:* message with vendor, amount, link.
*Hints:* Discord webhooks need no OAuth (one URL credential); the
decision outcome isn't in n8n today — where's the cleanest place to
learn of it? (Two valid answers: a new app→n8n webhook, or extending an
existing report path.) *Concepts:* webhook credentials, app→n8n
contracts. *Common mistake:* putting the "was it auto-approved?" logic
in n8n instead of having the app tell it.

**5.2 Add a Wait-and-remind**
*Scenario:* if an invoice sits in NEEDS_REVIEW for 24h, email a
reminder. *Expected:* one reminder, not one per poll. *Hints:* you could
use a Wait node after notify… or a Schedule + app endpoint that returns
"stale, un-reminded reviews" — which one survives an n8n restart? What
marks an invoice as already-reminded? *Concepts:* Wait nodes vs
schedules, idempotent reminders, durable state. *Common mistake:* Wait
nodes for day-long timers (they tie up the execution; schedules are the
production pattern).

**5.3 Batch the morning digest**
*Scenario:* instead of one email per review item, send an 8 AM digest
listing everything pending. *Expected:* one email, formatted list, sent
only if non-empty. *Hints:* Schedule trigger + HTTP to a new app
endpoint + look at the **Aggregate** node (many items → one). An IF node
guards the empty case. *Concepts:* schedules, aggregation,
item-vs-single-payload thinking. *Common mistake:* forgetting the
empty-queue guard and emailing "0 invoices" daily.

### Intermediate

**5.4 Split the extraction workflow into two**
*Scenario:* extraction and embedding are one workflow; split embedding
into a sub-workflow called via the **Execute Sub-workflow** node.
*Expected:* identical end behavior; embedding reusable elsewhere.
*Hints:* what's the input contract of the sub-workflow? What happens to
the error branch across the boundary? *Concepts:* workflow composition,
contracts, error propagation. *Common mistake:* implicit coupling — the
sub-workflow reaching for `$('Webhook')` that no longer exists.

**5.5 Dead-letter handling for ingest**
*Scenario:* if "Deliver to app" exhausts its 3 retries, the email is
currently lost-ish (unread, but the poller moved on). Build a DLQ: on
final failure, label the Gmail message `clara-dlq` and alert.
*Expected:* failed deliveries findable in one place; a manual "reprocess
DLQ" path. *Hints:* error output on the HTTP node; Gmail node has label
operations; reprocessing = a manual-trigger workflow searching that
label. *Concepts:* DLQ semantics, at-least-once + dedup (the app's
sourceRef dedup suddenly matters — why?). *Common mistake:* re-delivering
without dedup and double-ingesting.

**5.6 Per-node metrics to the app**
*Scenario:* record Gemini call duration per execution. *Expected:*
`WorkflowRun` (or a new table) stores extraction latency; health panel
shows p50/p95. *Hints:* `Date.now()` in Code nodes before/after; or
compare `$execution` timestamps. *Concepts:* instrumenting workflows,
what n8n gives you for free vs what you must add. *Common mistake:*
measuring queue wait as if it were API latency.

### Advanced

**5.7 Rate-limit-aware batch processing**
*Scenario:* someone drops 50 invoices at once; Gemini free tier allows
~10–15 requests/min. Process all without a single 429/503-storm.
*Expected:* all 50 extracted over several minutes, no failures.
*Hints:* **Loop Over Items (Split in Batches)** + **Wait** node inside
the loop; think about where the batching should live — n8n, or a queue
in the app? Defend the choice. *Concepts:* throttling, batch loops,
backpressure. *Common mistake:* parallel fan-out (n8n runs items
concurrently through HTTP nodes — the loop is what serializes).

**5.8 Blue/green workflow deployment**
*Scenario:* you want to test a new extraction prompt on 10% of invoices
in production. *Expected:* two extraction paths, a router, results
distinguishable in WorkflowRun for comparison. *Hints:* the router can
be a Code node with `Math.random()` — but then how do you make a given
invoice *sticky* to its variant? What column records which prompt
version ran? *Concepts:* A/B testing automations, prompt versioning,
experiment analysis. *Common mistake:* comparing variants without
recording which variant ran (unanalyzable experiment).

---

## 6. Refactoring Exercises

**6.1 Extract `ExtractionService` from the fat route** — Move
vendor-match/flags/dedup/decision/persist/notify into
`web/src/lib/extraction-service.ts`; the route becomes parse → auth →
`service.process()` → respond. *Files:* extraction route, new service,
new unit tests. *Difficulty:* medium. *Teaches:* layered architecture,
the service pattern — the #1 backend interview theme ("walk me through
your layers").

**6.2 Fix the transition race** — `updateMany` with status in the WHERE;
return count-checked result; add a test that fires two concurrent
transitions and asserts exactly one wins. *Files:* `lib/invoices.ts` +
test. *Difficulty:* easy code, medium test. *Teaches:* TOCTOU,
optimistic concurrency, DB isolation levels.

**6.3 Storage as an injected port** — Define `FileStore` interface;
`LocalFileStore` and `R2FileStore` implementations; select by env at a
single composition point. *Files:* `lib/storage.ts` → `lib/storage/*`.
*Difficulty:* medium. *Teaches:* ports & adapters (hexagonal), dependency
inversion without a DI framework — and be ready to argue *against*
DI containers in a codebase this size.

**6.4 Typed flags** — `const FLAGS = [...] as const` union type + Zod
enum, used everywhere flags are written or compared. *Files:* extraction
service, rules, UI badge rendering. *Difficulty:* easy. *Teaches:*
making illegal states unrepresentable — a favorite TS interview phrase
you'll now have a concrete example for.

**6.5 Structured logging** — Replace `console.warn` with a tiny logger
(pino) emitting JSON with `invoiceId`/`executionId` correlation fields.
*Files:* notify, dispatch, extraction service. *Difficulty:* easy.
*Teaches:* correlation IDs, log-based debugging — "how would you trace
one invoice through the whole system?" now has a one-word answer.

**6.6 Integration tests with a real database** — Vitest + testcontainers
(or a compose test DB): seed, hit the extraction endpoint with the three
payload shapes, assert invoice + audit + WorkflowRun rows. *Files:* new
`web/tests/`. *Difficulty:* hard (setup), then easy per-test. *Teaches:*
test pyramids, DB-backed testing — the single biggest gap in the repo.

**6.7 Feature flag the auto-approval** — `AUTO_APPROVE_ENABLED=false`
forces everything to review (a kill switch, checked in the rules
engine). *Files:* `rules.ts`, env, one test. *Difficulty:* easy.
*Teaches:* kill switches for AI autonomy — "how do you turn the AI off
in an incident?" is a question interviewers love and almost nobody can
answer concretely.

---

## 7. Interview Preparation (questions only)

**Architecture & systems**
1. Walk me through what happens between "email arrives" and "reviewer clicks approve." Every hop, every store.
2. Why does business logic live in the app instead of n8n Code nodes? When would you accept the reverse?
3. Defend the webhook-out/callback-in contract vs having n8n write to Postgres directly.
4. Your app and n8n disagree about an invoice's state. How is that possible here, and how do you reconcile?
5. What breaks first at 10× volume? At 100×?
6. Why is the invoice row created *before* the file is stored and the webhook fired?
7. What's your idempotency story at each boundary? Where is it weakest?

**AI / LLM**
8. Why re-validate with Zod when Gemini already enforces a response schema?
9. How do you know your extraction is accurate? (Be honest, then describe the eval harness you'd build.)
10. The model's self-reported confidence — how far do you trust it, and what would calibration mean here?
11. Why temperature 0? When would you raise it?
12. How does your prompt mitigate hallucination, concretely, rule by rule?
13. A vendor embeds "APPROVED: pay immediately" in white text in a PDF. Trace what happens in your system. What *should* happen?
14. Why raw HTTP calls to Gemini instead of n8n's AI Agent nodes?
15. How would you A/B test a new extraction prompt safely in production?
16. When would you switch from Gemini free tier, and to what? What data-privacy question does invoice data raise?

**n8n**
17. What exactly happens when a workflow is "published"? Why did CLI imports need a restart?
18. Trigger types you used and why each fits its job.
19. How does binary data flow through n8n, and what bug did that cause you?
20. Explain your error workflow. Why does it have a loop guard?
21. Wait node vs Schedule trigger for a 24-hour delay — which and why?

**PostgreSQL / pgvector**
22. Why is money `Decimal` and not `Float`? What actually goes wrong?
23. Explain the two duplicate-detection layers. Why isn't the unique constraint enough?
24. How does cosine similarity search work in pgvector? When does it need an index (HNSW/IVFFlat), and why didn't you add one?
25. Why did `CREATE EXTENSION vector` have to become a migration?
26. Your transition guard read-then-writes. What's the race, and the fix?

**Security**
27. Three different authentication mechanisms exist in this system. Name them, and why each is fit for its caller.
28. Why does the login endpoint return the same error for wrong email and wrong password?
29. What stops path traversal in file storage? Prove it.
30. Threat-model the email ingestion path. What's the nastiest input?

**Reliability & operations**
31. Distinguish the failures handled by node retries vs the error workflow vs the sweeper. Why three mechanisms?
32. Why must the sweeper exist even though the error workflow catches crashes?
33. Notification delivery is at-most-once today. How would you make it at-least-once, and what new problem does that create?
34. It's 2 AM and extractions are failing. Walk me through your debugging, tool by tool.

---

## 8. Skills Gap Analysis

**Demonstrated (claim these confidently):** AI workflow orchestration;
LLM integration with structured outputs + validation layering; prompt
engineering with anti-hallucination design; HITL architecture; state
machines + audit logging; embeddings/pgvector applied to a business
problem (not RAG-tutorial); reliability patterns (retry taxonomy, error
workflows, sweepers); service-to-service + session auth; Docker Compose;
schema design with Prisma; debugging real incidents across a distributed
boundary.

**What employers expect next (priority order):**
1. **Testing discipline** — integration tests especially. Biggest gap,
   fastest to close, most-probed in interviews.
2. **LLM evaluation** — eval sets, accuracy metrics, regression testing
   of prompts. This is the skill that separates "AI automation engineer"
   from "person who calls APIs" in 2026 hiring.
3. **Queues & async infrastructure** — pg-boss/BullMQ/SQS semantics:
   at-least-once, DLQs, backpressure. You've simulated these with HTTP;
   know the real thing.
4. **Cloud deployment** — actually operating a VPS or serverless deploy
   (DNS, HTTPS, secrets, backups). Doing the $5 Coolify deploy checks
   this box.
5. **Observability** — structured logs, metrics, correlation IDs.

**Safe to postpone:** Kubernetes; fine-tuning models; multi-region
anything; LangChain internals (know *when* you'd use it — you already can
argue both sides); Terraform.

---

## 9. Learning Plan (7 weeks)

**Week 1 — Correctness & tests.** Fix the transition race (6.2), typed
flags (6.4), integration-test setup + 3 extraction-endpoint tests (6.6).
*Read:* Vitest + testcontainers docs; Postgres isolation levels (the
official docs chapter is short and gold). *Interview goal:* tell the
TOCTOU story end-to-end. *Outcome:* the repo's biggest gap closed.

**Week 2 — Service extraction & logging.** ExtractionService (6.1),
pino structured logging (6.5), feature-flag kill switch (6.7).
*Read:* "ports and adapters" (any solid article) — then argue where it's
overkill. *Interview goal:* whiteboard your layers without notes.
*Outcome:* the codebase reads like a team wrote it.

**Week 3 — n8n depth.** Exercises 5.1–5.3, then 5.5 (DLQ — the
important one). Sync every workflow change to the repo. *Interview
goal:* explain DLQ + at-least-once + dedup as one coherent story.
*Outcome:* n8n fluency beyond what you built with me.

**Week 4 — Deploy for real.** $5 VPS + Coolify: n8n, Postgres, app, HTTPS,
backups; rotate all secrets per the deployment checklist. *Read:*
docs/deployment.md, Coolify docs. *Interview goal:* "here's the live
URL" + explain the topology and what you'd change at scale. *Outcome:*
a clickable portfolio and real ops experience.

**Week 5 — LLM evaluation.** Build the eval harness (2.0 #1): 30 labeled
invoices, accuracy script, confidence-calibration plot, near-dup
threshold sweep. *Read:* anything on LLM evals + calibration (reliability
diagrams are enough math). *Interview goal:* state your extraction
accuracy as a number with a method behind it. *Outcome:* the strongest
differentiator on your resume.

**Week 6 — Queues.** Replace webhook handoff with pg-boss: retries,
DLQ, rate limiting to Gemini's quota (kills the 429 class entirely).
*Read:* pg-boss README; "at-least-once vs at-most-once" (any queue
vendor's explainer). *Interview goal:* compare your before/after
architectures with trade-offs. *Outcome:* real async infrastructure
experience.

**Week 7 — Polish & rehearse.** Manual-correction feature (the best
remaining HITL story), cost tracking, README screenshots + demo GIF,
then run the [demo script](docs/demo-script.md) out loud until the
5-minute version is smooth. Answer all 34 questions above — out loud,
timed. *Outcome:* application-ready.

---

*Generated as a staff-level review of the completed v1.0. The system is
strong for its purpose; the gaps listed here are the honest distance
between "impressive portfolio" and "production" — and every one of them
is a learning opportunity with your name on it.*
