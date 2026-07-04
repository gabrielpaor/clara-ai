# Demo script — the 5-minute tour

The walkthrough for interviews, recorded demos, or anyone asking
"so what does it actually do?" Times assume everything is running
(`docker compose up -d`, `npm run dev`, workflows active).

## 0:00 — Frame it (no screen yet)

> "Clara is an AI accounts-payable employee. Companies receive invoices
> by email, someone reads each one, types it into a system, checks it
> isn't a duplicate, gets sign-off, pays it. Clara does that end-to-end,
> and — the important part — knows when *not* to act on her own."

## 0:30 — The happy path

1. Dashboard (localhost:3000) → point at the stat cards and health panel
2. Upload `samples/cloudhost-invoice-0001.pdf`*
3. While it processes (~10s): "the app never waits on the AI — it stores
   the file, fires a webhook to n8n, and the result comes back on an
   authenticated callback"
4. Refresh → invoice is **APPROVED**, by `AI`, reason "All checks passed"
5. Open it → extracted fields next to the actual PDF, confidence score,
   audit trail: SYSTEM received → SYSTEM handed off → AI approved

\* if CH-2026-1107 already exists in your DB, it flags as a duplicate —
either demo that as the "she remembers" moment, or reset with a fresh DB.

## 1:30 — The star of the show: refusal

1. Upload `samples/acme-invoice-0001-rescan.pdf` (the "rescanned" Acme
   invoice — different vendor spelling, different number format)
2. It lands in **NEEDS_REVIEW** with `NEAR_DUPLICATE`
3. Open it: "exact matching can't catch this — the vendor name and
   invoice number are both formatted differently. Clara embeds a
   canonical summary of every invoice and compares by cosine similarity
   in pgvector: 0.97 similar to an invoice we already have. The audit
   log states every reason she refused to approve."
4. Click **Reject**, type a reason → point at the HUMAN audit entry with
   your email on it

## 2:30 — The email employee

1. Send yourself an email with `samples/metro-invoice-0001.pdf` attached
2. While waiting (~60s): show the n8n editor — Gmail trigger, the
   allowlist story ("unknown senders never reach the LLM"), the
   extraction workflow with its error branch
3. Invoice appears on the dashboard on its own; notification email
   arrives: "review needed, here's the link"

## 3:30 — Reliability (what makes it production, not a demo)

1. n8n → Executions: pick any run, click through node inputs/outputs —
   "every run is replayable; this is how I debugged a Docker networking
   issue and a binary-encoding bug during the build"
2. Dashboard health panel: success rate, recent failures with reasons
3. Tell the 503 story: "Gemini's free tier had an outage mid-build.
   Failures were caught by the error branch, audited, the invoice held
   in a retryable state — and node-level retries now absorb transient
   errors entirely. One click retries the rest." (Show the Retry button
   on any FAILED invoice.)
4. Mention the sweeper: "if n8n dies mid-run and the callback never
   comes, a scheduled sweeper fails-and-frees the invoice in 15 minutes.
   Every async job needs a timeout owner."

## 4:30 — Close

> "Everything is versioned — including the n8n workflows and the
> extraction prompt with its design rationale. The state machine, audit
> log, and confidence-based routing mean a finance team could actually
> govern this. And it cost $0 to build and run."

## Recording a demo GIF/video (Windows)

- **ScreenToGif** (free) for a README GIF: record upload → APPROVED,
  then email → NEEDS_REVIEW → notification. Keep it under 30s / ~10MB.
- **Xbox Game Bar** (Win+G) or OBS for a full video walkthrough of this
  script; link it from the README.
