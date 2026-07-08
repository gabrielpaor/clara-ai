# n8n, explained for a web developer

Everything about Clara's automation layer, assuming you know web dev but
zero automation. Short sections — read top to bottom once, then use it as
a reference.

---

## 1. The big idea: n8n is a second backend

You already have a backend (Next.js API routes). n8n is **another backend
that you program visually instead of in code**. Think of it as an Express
app where every route, cron job, and background worker is drawn as a
diagram — and where every request that ever ran is recorded and
replayable.

It runs as a Docker container (see `docker-compose.yml`) and stores
everything — workflows, credentials, run history — in our PostgreSQL, in
its own `n8n` database, completely separate from the app's data.

**Why use it at all, instead of writing more Next.js code?** Three
reasons: long-running multi-step jobs don't fit request/response handlers;
every execution is automatically logged step-by-step (debugging gold);
and integrations like "watch a Gmail inbox" are pre-built nodes instead
of OAuth code you'd write yourself.

---

## 2. Vocabulary, translated

| n8n term | What it really is | Web-dev equivalent |
| --- | --- | --- |
| **Workflow** | One automated program, drawn as a graph | One Express route handler + its helper functions |
| **Node** | One step: call an API, run JS, send an email | A function: input in, output out |
| **Trigger node** | The special first node that *starts* the workflow | The route/`app.post(...)`, an event listener, or a cron entry |
| **Connection** | The arrow between nodes | The call order — `then()` chaining |
| **Item** | The data flowing between nodes: `{ json: {...}, binary: {...} }` | `req.body`, passed along the chain |
| **Execution** | One run of a workflow, with every node's input & output saved | One handled request — but with a full replayable trace |
| **Credential** | A secret stored encrypted inside n8n, referenced by nodes | `.env` values, but with a UI and per-node references |
| **Expression** | `{{ ... }}` templating inside node settings | Template literals: `` `${data.invoiceId}` `` |
| **Publish / Active** | Turning the workflow on so its trigger listens | `app.listen()` — deployed vs. just saved |

---

## 3. The JSON files under `n8n/workflows/`

Each file is **the complete source code of one workflow** — n8n's export
format. One important mental model:

> **n8n does not read these files at runtime.** It runs workflows from
> its own database. The files in the repo are the *source of truth* that
> we version-control, and `scripts/import-workflows.ps1` (or `.sh`) is
> the **deploy step** that pushes them into n8n — the same relationship
> `schema.prisma` has to the actual database.

So the edit cycle is: edit JSON → run the import script (imports +
publishes + restarts n8n) → n8n now runs the new version. (You *can* also
edit in the n8n UI — see section 7 for how we keep the two in sync.)

Anatomy of one file:

```jsonc
{
  "id": "ClaraInvoiceExtr",        // stable id — lets re-imports UPDATE instead of duplicate
  "name": "Clara — Invoice Extraction",
  "active": true,                  // should this be on after import?
  "settings": {
    "errorWorkflow": "ClaraErrorHandlr"  // who to call if this workflow crashes
  },
  "nodes": [                       // the boxes
    {
      "name": "Webhook",           // display name — also how other nodes reference it
      "type": "n8n-nodes-base.webhook",   // which kind of node (like an npm package name)
      "typeVersion": 2,
      "parameters": { ... },       // the node's settings (the form you'd fill in the UI)
      "credentials": {             // reference by id+name — NO secrets in this file,
        "httpHeaderAuth": { "id": "ClaraInternalKey", "name": "Clara Internal API" }
      },                           // which is why committing workflows is safe
      "retryOnFail": true, "maxTries": 3, "waitBetweenTries": 5000
    }
  ],
  "connections": {                 // the arrows: which node feeds which
    "Webhook": { "main": [[{ "node": "Download invoice file", ... }]] }
  }
}
```

---

## 4. Triggers: what actually starts each workflow

A trigger is not a separate file — it's the **first node inside the
workflow**. Nothing runs until the trigger fires. Clara uses all four
common kinds:

| Trigger | Fires when… | Web-dev equivalent | Used in |
| --- | --- | --- | --- |
| **Webhook** | Someone HTTP-POSTs to its URL (`http://localhost:5678/webhook/invoice-extraction`) | An Express route | extraction, notify |
| **Gmail Trigger** | Its poller finds a new matching email (checks every minute) | `setInterval` + inbox check | email-ingestion |
| **Schedule Trigger** | A cron schedule ticks (every 15 min) | A cron job | maintenance |
| **Error Trigger** | *Any other workflow* crashes | `process.on('uncaughtException')`, global | error-handler |

The webhook ones are how **our app talks to n8n**: `lib/dispatch.ts` and
`lib/notify.ts` just `fetch()` those URLs. n8n answers 200 immediately
("got it") and processes in the background — that's the async handoff.

---

## 5. The five workflows, node by node

### invoice-extraction — the AI pipeline (the big one)

```
Webhook ─► Download invoice file ─► Build Gemini request ─► Gemini: extract
                                                              │        │
                                              success ▼        ▼ error output
                                            Parse extraction   Build failure payload
                                                    ▼                  │
                                        Build embedding request        │
                                                    ▼                  │
                                          Gemini: embed invoice        │
                                                    ▼                  │
                                            Attach embedding           │
                                                    └──► Report result to app ◄──┘
```

- **Webhook** — receives `{ invoiceId }` from the app.
- **Download invoice file** (HTTP Request node) — calls our internal API
  to fetch the PDF as base64. Authenticates with the shared-secret header
  credential.
- **Build Gemini request** (Code node — a JS sandbox for when no
  pre-built node fits) — assembles the prompt, the JSON response schema,
  and the file into Gemini's request format.
- **Gemini: extract** (HTTP Request) — the actual LLM call. Retries 3×
  with 5s waits (transient 503s self-heal). Its **error output** — a
  second wire out of the node — routes failures to a handler instead of
  crashing the run.
- **Parse extraction** (Code) — unwraps Gemini's response envelope into
  our report shape.
- **Build embedding request → Gemini: embed → Attach embedding** — makes
  the 768-number vector used for near-duplicate detection. If embedding
  fails, it continues with `embedding: null` (degraded, not dead).
- **Build failure payload** (Code) — converts an error into
  `{ outcome: "failure", error }` so the invoice gets marked FAILED
  instead of stuck.
- **Report result to app** (HTTP Request) — POSTs the outcome back to
  our extraction endpoint. Both the success and failure paths end here.

Note what's *missing*: no business rules. Approve/review decisions,
vendor matching, duplicate checks all live in the Next.js app. **n8n
moves data; the app decides.** That separation is deliberate.

### email-ingestion — the inbox watcher

```
Gmail Trigger ─► Expand attachments (Code) ─► Deliver to app (HTTP)
```

Polls Gmail every minute for unread mail with attachments, fans out one
item per PDF/image (one email can carry several), and POSTs each as
base64 to our ingest endpoint — where the app enforces the sender
allowlist and dedup. Gotcha we hit live: attachment bytes must be read
with `this.helpers.getBinaryDataBuffer(i, key)`, never
`item.binary[key].data` — the latter can be a reference stub, not data.

### notify — outbound email

```
Webhook ─► Send notification email (Gmail node)
```

Two nodes. The app POSTs `{ notifyTo, subject, html }`; the Gmail node
sends it. All templating happens in the app (`lib/notify.ts`) so the
email content is versioned code.

### error-handler — the global catch block

```
Error Trigger ─► Shape error report (Code) ─► Report to app (HTTP)
```

Every other workflow declares `"errorWorkflow": "ClaraErrorHandlr"` in
its settings. When any of them crashes, this fires with the failed
execution's metadata (workflow name, execution id, error, last node) and
reports it to the app — which records it and emails you. Written once,
covers everything.

### maintenance — the janitor

```
Schedule Trigger (15 min) ─► Requeue stuck invoices (HTTP)
```

Calls the app's requeue endpoint, which fails-and-frees any invoice
stuck in EXTRACTING for >10 minutes (the "n8n died mid-run and the
callback never came" case).

---

## 6. How data moves: items and expressions

Each node outputs an array of **items**; the next node receives them.
Inside any node's settings you can interpolate with expressions:

- `{{ $json.body.invoiceId }}` — field from *this node's input*
  (the leading `=` in the JSON marks a parameter as an expression)
- `{{ $('Webhook').item.json.body.invoiceId }}` — reach back to a
  *specific earlier node's* output by name (how "Report result" gets the
  invoiceId even though the Gemini response replaced it several nodes ago)
- `$execution.id` — metadata like the current execution id (we attach it
  to reports so DB records link to n8n's logs)

In Code nodes it's plain JavaScript: `$input.all()`, return
`[{ json: {...} }]`.

---

## 7. Setting up / changing a workflow — the two ways

**The UI way** (best for exploring): open localhost:5678 → New workflow →
click **+** and search for a node → fill in its settings form → pick a
credential from the dropdown → connect the boxes by dragging → run
**Execute step** on nodes to test with real data → **Publish**. This is
also the *only* way to do OAuth sign-ins (Gmail).

**The repo way** (what this project treats as canonical): edit the JSON
file → `.\scripts\import-workflows.ps1` → done. The pinned `id` in each
file makes the import an update, not a duplicate.

If you change something in the UI and want to keep it, export it back:
in the workflow menu (⋯) choose **Download** and overwrite the repo file
— like committing after editing in a GUI database tool. Pick one
direction per change or the two copies drift.

---

## 8. Credentials: why the repo has no secrets

Nodes never contain keys — they contain **references** (`id` + `name`)
to credentials stored encrypted in n8n's database (encrypted with
`N8N_ENCRYPTION_KEY` from `.env` — lose the key, lose the credentials).
Clara has three:

| Credential | Type | Used by |
| --- | --- | --- |
| Clara Internal API | Header auth (`x-internal-api-key`) | Every node that calls our app |
| Google Gemini API Key | Header auth (`x-goog-api-key`) | The two Gemini nodes |
| Clara Gmail | OAuth2 | Gmail Trigger + Send email |

That's why committing the workflow JSON publicly is safe.

---

## 9. Debugging: the Executions tab is the superpower

n8n UI → **Executions** (per workflow, or globally in the sidebar). Every
run — success or failure — is stored. Click one and you see the workflow
with real data frozen in it: click any node to inspect exactly what it
received and produced. This is how we caught the Docker networking bug
(`host.docker.internal` not resolving) and the 9-byte attachment bug.

The gotchas we actually hit, so you recognize them next time:

1. **Webhook returns 404** → the workflow isn't published/active, or n8n
   wasn't restarted after a CLI import (CLI changes need a restart; UI
   publishes don't).
2. **Container can't reach your app** → inside Docker, `localhost` means
   the container. Use `host.docker.internal` (mapped via `extra_hosts`
   in docker-compose).
3. **Binary data is tiny/garbage** → read it with `getBinaryDataBuffer`,
   never `.data` directly.
4. **A node fails and the whole run dies silently** → give the node an
   error strategy: retries (`retryOnFail`) for transient faults, an
   error output (`onError: continueErrorOutput`) for handled failure
   paths, and an `errorWorkflow` as the last-resort catch.
