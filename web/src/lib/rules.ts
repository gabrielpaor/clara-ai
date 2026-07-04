// The auto-approval decision engine.
//
// A pure function: facts in, decision + reasons out. No DB, no HTTP —
// which makes it unit-testable and auditable. Every check it runs is
// recorded, and the reasons for routing to a human are stored in the
// audit log verbatim.
import type { ExtractedFields } from "./validation/extraction";

// Thresholds are env-tunable so ops can adjust risk appetite without a deploy.
const MIN_CONFIDENCE = Number(process.env.AUTO_APPROVE_MIN_CONFIDENCE ?? 0.85);
const MAX_TOTAL = Number(process.env.AUTO_APPROVE_MAX_TOTAL ?? 500);

export interface DecisionInput {
  data: ExtractedFields;
  confidence: number;
  vendorMatched: boolean;
  flags: string[];
}

export interface Decision {
  approve: boolean;
  /** Human-readable reasons the invoice needs review; empty when approved. */
  reasons: string[];
  /** Every check that ran and its outcome — stored in audit metadata. */
  checks: Record<string, boolean>;
}

export function evaluateInvoice(input: DecisionInput): Decision {
  const { data, confidence, vendorMatched, flags } = input;
  const reasons: string[] = [];

  const checks: Record<string, boolean> = {
    confidenceAboveThreshold: confidence >= MIN_CONFIDENCE,
    vendorMatched,
    noFlags: flags.length === 0,
    requiredFieldsPresent:
      data.invoiceNumber !== null &&
      data.invoiceDate !== null &&
      data.currency !== null &&
      data.total !== null,
    totalWithinAutoApproveLimit:
      data.total !== null && data.total > 0 && data.total <= MAX_TOTAL,
  };

  if (!checks.confidenceAboveThreshold) {
    reasons.push(
      `extraction confidence ${confidence.toFixed(2)} below threshold ${MIN_CONFIDENCE}`,
    );
  }
  if (!checks.vendorMatched) {
    reasons.push("vendor not found in master data");
  }
  if (!checks.noFlags) {
    reasons.push(`flags raised: ${flags.join(", ")}`);
  }
  if (!checks.requiredFieldsPresent) {
    reasons.push("missing required fields (invoice number, date, currency or total)");
  }
  if (!checks.totalWithinAutoApproveLimit) {
    reasons.push(
      data.total === null
        ? "total is missing"
        : `total ${data.total.toFixed(2)} exceeds auto-approve limit ${MAX_TOTAL}`,
    );
  }

  return { approve: reasons.length === 0, reasons, checks };
}
