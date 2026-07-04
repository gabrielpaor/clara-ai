# Clara — AI Accounts-Payable Employee

An AI automation system that processes vendor invoices end-to-end: it receives
invoices by email or dashboard upload, reads them with OCR + LLM extraction,
validates them against business rules, flags duplicates and anomalies, routes
uncertain cases to a human approval queue, and keeps a full audit trail — like
a junior AP clerk that never sleeps.

> **Status:** Phase 0 — infrastructure. See [docs/architecture.md](docs/architecture.md)
> for the full design and phase roadmap.

## Why this project exists

Portfolio project demonstrating production-grade AI automation engineering:
LLM orchestration with structured outputs, human-in-the-loop workflows,
retry/error handling, and observability — not another chatbot.

## Stack

| Layer      | Technology                                   |
| ---------- | -------------------------------------------- |
| Frontend   | Next.js (App Router), TypeScript, Tailwind, shadcn/ui |
| Automation | n8n (self-hosted, Docker)                    |
| Database   | PostgreSQL 16 + pgvector, Prisma             |
| AI         | OpenAI API (structured outputs, embeddings)  |
| Infra      | Docker Compose                               |

## Quick start

```bash
cp .env.example .env   # then fill in real values
docker compose up -d
```

| Service   | URL                    |
| --------- | ---------------------- |
| n8n       | http://localhost:5678  |
| Postgres  | localhost:5432         |
| Dashboard | http://localhost:3000 (Phase 1+) |

## Repository layout

```
├─ docker-compose.yml     # n8n + Postgres (pgvector)
├─ docker/postgres/       # DB init scripts
├─ n8n/workflows/         # exported n8n workflow JSON (version-controlled)
├─ web/                   # Next.js dashboard (Phase 1+)
└─ docs/                  # architecture, decisions, runbooks
```
