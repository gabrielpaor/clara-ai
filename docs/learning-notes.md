# Learning Notes — Phases 0–2

A study companion for the Clara project. Part 1 is what you learned and
built in each phase. Part 2 is a glossary of every term worth knowing,
in plain English, with React/frontend analogies where they help.

---

## Part 1 — What you learned, phase by phase

### Phase 0 — Infrastructure (Docker, n8n, PostgreSQL)

**What was built:** [docker-compose.yml](../docker-compose.yml) running two
containers — PostgreSQL 16 (with the pgvector extension) and n8n — plus an
init script that creates two databases inside the one Postgres server.

**What you learned:**

- **Docker Compose** describes your whole local infrastructure in one YAML
  file, so `docker compose up -d` recreates it identically on any machine.
- **n8n stores its own data in Postgres** (`DB_TYPE: postgresdb`) instead of
  its default SQLite file. That's the production configuration — workflow
  state survives container rebuilds.
- **Separation at the storage layer:** the `n8n` database (engine internals)
  and `invoice_clerk` database (our business data) never mix, even though
  they share a server.
- **pgvector over Pinecone:** a vector extension inside the Postgres you
  already run beats adding a whole new service — until you reach a scale
  most companies never see.
- **`N8N_ENCRYPTION_KEY`** encrypts every credential n8n stores. Generated
  once, never changed, never committed.

### Phase 1 — Data model (Prisma, state machine, audit log)

**What was built:** [web/prisma/schema.prisma](../web/prisma/schema.prisma)
— `Invoice`, `Vendor`, `AuditLog`, `WorkflowRun`, `User` — migrated into
Postgres and seeded with three vendors.

**What you learned:**

- **Status as a state machine:** an invoice moves
  `RECEIVED → EXTRACTING → NEEDS_REVIEW → APPROVED → SCHEDULED → PAID`
  (with `REJECTED`/`FAILED` exits), and only through code that validates
  the transition and writes an audit row — see
  [web/src/lib/invoices.ts](../web/src/lib/invoices.ts).
- **Nullable columns model "knowledge arrives gradually":** the row exists
  the moment a file lands; extracted fields fill in later or never.
- **Money is `Decimal`, never `Float`** — binary floats cannot represent
  0.1 exactly, and pennies vanish in sums.
- **Keep the raw LLM output** (`extraction Json`) even after promoting
  fields to typed columns: typed columns for querying, raw JSON for "why
  did the AI say that?"
- **Database-level duplicate guard:** `@@unique([vendorId, invoiceNumber])`
  means no code path can store the same vendor+number twice.
- **The Prisma singleton pattern** in [web/src/lib/db.ts](../web/src/lib/db.ts):
  without caching the client on `globalThis`, Next.js dev-mode hot reloads
  would leak one database connection pool per file save.

### Phase 2 — The AI pipeline (upload → n8n → Gemini → database)

**What was built:** an upload API, two internal (n8n-only) endpoints, and
the 6-node n8n workflow
[invoice-extraction.json](../n8n/workflows/invoice-extraction.json):
`Webhook → Download file → Build Gemini request → Gemini → Parse / Build
failure → Report to app`.

**What you learned:**

- **Async handoff:** the app never waits for the AI. It stores the file,
  fires a webhook, records `EXTRACTING`, and returns. The result arrives
  later on a callback endpoint. Users (and HTTP timeouts) never wait on an
  LLM.
- **Create the row before firing the webhook** — if the handoff crashes,
  you have a visible, retryable invoice instead of a silently lost file.
- **Structured outputs have two halves:** ask the model for a strict shape
  (Gemini `response_schema` + JSON mode), then re-validate with Zod at
  your boundary ([extraction.ts](../web/src/lib/validation/extraction.ts)).
  Transport-level guarantees are not business-level guarantees.
- **Prompt engineering for extraction** (see
  [n8n/prompts/invoice-extraction.md](../n8n/prompts/invoice-extraction.md)):
  role framing, "null over guess", explicit ambiguity escape hatches,
  calibrated self-reported confidence, temperature 0.
- **Error branches:** the Gemini node's failure output flows into a node
  that reports a proper failure, so a broken API call becomes an audited
  `FAILED` invoice — never a job stuck in limbo.
- **Service-to-service auth:** n8n proves its identity to `/api/internal/*`
  with a shared secret header, compared with a timing-safe function,
  failing closed if unconfigured.
- **Container networking:** containers can't see your host machine's
  `localhost`. n8n reaches the Next.js dev server via
  `host.docker.internal`, mapped in docker-compose with
  `extra_hosts: host.docker.internal:host-gateway`. We debugged this live
  by reading n8n's per-node execution log.

### Phase 3 — The decision layer (rules engine + embeddings)

**What was built:** the auto-approval rules engine
([web/src/lib/rules.ts](../web/src/lib/rules.ts)) with Vitest unit tests,
plus embedding-based near-duplicate detection: n8n embeds a canonical
one-line summary of each invoice (`vendor | number | date | total | currency`)
with `gemini-embedding-001`, the app stores the 768-dim vector in the
pgvector column and compares new invoices by cosine similarity.

**What you learned:**

- **Confidence-based routing is the heart of HITL:** the AI acts alone only
  when confidence is high, the amount is small, the vendor is known, and
  nothing is flagged — otherwise a human decides, and the audit log states
  *why* in plain English.
- **Decision logic as a pure function** — no DB, no HTTP — so it's unit
  testable (7 tests), reviewable, and its thresholds are env-tunable
  (`AUTO_APPROVE_MIN_CONFIDENCE`, `AUTO_APPROVE_MAX_TOTAL`).
- **Defense in depth for duplicates:** layer 1 is the DB unique constraint
  (exact match), layer 2 is embedding similarity (≥ 0.95) catching rescans
  with different spellings — verified live with similarity 0.976.
- **Embed the canonical identity, not the whole document** — short
  structured text makes near-duplicates cluster tightly.
- **Degrade gracefully:** if the embedding call fails, the invoice isn't
  lost — it's flagged `EMBEDDING_UNAVAILABLE` and routed to a human.
- **Free tiers throw 503s** ("model overloaded") — we hit one live; the
  error branch turned it into an audited FAILED invoice, and we switched
  to the lighter `gemini-2.5-flash-lite` model. Automatic retries are
  Phase 6's job.

### Phase 4 — Dashboard, auth, and the human half of HITL

**What was built:** the login-protected Next.js dashboard (stats, invoice
list with filters, detail page with PDF preview + audit timeline), session
auth per the official Next 16 pattern (jose-signed JWT in an httpOnly
cookie), and the approve/reject endpoints that record HUMAN transitions.

**What you learned:**

- **Stateless sessions:** sign a JWT with `SESSION_SECRET`, store it in an
  httpOnly cookie (JS can never read it), verify on every request. Next 16
  renamed middleware → `proxy.ts`, and the docs are explicit that proxy is
  only the *optimistic* redirect — real verification lives in the layout
  and in every API handler (defense in depth).
- **Two kinds of auth in one app:** humans get sessions; the n8n service
  keeps its `x-internal-api-key`. Different callers, different mechanisms.
- **Humans and AI share one state machine:** APPROVED_BY_HUMAN goes through
  the same `transitionInvoice` as AUTO_APPROVED — one audit trail answers
  "who approved this?" regardless of actor. Rejections *require* a reason.
- **Login responses never reveal** whether the email or the password was
  wrong (account enumeration), and bcrypt hashes are compared, never
  passwords.
- Verified live: unauthenticated page → 307 to /login, unauthenticated API
  → 401, double-approval → 409 from the transition guard.

---

## Part 2 — Glossary

### Automation & n8n

- **Workflow** — one automated process, drawn as a graph of connected
  steps. Saved as JSON (ours is version-controlled in `n8n/workflows/`).
  *React analogy: a component tree, but for backend steps.*
- **Node** — one step in a workflow: receive a request, call an API, run
  some JavaScript, transform data. *Analogy: a function — input in,
  output out.*
- **Trigger (node)** — the special node that *starts* a workflow: a
  webhook arriving, a schedule firing, an email landing. *Analogy: an
  event handler like `onClick` — nothing runs until the event happens.*
- **Webhook** — "call me when something happens": a URL one system exposes
  so another system can push data to it the moment an event occurs — the
  opposite of polling (asking again and again). Our app POSTs
  `{ invoiceId }` to n8n's webhook URL to start extraction.
- **Execution** — one run of a workflow, with every node's input and
  output recorded and replayable. *Analogy: one render, but with the props
  of every component saved for inspection.* This log is n8n's superpower.
- **Credential** — a secret (API key, OAuth token) stored encrypted inside
  n8n and referenced by nodes, so secrets never sit in the workflow JSON.
- **Code node** — an n8n node that runs custom JavaScript when no built-in
  node fits. We use one to build the Gemini request body.
- **Error branch / error output** — a second output wire on a node that
  carries failures, letting you *handle* errors instead of letting the
  whole run die.
- **Callback** — the return call: n8n finishes its work, then POSTs the
  result back to our app's endpoint. Webhook out, callback in.

### APIs & backend patterns

- **API orchestration** — coordinating several APIs into one process (our
  workflow: our app → Gemini → our app again).
- **Async handoff / fire-and-record** — start a slow job, record that it
  started, return immediately; the result arrives later via callback.
- **Idempotency** — safe to receive the same request twice. Our extraction
  endpoint rejects a second callback (409) because the invoice already
  left `EXTRACTING`.
- **Service-to-service auth** — how machine A proves to machine B that
  it's allowed to call (here: the `x-internal-api-key` shared-secret
  header). Different concern from human login.
- **Timing-safe comparison** — comparing secrets in constant time so an
  attacker can't measure response speed to guess a key character by
  character.
- **Fail closed** — when configuration is missing, deny access (instead of
  accidentally allowing everyone).
- **multipart/form-data** — the HTTP format for uploading files in a form
  body; parsed in the route handler with `request.formData()`.
- **State machine** — a fixed set of states plus the allowed moves between
  them. Anything not in the map is rejected — an invoice can't jump from
  `RECEIVED` to `PAID`.
- **Audit log / audit trail** — an append-only record of every action:
  who (AI/human/system), what, when, why. Never updated, never deleted.
  This is what makes an AI system trustworthy to a finance team.

### AI & LLM

- **LLM** — large language model (Gemini, GPT, Claude). Takes text (and
  often images/PDFs), produces text.
- **Prompt / system prompt / user prompt** — the instructions. The system
  prompt sets persistent rules and role ("you are an AP data-entry
  specialist; never guess"); the user prompt carries the actual task and
  document.
- **Prompt engineering** — writing prompts deliberately: role framing,
  explicit rules, escape hatches for ambiguity, output format — instead of
  hoping.
- **Hallucination** — the model confidently inventing plausible-looking
  data. Our main defense: "return null rather than guess" + warnings +
  validation.
- **Structured output** — forcing the model to answer as machine-readable
  JSON matching a schema, instead of prose you'd have to parse.
- **JSON mode / response schema** — the API features that enforce
  structured output (Gemini: `response_mime_type` + `response_schema`).
- **Temperature** — randomness dial. 0 = most deterministic, pick the most
  likely answer every time. Right for extraction; higher suits creative
  tasks.
- **Confidence score** — the model's self-reported 0–1 probability that
  its answer is right. Useful as a *routing signal* (auto-approve vs human
  review), never as ground truth.
- **Token** — the unit LLMs read/write and bill by; roughly ¾ of a word.
- **LLM vision** — sending an image or PDF directly to a multimodal model,
  replacing the old OCR → parse → structure pipeline with one step.
- **OCR** — optical character recognition: turning pixels into text. The
  classic pre-LLM approach (e.g. Tesseract); layout-blind, which is why we
  use LLM vision instead.
- **Embedding** — a list of numbers (a vector) representing *meaning*;
  similar texts get nearby vectors. Phase 3 uses them for near-duplicate
  detection.
- **Vector database / pgvector** — storage that can answer "which stored
  vectors are closest to this one?" pgvector adds that ability to
  Postgres itself.
- **Human-in-the-loop (HITL)** — a workflow where the AI does the work but
  a human approves the risky part. Our `NEEDS_REVIEW` queue.

### Database

- **PostgreSQL / Postgres** — the relational database holding both our
  business data and n8n's internal state.
- **ORM (Prisma)** — a typed layer between code and SQL: you write
  `prisma.invoice.create(...)`, it writes SQL, and TypeScript knows every
  field. *Analogy: typed props for your database.*
- **Migration** — a versioned SQL script that changes the database's shape
  (Prisma generates them from schema edits). Your schema's git history.
- **Seed** — a script inserting known starter data (our three vendors).
- **Transaction** — a group of writes that succeed or fail *together* —
  how a status change and its audit row stay inseparable.
- **Decimal vs Float** — `Decimal` stores exact base-10 numbers (money);
  `Float` is binary and can't represent 0.1 exactly.
- **Unique constraint** — a database-enforced "no two rows may share these
  values" rule, e.g. `(vendorId, invoiceNumber)`.
- **cuid** — the collision-resistant random ID format Prisma generates for
  our primary keys.

### Infrastructure

- **Container** — a lightweight isolated box that runs a program with all
  its dependencies, identically on any machine. *Analogy: `node_modules`
  for an entire operating environment.*
- **Image** — the frozen template a container is started from
  (`n8nio/n8n:latest`, `pgvector/pgvector:pg16`).
- **Docker Compose** — one YAML file declaring several containers, their
  networks, ports, and volumes, started together with `docker compose up`.
- **Volume** — persistent storage attached to a container, so data
  survives when the container is rebuilt (`postgres_data`, `n8n_data`).
- **Healthcheck** — a repeated probe ("is Postgres accepting
  connections?") other services can wait on (`depends_on: condition:
  service_healthy`).
- **host.docker.internal** — the special hostname a container uses to
  reach services on your host machine, because inside a container
  `localhost` means the container itself.
- **Environment variable / .env** — configuration and secrets injected at
  runtime, kept out of git (`.env.example` documents the shape; `.env`
  holds the real values).
- **Base64** — text encoding for binary data, letting a PDF travel inside
  a JSON field (how the file reaches Gemini).
- **MIME type** — a label naming a file's format (`application/pdf`,
  `image/png`), used to validate uploads and tell Gemini what it's
  reading.
- **Zod** — a TypeScript validation library: define a schema, and
  untrusted input either matches it or is rejected with details. We use
  it on everything the LLM (and n8n) sends us.
