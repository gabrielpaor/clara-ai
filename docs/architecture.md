# Architecture — Clara, the AI Accounts-Payable Employee

## 1. The business process being automated

Accounts Payable (AP) in a real company: vendors email invoices (PDFs, photos,
scans), someone reads each one, types the data into a system, checks it isn't a
duplicate or fraud, gets a manager's sign-off above a spending threshold, and
schedules payment. It is repetitive, error-prone, and expensive — which is why
AP automation is one of the most commonly purchased AI products in the
enterprise. This project rebuilds that product end-to-end.

## 2. System overview

```
                     ┌───────────────────────────────┐
  Vendor email ─────►│                               │
  (Gmail trigger)    │        n8n workflows          │
                     │  ┌─────────────────────────┐  │
  Dashboard upload ─►│  │ 1. Ingestion            │  │
  (webhook)          │  │ 2. Extraction (LLM+OCR) │  │
                     │  │ 3. Validation & rules   │  │──► Email / notifications
                     │  │ 4. Approval routing     │  │
                     │  │ 5. Error workflow       │  │
                     │  └─────────────────────────┘  │
                     └──────────────┬────────────────┘
                                    │ reads/writes
                                    ▼
                     ┌───────────────────────────────┐
                     │   PostgreSQL (+ pgvector)     │
                     │   invoices · vendors · runs   │
                     │   audit_log · embeddings      │
                     └──────────────┬────────────────┘
                                    │ Prisma
                                    ▼
                     ┌───────────────────────────────┐
                     │     Next.js dashboard         │
                     │  upload · review queue ·      │
                     │  approve/reject · analytics   │
                     └───────────────────────────────┘
```

**Separation of concerns:** n8n owns *processes* (multi-step, long-running,
retryable), the Next.js app owns *interaction* (auth, upload, review UI), and
PostgreSQL is the single source of truth both sides read and write. They talk
via webhooks (app → n8n) and database writes + callback endpoints (n8n → app).

## 3. Core invoice lifecycle (state machine)

```
RECEIVED → EXTRACTING → NEEDS_REVIEW ──(human approves)──► APPROVED → SCHEDULED → PAID
                │             │
                │             └─(human rejects)──► REJECTED
                ├──(high confidence + rules pass)──► APPROVED (auto)
                └──(hard failure)──► FAILED (error workflow → alert + retry)
```

Every transition is written to an `audit_log` table with actor
(`ai` / `human` / `system`), timestamp, and reason — the compliance story.

## 4. Key design decisions

| Decision | Choice | Why (and the alternative) |
| --- | --- | --- |
| Automation engine | Self-hosted n8n in Docker | Free, unlimited executions, credentials stay local. Alt: n8n Cloud (paid after trial), Temporal (code-first, steeper). |
| n8n storage | Postgres, not default SQLite | Survives container rebuilds; the production configuration. |
| Vector DB | pgvector inside the same Postgres | One less service, free, SQL-joinable with invoice rows. Alt: Pinecone/Qdrant (justified at much larger scale). |
| OCR | LLM vision (image → structured JSON directly) | One step instead of OCR→parse→structure; handles messy scans. Alt: Tesseract (free but layout-blind), AWS Textract (paid). |
| LLM outputs | Structured outputs (JSON Schema-enforced) | Eliminates "parse the model's prose" failures; validated again with Zod at the boundary. |
| Human-in-the-loop | Confidence score + amount threshold routing | Auto-approve only when the model is confident *and* the amount is small; everything else queues for a human. |
| App ↔ n8n contract | Webhook in, callback + DB out | Loose coupling; either side can be redeployed independently. |

## 5. Phase roadmap

| Phase | Deliverable | Concepts taught |
| --- | --- | --- |
| 0 ✅ | Docker infra: n8n + Postgres/pgvector | Docker Compose, n8n fundamentals |
| 1 ✅ | Prisma schema + Next.js scaffold (auth moved to dashboard phase) | Data modeling, state machines |
| 2 ✅ | Upload → webhook → LLM extraction pipeline (Gemini free tier) | Webhooks, prompt engineering, structured outputs |
| 3 ✅ | Auto-approval rules engine + near-duplicate detection (pgvector) | Business rules, embeddings, unit testing |
| 4 ✅ | Dashboard + session auth + human approval queue (HITL complete) | Stateless sessions, route protection, human transitions |
| 5 ✅ | Email ingestion (allowlist, message dedup) + notification emails | OAuth, email automation, intake refactor |
| 6 | Error workflows, retries, audit log, monitoring dashboard | Production reliability |
| 7 | Deployment (Railway/Vercel), README polish, demo | DevOps, storytelling |

## 6. Cost profile (learning budget)

Everything is free except LLM tokens: self-hosted n8n ($0), local Postgres
($0), Gmail ($0), pgvector ($0). Extraction uses a mini-class model
(~$0.15–0.60 per **million** tokens); a full build-and-test cycle of this
project costs roughly $1–3 total. Zero-cost fallback: Google Gemini's free
tier via the same abstraction layer.
