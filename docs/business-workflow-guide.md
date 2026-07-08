# Clara AI — Business Workflow Guide

A plain-language explanation of the business problem Clara solves, who's
involved, and how an invoice moves through the system from arrival to
payment approval. Written for a developer with little business-operations
background.

## The business problem: Accounts Payable (AP)

Every company that buys anything from other companies has an **Accounts
Payable** process: money owed *to* other businesses for goods/services
received. A "vendor" (also called "supplier") sends an **invoice** — a
bill saying "you owe us $X for Y, pay by date Z." Someone at the company
has to:

1. Receive that invoice
2. Read it and record the details (who, how much, when due)
3. Check it's legitimate (real vendor, correct amount, not a duplicate bill)
4. Get it approved by someone with authority
5. Eventually pay it

Do this by hand for 50 invoices a day and you need a team of people doing
repetitive data entry, and humans doing repetitive data entry make
mistakes — pay a duplicate invoice, miss a due date, mistype an amount.
This is one of the most commonly automated business functions in the
world, which is exactly why it's a strong portfolio project — every
company understands this pain.

**Clara's job**: be the AI that does steps 1–3 automatically, does step 4
only when it's confident enough to skip it safely, and otherwise hands
off to a human — with a paper trail for everything.

## The people (roles)

| Role | Who | What they do in Clara |
|---|---|---|
| **Vendor** | An external company billing you | Sends the invoice (email attachment or manual upload) — never touches the system directly |
| **AP Reviewer** | An employee (you, in the dashboard) | Looks at invoices Clara isn't confident about, corrects mistakes, approves or rejects |
| **The System (Clara)** | AI + automation | Reads invoices, checks them against known data, auto-approves the safe ones, escalates the risky ones |
| **Admin/Controller** (implied, not built out) | Finance leadership | Would set the approval rules (e.g. "auto-approve anything under $500") — currently that's a config value, in a mature system it'd be a settings screen |

The key relationship to understand: **the AI is a triage system, not a
replacement for the reviewer.** It's designed to make the *easy* 80% of
invoices disappear from a human's desk, so the reviewer only spends time
on the 20% that actually need judgment.

## Walk through one invoice, start to finish

Imagine "Metro Logistics PH" ships you a $150 warehouse storage bill.

**Step 1 — Intake.** The invoice PDF arrives (email attachment, or you
upload it manually/in a batch). Clara creates an `Invoice` record in
status `RECEIVED`. *Why this step exists:* you need a permanent,
timestamped record that this document exists, before anything else
happens to it — this is your source of truth if anyone ever asks "did we
get this invoice, and when?"

**Step 2 — Dispatch to extraction.** The app hands the file to n8n (the
automation engine) via a webhook — think of a webhook as "a doorbell the
app rings to tell another system to start working." Status moves to
`EXTRACTING`. *Why:* separates "we received it" from "we've processed
it" — if extraction crashes, you can tell exactly which invoices are
stuck mid-flight.

**Step 3 — AI reads the document.** n8n sends the PDF to Gemini (the
LLM) with instructions: "extract vendor name, invoice number, dates,
amounts, currency; if you're not sure, say null, don't guess; give me a
confidence score." This is the part that replaces the human data-entry
step. *Why an LLM specifically:* it reads documents the way a person
does — by understanding meaning, not by matching a fixed template — so it
works across wildly different invoice layouts.

**Step 4 — Business rule checks (enrichment).** This is *not* the AI
anymore — it's plain deterministic code checking the extracted data
against your records:

- **Vendor matching**: is "Metro Logistics PH" a vendor you already have
  on file? This is your **master data** — a company's trusted,
  pre-approved list of real business entities (vendors, employees,
  products). If the name doesn't match anyone in that list →
  `UNKNOWN_VENDOR` flag. *Why this matters in the real world:* invoice
  fraud often comes from someone impersonating a real vendor with a
  slightly different name or new bank account — an unrecognized vendor
  should always get a human's eyes before money moves.
- **Math check**: does subtotal + tax = total? If not →
  `TOTALS_MISMATCH`. Catches OCR errors or genuinely malformed invoices.
- **Duplicate check**: have you already received an invoice with this
  same vendor + invoice number? (Or, via embeddings, one that looks
  *suspiciously similar* even with small text differences?) →
  `DUPLICATE_SUSPECTED` / `NEAR_DUPLICATE`. *Why:* the single most common
  and expensive AP mistake is paying the same bill twice — vendors
  sometimes even resend invoices by accident, or in rare cases, someone
  submits a bill twice on purpose.

**Step 5 — The decision.** A rules engine looks at: confidence score,
dollar amount, vendor match, and flags — and decides: auto-approve, or
send to a human? Currently: confidence ≥ 85%, total ≤ $500, vendor
matched, and no flags → auto-approved. Otherwise → `NEEDS_REVIEW`. *Why a
dollar threshold:* this is a real-world control called **materiality** —
the idea that small errors matter less than big ones. Auto-approving a
$12 office-supply invoice that turns out wrong costs you $12.
Auto-approving a $50,000 invoice that turns out to be fraud is a very
different conversation. Businesses draw this line everywhere: audit
thresholds, expense-report approval limits, etc.

**Step 6a — Auto-approved path.** Status → `APPROVED`. No human ever
looked at it. This is the payoff of the whole system — invoices that are
cheap, clearly legitimate, and correctly read never cost a human a
minute.

**Step 6b — Human review path.** Status → `NEEDS_REVIEW`, and (from
Phase 5) Clara emails the AP reviewer: "an invoice needs your
attention." This is called **HITL — Human-In-The-Loop**: the AI does the
work, but a person is the final checkpoint before anything consequential
happens. It's the standard pattern for any AI system touching money,
health, or legal decisions — full autonomy is a liability, full manual
work defeats the purpose, so you automate the routine and gate the
risky.

**Step 7 — The reviewer acts.** In your dashboard: read the extracted
fields side-by-side with the actual PDF, fix mistakes ("Correct
fields"), and Approve or Reject. If they correct the vendor name and it
now matches your master vendor list, `UNKNOWN_VENDOR` is *recomputed and
cleared automatically* — the system re-checks its own rules after a
human edit rather than trusting the fix blindly.

**Step 8 — The audit trail.** Every single transition — received,
routed to review, corrected, approved — writes a permanent, append-only
`AuditLog` row: who (or what) did it, when, and why. *Why this matters:*
this is what makes the system trustworthy to a finance department or an
external auditor. "Show me why invoice #4471 was approved" needs a real,
unforgeable answer — "the AI decided" isn't good enough, but "confidence
0.94, vendor matched, $340, no flags, approved 2026-07-04 14:02 by
SYSTEM" is.

**Step 9 — Reliability underneath all of this.** LLM calls fail
sometimes (rate limits, timeouts) — the system retries automatically
before giving up (`FAILED` status, with a manual retry button). A
sweeper checks for invoices stuck mid-process and flags them. None of
this is "business logic" — it's the plumbing that makes an automated
system trustworthy enough to leave unattended, which is itself a
business requirement: nobody wants a system that silently loses
invoices.

## How the pieces physically talk to each other

```
Vendor email / manual upload
        ↓
Next.js app (the dashboard + database) ←──┐
        ↓ webhook                         │ webhook callback
     n8n (workflow engine)                │ (with the AI's findings)
        ↓                                 │
     Gemini (the LLM, reads the PDF)  ─────┘
```

The Next.js app is the **system of record** — it owns the database, the
business rules, the audit log, and the UI. n8n is a **dumb pipe** that
shuttles a file to the AI and ships the answer back — deliberately, so
that if you ever swapped Gemini for OpenAI, or swapped n8n for a
different automation tool, none of the actual business logic (rules,
flags, approvals) would need to change. That separation — *business
logic lives in one place, integrations are replaceable* — is a design
principle worth being able to explain in an interview: it's why real
companies don't want their core logic locked inside a no-code tool.

## Quick terms glossary

- **Invoice**: a bill from a vendor for goods/services
- **Vendor / Supplier**: a company you buy from and owe money to
- **Master data**: your organization's trusted, pre-vetted reference list
  (here: known vendors)
- **Materiality**: the idea that decisions should get more scrutiny as
  the dollar amount (or risk) increases
- **HITL (Human-in-the-loop)**: AI does the work, a human approves
  before anything consequential happens
- **Audit trail**: an unchangeable log of who did what and when, for
  accountability and compliance
- **Reconciliation**: matching two records to confirm they agree (here:
  subtotal + tax = total; or "this invoice matches one we've already
  seen")
- **Webhook**: one system "ringing a doorbell" on another to say "start
  this job"
- **SLA-ish reliability concepts** (retries, sweepers): the operational
  guarantees that make an automated system safe to leave running
  unattended
