// Outbound notifications, delivered through n8n's notify workflow (which
// owns the Gmail credential). Fire-and-forget by design: a broken notifier
// must never break invoice processing — the failure is logged and life
// goes on.

export interface InvoiceNotification {
  invoiceId: string;
  status: "NEEDS_REVIEW" | "FAILED";
  vendorName: string | null;
  fileName: string;
  total: string | null;
  currency: string | null;
  reason: string;
}

/** Generic operational alert (workflow crash, stuck jobs). Same
 * fire-and-forget contract as invoice notifications. */
export function notifySystemAlert(subject: string, html: string): void {
  const notifyTo = process.env.ADMIN_NOTIFY_EMAIL;
  if (!notifyTo) return;
  void fetch(`${process.env.N8N_WEBHOOK_URL}/notify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notifyTo, subject: `[Clara] ${subject}`, html }),
  })
    .then((res) => {
      if (!res.ok) console.warn(`notify: n8n notify webhook returned ${res.status}`);
    })
    .catch((error) => {
      console.warn(
        `notify: could not reach n8n notify webhook (${error instanceof Error ? error.message : error})`,
      );
    });
}

export function notifyInvoiceOutcome(n: InvoiceNotification): void {
  const notifyTo = process.env.ADMIN_NOTIFY_EMAIL;
  if (!notifyTo) return; // notifications are optional configuration

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const title = n.vendorName ?? n.fileName;
  const amount = n.total ? `${n.currency ?? ""} ${n.total}`.trim() : "amount unknown";
  const subject =
    n.status === "NEEDS_REVIEW"
      ? `[Clara] Review needed: ${title} (${amount})`
      : `[Clara] Extraction failed: ${title}`;
  const html = [
    `<p>An invoice ${n.status === "NEEDS_REVIEW" ? "needs your review" : "failed processing"}.</p>`,
    `<p><strong>${title}</strong> — ${amount}</p>`,
    `<p>${n.reason}</p>`,
    `<p><a href="${appUrl}/invoices/${n.invoiceId}">Open in Clara</a></p>`,
  ].join("\n");

  // Deliberately not awaited by callers; failures are logged, never thrown.
  // Note: fetch only REJECTS on network failure — an HTTP error status
  // (e.g. 404 while the notify workflow is inactive) resolves normally,
  // so both paths must be handled explicitly.
  void fetch(`${process.env.N8N_WEBHOOK_URL}/notify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ notifyTo, subject, html, invoiceId: n.invoiceId }),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`notify: n8n notify webhook returned ${res.status}`);
      }
    })
    .catch((error) => {
      console.warn(
        `notify: could not reach n8n notify webhook (${error instanceof Error ? error.message : error})`,
      );
    });
}
